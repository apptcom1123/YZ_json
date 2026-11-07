import fs from 'node:fs';

// The site's public-domain transcription supplies punctuation and repairs
// omissions in the unpunctuated SBCK archive. Keep the source ZIP importer
// as the reproducible base; run this afterwards to add readable punctuation.
const target = 'iching/iching.json';
const hexagrams = JSON.parse(fs.readFileSync(target, 'utf8'));
const decode = value => value
  .replace(/&#x([0-9a-f]+);/giu, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/gu, (_, decimal) => String.fromCodePoint(Number(decimal)))
  .replace(/&(nbsp|amp|lt|gt|quot|ldquo|rdquo|lsquo|rsquo|hellip);/gu, (_, name) => ({
    nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…',
  })[name]);

function paragraphs(html) {
  const start = html.indexOf('field--name-body');
  if (start < 0) throw new Error('Missing article body');
  const body = html.slice(html.indexOf('>', start) + 1).split('</div>')[0];
  return [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/giu)]
    .map(match => decode(match[1].replace(/<br\s*\/?>/giu, '\n').replace(/<[^>]+>/gu, '')).replace(/[ \t\r\n]+/gu, ' ').trim())
    .filter(Boolean);
}

async function fetchHexagram(hexagram) {
  const url = `https://www.eee-learning.com/book/wangbe${String(hexagram.id).padStart(2, '0')}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${hexagram.name}: HTTP ${response.status}`);
  const parts = paragraphs(await response.text());
  let current = -1;
  const notes = Array.from({ length: hexagram.lines.length + 1 }, () => []);
  const found = [];
  for (const part of parts) {
    const heading = part.match(/^(初[九六]|[九六][二三四五]|上[九六]|用[九六])\s*[，,：:]/u)
      ?? (hexagram.id === 1 ? part.match(/(初九)\s*[，,：:]/u) : null);
    if (heading) {
      const label = hexagram.id === 53 && heading[1] === '六三' ? '九三' : heading[1];
      const index = hexagram.lines.findIndex(line => line.name === label);
      if (index >= 0) { current = index; found.push(label); }
    } else if (hexagram.id === 1 && /^(?:《彖》|彖曰)/u.test(part)) {
      current = -1;
    }
    const annotation = part.match(/^(?:[【〖]注[】〗]|注云[：:]|注[：:])\s*(.+)/u);
    if (annotation) notes[current + 1].push(annotation[1]);
  }
  const missingHeadings = hexagram.lines.filter(line => !found.includes(line.name)).map(line => line.name);
  return { id: hexagram.id, url, notes, missingHeadings };
}

const results = [];
for (let i = 0; i < hexagrams.length; i += 8) {
  results.push(...await Promise.all(hexagrams.slice(i, i + 8).map(fetchHexagram)));
}

let updated = 0;
let empty = 0;
for (const { id, url, notes, missingHeadings } of results) {
  const hexagram = hexagrams[id - 1];
  if (missingHeadings.length) console.log(`${id} ${hexagram.name}: missing headings ${missingHeadings.join(', ')}`);
  const items = [hexagram, ...hexagram.lines];
  for (let index = 0; index < items.length; index += 1) {
    if (!notes[index].length) {
      if (items[index].wangbi_note) console.log(`${id} ${hexagram.name} ${index ? hexagram.lines[index - 1].name : '卦'}: no punctuated counterpart (${items[index].wangbi_note.length} source characters)`);
      empty++;
      continue;
    }
    const punctuated = notes[index].join('\n\n');
    const originalSize = items[index].wangbi_note.replace(/[^\p{Script=Han}]/gu, '').length;
    const punctuatedSize = punctuated.replace(/[^\p{Script=Han}]/gu, '').length;
    if (originalSize > 15 && (punctuatedSize > originalSize * 1.8 || punctuatedSize < originalSize * .45)) {
      console.log(`${id} ${hexagram.name} ${index ? hexagram.lines[index - 1].name : '卦'}: review length ${originalSize} -> ${punctuatedSize}`);
    }
    items[index].wangbi_note = punctuated;
    updated++;
  }
  if (process.argv.includes('--verbose')) console.log(`${id} ${hexagram.name}: ${notes.map(part => part.length).join('/')} notes (${url})`);
}
console.log(`Punctuated ${updated} annotations; ${empty} entries have no annotation on the comparison site.`);
if (process.argv.includes('--sample')) {
  for (const id of [1, 19, 62]) {
    const hexagram = hexagrams[id - 1];
    console.log(id, hexagram.name, hexagram.wangbi_note.slice(0, 350));
    console.log(hexagram.lines[1].name, hexagram.lines[1].wangbi_note.slice(0, 350));
  }
}
if (process.argv.includes('--write')) fs.writeFileSync(target, `${JSON.stringify(hexagrams, null, 2)}\n`, 'utf8');
