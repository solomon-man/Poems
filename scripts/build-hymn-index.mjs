import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import * as mm from 'music-metadata';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith('--')) continue;
  args.set(key.slice(2), process.argv[index + 1]);
  index += 1;
}

const defaultPdfRoot = path.resolve(
  import.meta.dirname,
  '../songbooks'
);
const pdfRoot = path.resolve(args.get('pdf-root') || defaultPdfRoot);
const audioRoot = args.get('audio-root') ? path.resolve(args.get('audio-root')) : null;
const outputPath = path.resolve(
  args.get('output') || path.join(import.meta.dirname, '../resources/hymn-index.json')
);

const walkFiles = async (root, extensions) => {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) return walkFiles(fullPath, extensions);
      return extensions.has(path.extname(entry.name).toLowerCase()) ? [fullPath] : [];
    })
  );
  return nested.flat();
};

const numericKey = (value) => {
  const match = value.normalize('NFKC').match(/(?:^|\D)0*(\d{1,4})(?:\D|$)/);
  return match ? String(Number(match[1])) : null;
};

const normalizeKey = (value) =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/第\s*(\d+)\s*首/g, '$1')
    .replace(/\.(mp3|pdf)$/i, '')
    .replace(/[\s_\-—()（）【】\[\].·]+/g, '');

const extractPdf = async (filePath) => {
  const pdf = await getDocument({
    data: new Uint8Array(await fs.readFile(filePath)),
    useSystemFonts: true
  }).promise;
  const lines = [];
  let title = path.basename(filePath, path.extname(filePath));

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = content.items.filter((item) => 'str' in item && item.str.trim() && 'transform' in item);
    if (pageNumber === 1) {
      const titleItem = items
        .filter((item) => /[\u3400-\u9fff]/u.test(item.str))
        .sort((a, b) => b.height - a.height)[0];
      if (titleItem?.str) title = titleItem.str.trim();
    }

    const groups = new Map();
    for (const item of items) {
      const y = Math.round(item.transform[5] / 6) * 6;
      const group = groups.get(y) || [];
      group.push({ text: item.str.trim(), x: item.transform[4], height: item.height });
      groups.set(y, group);
    }

    for (const [, group] of [...groups.entries()].sort((a, b) => b[0] - a[0])) {
      const line = group
        .filter((item) => item.height < 40 && /[\u3400-\u9fff，。！？；：“”‘’（）]/u.test(item.text))
        .sort((a, b) => a.x - b.x)
        .map((item) => item.text)
        .join('')
        .replace(/\s+/g, '')
        .replace(/[|\\]/g, '')
        .trim();
      if (
        (line.match(/[\u3400-\u9fff]/gu)?.length || 0) >= 3 &&
        !/^[降升]?[A-G]?[#b]?大?小?调$/u.test(line) &&
        !/(作词|作曲|编曲|词曲|版权)/u.test(line)
      ) {
        lines.push(line);
      }
    }
  }

  return { title, lines: [...new Set(lines)] };
};

const formatTime = (milliseconds) => {
  const hundredths = Math.max(0, Math.round(milliseconds / 10));
  const minutes = Math.floor(hundredths / 6000);
  const seconds = Math.floor((hundredths % 6000) / 100);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths % 100).padStart(2, '0')}`;
};

const buildLrc = (lines, duration) => {
  if (!lines.length) return null;
  const usableDuration = duration > 0 ? Math.max(duration - 3000, lines.length * 1500) : lines.length * 5000;
  const weights = lines.map((line) => Math.max(4, line.match(/[\u3400-\u9fffA-Za-z0-9]/gu)?.length || 4));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = duration > 0 ? Math.min(2000, duration * 0.04) : 0;
  return lines
    .map((line, index) => {
      const result = `[${formatTime(cursor)}]${line}`;
      cursor += (usableDuration * weights[index]) / totalWeight;
      return result;
    })
    .join('\n');
};

const pdfFiles = await walkFiles(pdfRoot, new Set(['.pdf']));
const audioFiles = audioRoot ? await walkFiles(audioRoot, new Set(['.mp3'])) : [];
const audioByCategoryAndNumber = new Map();
const unmatchedAudio = new Set(audioFiles);

for (const filePath of audioFiles) {
  const relativePath = path.relative(audioRoot, filePath);
  const category = relativePath.split(path.sep)[0];
  const number = numericKey(path.basename(filePath, path.extname(filePath)));
  if (number) audioByCategoryAndNumber.set(`${normalizeKey(category)}:${number}`, filePath);
}

const documents = [];
let nextIndex = 0;
const workerCount = Math.min(6, pdfFiles.length);
const workers = Array.from({ length: workerCount }, async () => {
  while (nextIndex < pdfFiles.length) {
    const current = nextIndex;
    nextIndex += 1;
    const filePath = pdfFiles[current];
    const relativePath = path.relative(pdfRoot, filePath);
    const category = relativePath.split(path.sep)[0];
    const number = path.basename(filePath, path.extname(filePath));
    const audioPath = audioByCategoryAndNumber.get(`${normalizeKey(category)}:${numericKey(number)}`) || null;
    let duration = 0;
    if (audioPath) {
      unmatchedAudio.delete(audioPath);
      try {
        const metadata = await mm.parseFile(audioPath, { skipCovers: true });
        duration = Math.round((metadata.format.duration || 0) * 1000);
      } catch {
        // Keep the matched path even when metadata cannot be parsed.
      }
    }
    try {
      const extracted = await extractPdf(filePath);
      documents[current] = {
        id: relativePath.replaceAll('\\', '/'),
        category,
        number,
        title: extracted.title,
        pdfPath: filePath,
        audioPath,
        duration,
        lines: extracted.lines,
        lrc: buildLrc(extracted.lines, duration)
      };
    } catch (error) {
      documents[current] = {
        id: relativePath.replaceAll('\\', '/'),
        category,
        number,
        title: number,
        pdfPath: filePath,
        audioPath,
        duration,
        lines: [],
        lrc: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
    if ((current + 1) % 50 === 0 || current + 1 === pdfFiles.length) {
      process.stdout.write(`\r已处理 ${current + 1}/${pdfFiles.length}`);
    }
  }
});

await Promise.all(workers);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(
  outputPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      pdfRoot,
      audioRoot,
      documentCount: documents.length,
      matchedAudioCount: documents.filter((item) => item.audioPath).length,
      unmatchedAudio: [...unmatchedAudio],
      documents
    },
    null,
    2
  ),
  'utf8'
);
process.stdout.write(`\n索引已写入 ${outputPath}\n`);
