/**
 * 衝突解決服務
 * 處理本地和雲端數據之間的同步衝突
 */

export class ConflictResolver {
  /**
   * 解決衝突的基本策略：以最新的版本為準
   * @param {Object} localData - 本地數據
   * @param {Object} remoteData - 遠端數據
   * @returns {Object} 解決後的數據和衝突信息
   */
  static resolveByLatestVersion(localData, remoteData) {
    const localTime = new Date(localData.updated_at || localData.updatedAt).getTime();
    const remoteTime = new Date(remoteData.updated_at || remoteData.updatedAt).getTime();

    if (localTime > remoteTime) {
      return {
        resolved: localData,
        winner: 'local',
        localTime,
        remoteTime,
        hasConflict: true
      };
    } else if (remoteTime > localTime) {
      return {
        resolved: remoteData,
        winner: 'remote',
        localTime,
        remoteTime,
        hasConflict: true
      };
    } else {
      // 時間相同，使用本地版本作為備用
      return {
        resolved: localData,
        winner: 'tie-local',
        localTime,
        remoteTime,
        hasConflict: false
      };
    }
  }

  /**
   * 合併兩個版本的數據（適用於某些字段）
   * @param {Object} localData - 本地數據
   * @param {Object} remoteData - 遠端數據
   * @param {Array} priorityFields - 優先保留本地版本的字段
   * @returns {Object} 合併後的數據
   */
  static mergeVersions(localData, remoteData, priorityFields = []) {
    const merged = { ...remoteData };

    // 保留本地優先字段
    priorityFields.forEach(field => {
      if (localData.hasOwnProperty(field)) {
        merged[field] = localData[field];
      }
    });

    // 保留最新的 updated_at
    const localTime = new Date(localData.updated_at || localData.updatedAt).getTime();
    const remoteTime = new Date(remoteData.updated_at || remoteData.updatedAt).getTime();
    merged.updated_at = localTime > remoteTime ? localData.updated_at : remoteData.updated_at;

    return merged;
  }

  /**
   * 檢測內容衝突
   * 比較相關字段是否有實質性改動
   */
  static detectContentConflict(localData, remoteData) {
    const contentFields = ['content', 'comment', 'text', 'title', 'description'];
    
    for (const field of contentFields) {
      if (localData[field] && remoteData[field]) {
        if (localData[field] !== remoteData[field]) {
          return {
            hasConflict: true,
            conflictField: field,
            localValue: localData[field],
            remoteValue: remoteData[field]
          };
        }
      }
    }

    return { hasConflict: false };
  }
}

/**
 * 同步服務 - 處理本地和雲端同步
 */
export class SyncService {
  constructor(localStorageKey = 'sync-queue', api = null) {
    this.localStorageKey = localStorageKey;
    this.api = api;
    this.syncQueue = this.loadSyncQueue();
    this.conflictLog = [];
  }

  /**
   * 從 localStorage 加載同步隊列
   */
  loadSyncQueue() {
    try {
      const stored = localStorage.getItem(this.localStorageKey);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('加載同步隊列失敗:', error);
      return [];
    }
  }

  /**
   * 保存同步隊列到 localStorage
   */
  saveSyncQueue() {
    try {
      localStorage.setItem(this.localStorageKey, JSON.stringify(this.syncQueue));
    } catch (error) {
      console.error('保存同步隊列失敗:', error);
    }
  }

  /**
   * 添加項目到同步隊列
   */
  enqueue(item) {
    // 為本地項目添加唯一標識符（如果還沒有）
    if (!item.local_uuid) {
      item.local_uuid = this.generateUUID();
    }

    item.queued_at = new Date().toISOString();
    item.sync_status = 'pending';

    this.syncQueue.push(item);
    this.saveSyncQueue();

    return item.local_uuid;
  }

