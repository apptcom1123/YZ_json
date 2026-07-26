#!/usr/bin/env node
/**
 * 簡化的構建腳本 - 用於開發時 dist 文件夾被鎖定的情況
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

// 嘗試遞歸刪除 dist 文件夾
function removeDistSafely() {
  if (fs.existsSync(dist)) {
    try {
      // 延遲以確保文件不被鎖定
      setTimeout(() => {
        fs.rmSync(dist, { recursive: true, force: true });
        buildDist();
      }, 100);
    } catch (err) {
      console.warn('⚠️ 無法刪除舊 dist 文件夾，嘗試覆蓋...');
      buildDist();
    }
  } else {
    buildDist();
  }
}

function buildDist() {
  const required = [
    path.join(root, 'public'),
    path.join(root, 'iching', 'iching.json'),
    path.join(root, 'image'),
    path.join(root, 'md'),
  ];

  for (const source of required) {
    if (!fs.existsSync(source)) {
      throw new Error(`缺少建置來源：${path.relative(root, source)}`);
    }
  }

  // 建立 dist 目錄
  if (!fs.existsSync(dist)) {
    fs.mkdirSync(dist, { recursive: true });
  }

  fs.cpSync(path.join(root, 'public'), dist, { recursive: true });

  fs.mkdirSync(path.join(dist, 'data'), { recursive: true });
  fs.copyFileSync(
    path.join(root, 'iching', 'iching.json'),
    path.join(dist, 'data', 'iching.json'),
  );

  fs.cpSync(path.join(root, 'image'), path.join(dist, 'image'), { recursive: true });
  fs.cpSync(path.join(root, 'md'), path.join(dist, 'texts'), { recursive: true });

  const imageCount = fs.readdirSync(path.join(dist, 'image'), { withFileTypes: true })
    .filter((entry) => entry.isFile()).length;
  const textCount = fs.readdirSync(path.join(dist, 'texts'), { withFileTypes: true })
    .filter((entry) => entry.isFile()).length;

  console.log(`✓ 建置完成：dist（${imageCount} 張圖片、${textCount} 份文字）`);
}

removeDistSafely();
