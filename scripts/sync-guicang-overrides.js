import fs from 'node:fs';
import vm from 'node:vm';

const builder = fs.readFileSync('scripts/build-classics-json.js', 'utf8');
const start = builder.indexOf('const plainMeaningOverrides = new Map([');
const end = builder.indexOf('\n]);', start);
if (start < 0 || end < 0) throw new Error('找不到 plainMeaningOverrides');
const source = builder.slice(start + 'const plainMeaningOverrides = '.length, end + 3);
const overrides = vm.runInNewContext(source);
const file = 'classics/wangjiatai_guicang_excerpt.json';
const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
let changed = 0;
for (const entry of doc.entries) {
  const value = overrides.get(entry.text);
  if (value && entry.context.plain_meaning !== value) {
    entry.context.plain_meaning = value;
    entry.context.summary = value;
    changed += 1;
  }
}
fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
console.log(`同步 ${changed} 條，總數 ${doc.entries.length}`);
