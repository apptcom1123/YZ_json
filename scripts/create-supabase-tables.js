#!/usr/bin/env node

/**
 * 自動化創建 Supabase 表的腳本
 * 用法: node scripts/create-supabase-tables.js
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ 錯誤: 缺少環境變量');
  console.error('   請確保 .env 中設置了:');
  console.error('   - SUPABASE_URL');
  console.error('   - SUPABASE_SERVICE_KEY');
  process.exit(1);
}

// 使用 Service Key 建立連接（有完全權限）
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function createTables() {
  try {
    console.log('🚀 開始創建 Supabase 表...\n');
    
    // 讀取 SQL 文件
    const sqlFilePath = path.join(process.cwd(), 'server', 'db', 'schema-supabase.sql');
    
    if (!fs.existsSync(sqlFilePath)) {
      throw new Error(`找不到 SQL 文件: ${sqlFilePath}`);
    }
    
    const sqlContent = fs.readFileSync(sqlFilePath, 'utf-8');
    
    // 分割 SQL 語句（簡單的分割方式）
    const statements = sqlContent
      .split(';')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('--'));
    
    console.log(`📋 找到 ${statements.length} 個 SQL 語句\n`);
    
    // 逐一執行 SQL 語句
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i] + ';';
      const preview = statement.substring(0, 60).replace(/\n/g, ' ');
      
      try {
        const { data, error } = await supabase.rpc('exec_sql', {
          sql: statement
        });
        
        if (error) {
          // 嘗試用另一種方式執行（直接通過 SQL 查詢）
          // 注意: Supabase 不提供直接的 SQL 執行端點給 anon keys
          // 所以我們使用 supabase-js 的方式
          
          // 對於 CREATE TABLE，我們需要使用不同的方法
          // 實際上，Supabase JS 客戶端無法直接執行任意 SQL
          // 必須使用 SQL 編輯器或 PostgreSQL 客戶端
          
          console.log(`⚠️  ${i + 1}/${statements.length} 無法執行: ${preview}...`);
          console.log(`    原因: ${error.message}\n`);
          errorCount++;
        } else {
          console.log(`✅ ${i + 1}/${statements.length} 成功: ${preview}...`);
          successCount++;
        }
      } catch (err) {
        console.log(`❌ ${i + 1}/${statements.length} 錯誤: ${err.message}\n`);
        errorCount++;
      }
    }
    
    console.log(`\n📊 執行結果:`);
    console.log(`   ✅ 成功: ${successCount}`);
    console.log(`   ❌ 失敗: ${errorCount}`);
    
    if (errorCount > 0) {
      console.log(`\n⚠️  Supabase JS 客戶端無法執行 DDL (CREATE TABLE) 語句`);
      console.log(`\n請改用以下方法:\n`);
      console.log(`方法 1: 在 Supabase 儀表板執行`);
      console.log(`  1. 打開 https://app.supabase.com/project/tppijacljktspgbiphml/sql/new`);
      console.log(`  2. 粘貼 server/db/schema-supabase.sql 的內容`);
      console.log(`  3. 點擊 Run\n`);
      
      console.log(`方法 2: 用 psql 或 PostgreSQL 客戶端`);
      console.log(`  1. 安裝 PostgreSQL 客戶端`);
      console.log(`  2. 運行: psql -h tppijacljktspgbiphml.supabase.co -U postgres -d postgres < server/db/schema-supabase.sql\n`);
      
      process.exit(1);
    }
    
    console.log(`\n✨ 所有表創建成功！`);
    
  } catch (err) {
    console.error(`\n❌ 錯誤: ${err.message}`);
    process.exit(1);
  }
}

createTables();