  /**
   * 生成 UUID
   */
  generateUUID() {
    return 'local-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * 同步單個項目
   */
  async syncItem(item) {
    if (!this.api) {
      console.error('API 客戶端未配置');
      return { success: false, error: 'API_NOT_CONFIGURED' };
    }

    try {
      const endpoint = item.endpoint || `/api/${item.type}`;
      const method = item.method || 'POST';
      const data = item.data || item;

      let response;

      if (method === 'POST') {
        response = await this.api.post(endpoint, data);
      } else if (method === 'PATCH') {
        response = await this.api.patch(endpoint, data);
      } else if (method === 'PUT') {
        response = await this.api.request('PUT', endpoint, data);
      } else if (method === 'DELETE') {
        response = await this.api.delete(endpoint);
      }

      // 檢測衝突
      if (response.conflict) {
        this.conflictLog.push({
          local_uuid: item.local_uuid,
          timestamp: new Date().toISOString(),
          localData: item.data,
          remoteData: response.remoteData,
          resolution: response.suggestedResolution
        });

        return {
          success: false,
          error: 'SYNC_CONFLICT',
          conflict: response.conflict,
          remoteData: response.remoteData
        };
      }

      // 同步成功
      item.sync_status = 'synced';
      item.remote_id = response.id || response.data?.id;
      item.synced_at = new Date().toISOString();

      return { success: true, data: response };
    } catch (error) {
      console.error('同步項目失敗:', error);
      return {
        success: false,
        error: error.message || 'SYNC_FAILED'
      };
    }
  }

  /**
   * 同步所有待同步項目
   */
  async syncAll() {
    const results = [];
    const pendingItems = this.syncQueue.filter(item => item.sync_status === 'pending');

    for (const item of pendingItems) {
      const result = await this.syncItem(item);
      results.push({ item, result });

      if (!result.success && result.error === 'SYNC_CONFLICT') {
        // 停止同步，等待用戶處理衝突
        break;
      }
    }

    // 清理已同步的項目
    this.syncQueue = this.syncQueue.filter(item => item.sync_status !== 'synced');
    this.saveSyncQueue();

    return results;
  }

  /**
   * 處理衝突 - 選擇本地版本
   */
  resolveConflictLocal(localUUID) {
    const item = this.syncQueue.find(i => i.local_uuid === localUUID);
    if (!item) return false;

    item.sync_status = 'resolved-local';
    item.resolved_at = new Date().toISOString();
    this.saveSyncQueue();

    return true;
  }

  /**
   * 處理衝突 - 選擇遠端版本
   */
  resolveConflictRemote(localUUID, remoteData) {
    const item = this.syncQueue.find(i => i.local_uuid === localUUID);
    if (!item) return false;

    item.sync_status = 'resolved-remote';
    item.data = remoteData;
    item.resolved_at = new Date().toISOString();
    this.saveSyncQueue();

    return true;
  }

  /**
   * 獲取衝突日誌
   */
  getConflictLog() {
    return this.conflictLog;
  }

  /**
   * 清除衝突日誌
   */
  clearConflictLog() {
    this.conflictLog = [];
  }

  /**
   * 獲取同步狀態
   */
  getSyncStatus() {
    return {
      totalItems: this.syncQueue.length,
      pendingItems: this.syncQueue.filter(i => i.sync_status === 'pending').length,
      syncedItems: this.syncQueue.filter(i => i.sync_status === 'synced').length,
      conflictItems: this.syncQueue.filter(i => i.sync_status === 'pending' && this.conflictLog.some(c => c.local_uuid === i.local_uuid)).length,
      lastSync: this.syncQueue.filter(i => i.synced_at).sort((a, b) => new Date(b.synced_at) - new Date(a.synced_at))[0]?.synced_at || null
    };
  }
}

/**
 * 將衝突解決整合到 localStorage 中
 */
export class LocalStorageSyncManager {
  constructor(api = null) {
    this.api = api;
    this.syncService = new SyncService('sync-queue', api);
  }

  /**
   * 捕獲本地更改並加入同步隊列
   */
  captureLocalChange(type, data, endpoint, method = 'POST') {
    const item = {
      type,
      data,
      endpoint,
      method,
      local_uuid: 'local-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
      created_at: new Date().toISOString()
    };

    return this.syncService.enqueue(item);
  }

  /**
   * 自動同步（可由應用定期調用）
   */
  async autoSync() {
    const status = this.syncService.getSyncStatus();
    
    if (status.pendingItems > 0) {
      console.log(`🔄 自動同步: ${status.pendingItems} 個待同步項目`);
      return await this.syncService.syncAll();
    }

    return [];
  }

  /**
   * 獲取同步狀態信息
   */
  getStatus() {
    return this.syncService.getSyncStatus();
  }
}
