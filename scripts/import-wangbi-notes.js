import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// Read only Wang Bi's six hexagram volumes; the later volumes belong to Han Kangbo.
const zip = 'KR1a0006-master.zip';
const target = 'iching/iching.json';
const hexagrams = JSON.parse(fs.readFileSync(target, 'utf8'));
const volumes = Array.from({ length: 6 }, (_, index) => {
  const file = `KR1a0006-master/KR1a0006_${String(index + 1).padStart(3, '0')}.txt`;
  return execFileSync('tar', ['-xOf', zip, file], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
});

const chunks = volumes.flatMap((volume, volumeIndex) => {
  const starts = [...volume.matchAll(/[\u4dc0-\u4dff]/gu)].map(match => ({ index: match.index, symbol: match[0] }));
  return starts.map((start, index) => ({
    volume: volumeIndex + 1,
    symbol: start.symbol,
    text: volume.slice(start.index, starts[index + 1]?.index ?? volume.length),
  }));
});
if (chunks.length !== hexagrams.length) throw new Error(`Expected 64 hexagrams; found ${chunks.length}`);

function normalizedChunk(raw) {
  return raw.replace(/<pb:[^>]+>/gu, '').replace(/¶/gu, '').replace(/\s+/gu, '').replace(/𥘉/gu, '初').replace(/周易卷第[一二三四五六].*$/u, '');
}

function extractNotes(section) {
  const comments = [...section.matchAll(/\(([^)]*)\)/gu)].filter(match => match.index !== 1);
  const groups = [];
  for (const match of comments) {
    const value = match[1].replace(/\//gu, '').replace(/&KR(\d+);/gu, '〔缺字 $1〕').trim();
    if (!value) continue;
    const last = groups.at(-1);
    if (last && last.end === match.index) {
      last.value += value;
      last.end = match.index + match[0].length;
    } else {
      groups.push({ value, end: match.index + match[0].length });
    }
  }
  return groups.map(group => group.value).join('\n\n');
}

const report = [];
let guaCount = 0;
let lineCount = 0;
for (let index = 0; index < chunks.length; index += 1) {
  const hexagram = hexagrams[index];
  const chunk = chunks[index];
  const source = normalizedChunk(chunk.text);
  const mask = source.replace(/\([^)]*\)/gu, match => ' '.repeat(match.length));
  const expectedSymbol = String.fromCodePoint(0x4dc0 + index);
  if (chunk.symbol !== expectedSymbol) report.push(`${hexagram.name}: source symbol ${chunk.symbol} differs from ${expectedSymbol}`);
  // Qian places its Tuan, Xiang and Wenyan after the six lines.
  const qianEnd = index === 0 ? mask.indexOf('彖曰') : source.length;
  const lineNames = new Set(hexagram.lines.map(line => line.name));
  const labels = [...mask.slice(0, qianEnd).matchAll(/初[九六]|[九六][二三四五]|上[九六]|用[九六]/gu)]
    .filter(match => lineNames.has(match[0]) && mask.slice(Math.max(0, match.index - 2), match.index) !== '象曰');
  const boundaries = new Map();
  let lastIndex = -1;
  for (const label of labels) {
    const lineIndex = hexagram.lines.findIndex(line => line.name === label[0]);
    if (lineIndex > lastIndex) {
      boundaries.set(lineIndex, label.index);
      lastIndex = lineIndex;
    }
  }
  const first = boundaries.values().next().value ?? source.length;
  const guaSections = [source.slice(0, first)];
  if (index === 0) {
    if (qianEnd >= 0) guaSections.push(source.slice(qianEnd));
  }
  const guaNote = guaSections.map(extractNotes).filter(Boolean).join('\n\n');
  if (guaNote) guaCount += 1;
  else report.push(`${hexagram.name}: no hexagram note`);
  hexagram.wangbi_note = guaNote;
  hexagram.lines.forEach((line, lineIndex) => {
    const start = boundaries.get(lineIndex);
    const next = [...boundaries.entries()].find(([position]) => position > lineIndex)?.[1];
    const end = next ?? qianEnd;
    const note = start === undefined ? '' : extractNotes(source.slice(start, end < 0 ? source.length : end));
    if (note) lineCount += 1;
    else report.push(`${hexagram.name} ${line.name}: no line note`);
    line.wangbi_note = note;
  });
}

console.log(`Hexagram notes: ${guaCount}/64; line notes: ${lineCount}/${hexagrams.reduce((sum, x) => sum + x.lines.length, 0)}`);
if (report.length) console.log(report.join('\n'));
if (process.argv.includes('--sample')) {
  for (const id of [1, 2, 19, 48, 61, 62, 64]) {
    const hexagram = hexagrams[id - 1];
    console.log(`SAMPLE ${id} ${hexagram.name} GUA`, hexagram.wangbi_note.slice(0, 600));
    for (const line of hexagram.lines.slice(0, 2)) console.log(line.name, line.wangbi_note.slice(0, 300));
  }
}
if (process.argv.includes('--write')) {
  fs.writeFileSync(target, `${JSON.stringify(hexagrams, null, 2)}\n`, 'utf8');
  console.log(`Updated ${target}`);
}
