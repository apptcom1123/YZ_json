import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

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

fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), dist, { recursive: true });

fs.mkdirSync(path.join(dist, 'data'), { recursive: true });
fs.copyFileSync(
  path.join(root, 'iching', 'iching.json'),
  path.join(dist, 'data', 'iching.json'),
);

fs.cpSync(path.join(root, 'image'), path.join(dist, 'image'), { recursive: true });
fs.cpSync(path.join(root, 'md'), path.join(dist, 'texts'), { recursive: true });
fs.mkdirSync(path.join(dist, 'vendor', 'supabase'), { recursive: true });
fs.copyFileSync(
  path.join(root, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js'),
  path.join(dist, 'vendor', 'supabase', 'supabase.js'),
);

const publicSupabaseConfig = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabasePublishableKey: process.env.SUPABASE_KEY,
};

if (!publicSupabaseConfig.supabaseUrl || !publicSupabaseConfig.supabasePublishableKey) {
  throw new Error('SUPABASE_URL and SUPABASE_KEY are required to build the frontend.');
}

fs.writeFileSync(
  path.join(dist, 'supabase-config.js'),
  `window.__SUPABASE_CONFIG__ = Object.freeze(${JSON.stringify(publicSupabaseConfig)});\n`,
);

const imageCount = fs.readdirSync(path.join(dist, 'image'), { withFileTypes: true })
  .filter((entry) => entry.isFile()).length;
const textCount = fs.readdirSync(path.join(dist, 'texts'), { withFileTypes: true })
  .filter((entry) => entry.isFile()).length;

console.log(`Vercel 靜態建置完成：dist（${imageCount} 張圖片、${textCount} 份文字）`);
