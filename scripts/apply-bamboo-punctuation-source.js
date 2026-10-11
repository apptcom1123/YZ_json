import fs from 'node:fs';

const file = 'classics/zhushu_jinian_siku.json';
const pages = ['五帝紀', '夏紀', '殷紀', '周紀'];
const api = 'https://zh.wikisource.org/w/api.php?action=parse&prop=wikitext&format=json&page=';

function cleanWiki(s) {
  return s
    .replace(/<!--.*?-->/gs, '')
    .replace(/\{\{.*?\}\}/gs, '')
    .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, '')
    .trim();
}

function key(s) {
  return s.replace(/[\s，。；：！？「」『』（）〈〉《》〔〕【】…“”‘’、—「」]/gu, '');
}

const candidates = new Map();
for (const page of pages) {
  const u = api + encodeURIComponent(`今本竹書紀年/${page}`);
  const data = await (await fetch(u)).json();
  const raw = data.parse?.wikitext?.['*'] || '';
  for (const line of raw.split(/\r?\n/)) {
    const text = cleanWiki(line);
    if (!text || text.startsWith('=') || text.startsWith('|') || text.startsWith('{')) continue;
    const k = key(text);
    if (k.length >= 12) candidates.set(k, text);
  }
}

const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
let matched = 0;
for (const entry of doc.entries) {
  const found = candidates.get(key(entry.text));
  if (found) {
    entry.punctuated_text = found;
    entry.punctuation_status = 'source_aligned';
    matched += 1;
  }
}
fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
console.log(JSON.stringify({ file, matched, total: doc.entries.length, remaining: doc.entries.length - matched }, null, 2));
