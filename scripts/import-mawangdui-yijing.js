import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// 先把來源全文轉為繁體；◎、□、括號中的字形說明全部保留。
execFileSync('python', ['-c', [
  'from pathlib import Path',
  'from opencc import OpenCC',
  "p=Path('ToDO.txt')",
  "p.write_text(OpenCC('s2t').convert(p.read_text(encoding='utf-8')), encoding='utf-8')",
].join(';')], { stdio: 'inherit' });

const source = fs.readFileSync('ToDO.txt', 'utf8');
const hexagrams = JSON.parse(fs.readFileSync('iching/iching.json', 'utf8'));
const headings = [...source.matchAll(/《([^》]+)》/g)];
const labelPattern = /(初九|九二|九三|九四|九五|上九|用九|尚九|迵九|初六|六二|六三|六四|六五|上六|用六|尚六|迵六|五五|九□|□三|□五|六□|□□)\s*[：:]/g;
const normalize = value => value.replace(/\s+/g, ' ').trim();
const headingAliases = new Map([['習坎', '坎'], ['咸', '鹹'], ['遁', '遯']]);
const reports = [];

for (let index = 0; index < hexagrams.length; index += 1) {
  const hexagram = hexagrams[index];
  for (const line of hexagram.lines) delete line.silk_scripture;
  const heading = headings.find(item => item[1] === hexagram.name || item[1] === headingAliases.get(hexagram.name));
  const nextHeading = headings.find(item => item.index > (heading?.index ?? -1));
  if (!heading) {
    reports.push(`${hexagram.id} ${hexagram.name}: 找不到卦段`);
    continue;
  }
  const block = source.slice(heading.index, nextHeading?.index ?? source.length);
  const matches = [...block.matchAll(labelPattern)].map(match => ({ label: match[1], index: match.index, length: match[0].length }));
  const expected = hexagram.lines.length;
  let cursor = 0;
  let matchedLines = 0;
  for (let lineIndex = 0; lineIndex < expected; lineIndex += 1) {
    const canonicalIndex = cursor;
    if (!matches[canonicalIndex]) break;
    let silkIndex = canonicalIndex + 1;
    if (silkIndex >= matches.length) break;
    // 少數原始抄錄把「傳本句」重複寫了一次，且三個標記落在同一行；跳過中間的重複標記。
    while (silkIndex + 1 < matches.length && matches[silkIndex].label === matches[canonicalIndex].label && !block.slice(matches[silkIndex].index, matches[silkIndex + 1].index).includes('\n')) silkIndex += 1;
    const end = matches[silkIndex + 1]?.index ?? block.length;
    const start = matches[silkIndex].index + matches[silkIndex].length;
    const silkText = normalize(block.slice(start, end).replace(/^[\s　]+/, '').replace(/\n\s*[☰☷☵☳☴☶☱☲].*$/s, ''));
    if (silkText) hexagram.lines[lineIndex].silk_scripture = silkText;
    cursor = silkIndex + 1;
    matchedLines += 1;
  }
  if (matchedLines === expected - 1 && matches.length >= 2) {
    const lastSilk = matches[matches.length - 1];
    const lastText = normalize(block.slice(lastSilk.index + lastSilk.length).replace(/^[\s　]+/, '').replace(/\n\s*[☰☷☵☳☴☶☱☲].*$/s, ''));
    if (lastText) {
      hexagram.lines[expected - 1].silk_scripture = lastText;
      matchedLines = expected;
    }
  }
  if (matchedLines !== expected) reports.push(`${hexagram.id} ${hexagram.name}: 成功對應 ${matchedLines}/${expected} 爻，請人工檢查殘缺標記`);
}

fs.writeFileSync('iching/iching.json', `${JSON.stringify(hexagrams, null, 2)}\n`, 'utf8');
console.log(`已更新 ${hexagrams.length} 卦；每爻新增欄位 silk_scripture。`);
if (reports.length) console.log(reports.join('\n'));
