import { access, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';

import type { Canvas } from '@napi-rs/canvas';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import Tesseract from 'tesseract.js';

interface PdfLyricOptions {
  title?: string;
  modelDirectory: string;
  signal?: AbortSignal;
  ocr?: boolean;
}

interface Fragment {
  text: string;
  x: number;
  y: number;
  height: number;
}

const han = /\p{Script=Han}/u;
const notes = /[\uE000-\uF8FF♩♪♫♬♯♭]/u;
const credits =
  /^(?:(?:作[词詞曲]|[编編]曲|[词詞]曲|[词詞曲]|版[权權])\s*[:：]|(?:lyrics|music|words)\s+by\b|copyright\b|©)/iu;

function lyricText(raw: string): string {
  let text = raw.normalize('NFC').replace(/[|\\]/gu, '').trim();
  if (notes.test(text) || credits.test(text)) return '';
  text = text
    .replace(/^\s*(?:第[零〇一二三四五六七八九十百0-9]+[节節段]|\d+[.、)](?=\s*\D))\s*/u, '')
    .replace(/(?<=\p{Script=Han})\s+(?=[\p{Script=Han}\p{P}])/gu, '')
    .replace(/(?<=\p{P})\s+(?=\p{Script=Han})/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (
    /^(?:[降升]?[A-G]?[#b]?[大小]?[调調]|[副合领領][歌唱][:：]?|chorus|verse\d*)$/iu.test(
      text.replace(/\s/gu, '')
    )
  )
    return '';
  if (han.test(text)) return text;
  // The score font exposes note glyphs as strings such as "q w e" or "zcccZ".
  const words = text.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) ?? [];
  if (!words.some((word) => word.length >= 2 && /[aeiouy]/iu.test(word))) return '';
  if ((text.match(/[\d!@#$%^&*<>]/g)?.length ?? 0) > words.length) return '';
  return text;
}

function rowsOf(fragments: Fragment[], pageHeight: number, title?: string): Fragment[] {
  const groups: Fragment[][] = [];
  for (const fragment of fragments.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = groups[groups.length - 1];
    if (row && Math.abs(fragment.y - row[0].y) < Math.min(fragment.height, row[0].height) * 0.36) {
      row.push(fragment);
    } else {
      groups.push([fragment]);
    }
  }
  const rows = groups
    .map((row) => {
      row.sort((a, b) => a.x - b.x);
      const pieces = row.filter((part, i) => {
        const prev = row[i - 1];
        return !prev || part.text !== prev.text || Math.abs(part.x - prev.x) > 0.6;
      });
      const text = lyricText(pieces.map((p) => p.text).join(' '));
      return { ...row[0], height: Math.max(...row.map((p) => p.height)), text };
    })
    .filter((row) => row.text);
  const body = rows
    .filter((row) => row.y > pageHeight * 0.25)
    .map((row) => row.height)
    .sort((a, b) => a - b);
  const median = body[Math.floor(body.length / 2)];
  const titleKey = title
    ?.normalize('NFKC')
    .replace(/[\p{P}\p{Z}]/gu, '')
    .toLowerCase();
  return rows.filter((row, index) => {
    if (index > 1 || row.y > pageHeight * 0.3) return true;
    const key = row.text
      .replace(/^[\d\s]+/u, '')
      .replace(/[\p{P}\p{Z}]/gu, '')
      .toLowerCase();
    return !(titleKey && key === titleKey) && !(median && row.height > median * 1.18);
  });
}

async function textRows(page: PDFPageProxy, title?: string): Promise<Fragment[]> {
  const viewport = page.getViewport({ scale: 1 });
  const { items } = await page.getTextContent();
  const fragments: Fragment[] = [];
  for (const item of items) {
    if (!('str' in item) || !item.str.trim() || notes.test(item.str)) continue;
    // Keep punctuation next to syllables, but skip verse/page numbers and most note-font runs.
    const text = item.str.trim();
    if (
      !han.test(text) &&
      !lyricText(text) &&
      !/^(?:[aAI]|[,，.。!！?？;；:“”‘’（）()、-]+)$/u.test(text)
    )
      continue;
    if (/^[zZcC]+$/.test(text) || (/\|/.test(text) && !han.test(text))) continue;
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    const height = Math.abs(item.height) || 1;
    // Some scores draw commas as separate objects over the middle of long text runs.
    // Position each syllable separately so the comma returns to its place in the line.
    if (han.test(text) && !/[A-Za-z]/u.test(text)) {
      const chars = Array.from(text.replace(/\s/gu, ''));
      chars.forEach((char, index) =>
        fragments.push({ text: char, x: x + (item.width * index) / chars.length, y, height })
      );
    } else {
      fragments.push({ text, x, y, height });
    }
  }
  return rowsOf(fragments, viewport.height, title);
}

type CanvasFactory = {
  create(width: number, height: number): { canvas: Canvas };
  destroy(surface: { canvas: Canvas }): void;
};

function inkBands(projection: Uint32Array, minimumInk: number, gap: number): [number, number][] {
  const bands: [number, number][] = [];
  for (let i = 0; i < projection.length; i++) {
    if (projection[i] < minimumInk) continue;
    const last = bands.at(-1);
    if (last && i <= last[1] + gap) last[1] = i + 1;
    else bands.push([i, i + 1]);
  }
  return bands;
}

// Blue slides place yellow words below white numbered notation. Detect lyric rows
// by color, then recover their strokes by luminance (JPEG edges are often nearly white).
async function scoreStrips(canvas: Canvas, factory: CanvasFactory, signal?: AbortSignal) {
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d');
  const image = ctx.getImageData(0, 0, width, height);
  const { data } = image;
  const horizontal = new Uint32Array(height);
  let blue = 0;
  let yellow = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x += 4) {
      const i = (y * width + x) * 4;
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      if (b > r + 28 && b > g + 15) blue++;
      if (r > 100 && g > 95 && Math.min(r, g) > b + 45) {
        horizontal[y]++;
        yellow++;
      }
    }
  }
  const samples = (width * height) / 4;
  if (blue < samples * 0.45 || yellow < samples * 0.002) return null;
  const bands = inkBands(horizontal, 2, Math.ceil(height / 350)).filter(([y0, y1]) => y1 - y0 > 5);
  const strips: { image: Buffer; y: number; height: number }[] = [];
  for (const [top, bottom] of bands) {
    signal?.throwIfAborted();
    const y0 = Math.max(0, top - 2),
      y1 = Math.min(height, bottom + 2);
    const rowHeight = y1 - y0;
    const vertical = new Uint32Array(width);
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const light = 0.3 * data[i] + 0.6 * data[i + 1] + 0.1 * data[i + 2];
        if (light > 107) vertical[x]++;
        data[i] = data[i + 1] = data[i + 2] = 255 - Math.max(0, Math.min(255, (light - 65) * 1.7));
      }
    }
    ctx.putImageData(image, 0, 0, 0, y0, width, rowHeight);
    const chunks = inkBands(vertical, 1, rowHeight * 0.18);
    if (!chunks.length) continue;
    // Close large gaps between syllables that are spaced to match notes in the score.
    const zoom = 45 / rowHeight;
    const stripWidth = Math.ceil(chunks.reduce((w, [a, b]) => w + (b - a) * zoom + 4, 0)) + 20;
    const strip = factory.create(stripWidth, 65);
    try {
      const target = strip.canvas.getContext('2d');
      target.fillStyle = 'white';
      target.fillRect(0, 0, stripWidth, 65);
      let x = 10;
      for (const [a, b] of chunks) {
        const chunkWidth = (b - a) * zoom;
        target.drawImage(canvas, a, y0, b - a, rowHeight, x, 10, chunkWidth, 45);
        x += chunkWidth + 4;
      }
      strips.push({ image: await strip.canvas.encode('png'), y: bottom, height: bottom - top });
    } finally {
      factory.destroy(strip);
    }
  }
  return strips;
}

async function recognize(
  worker: Tesseract.Worker,
  image: Buffer,
  blocks: boolean,
  signal?: AbortSignal
): Promise<Tesseract.Page> {
  signal?.throwIfAborted();
  const job = worker.recognize(image, {}, { blocks, text: !blocks });
  if (!signal) return (await job).data;
  // terminate() stops the thread, but does not settle a pending recognize() call.
  let cancel!: () => void;
  const interrupt = new Promise<never>((_, reject) => {
    cancel = () => reject(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
  });
  try {
    return (await Promise.race([job, interrupt])).data;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

async function recognizePage(
  pdf: PDFDocumentProxy,
  page: PDFPageProxy,
  worker: Tesseract.Worker,
  options: PdfLyricOptions
): Promise<Fragment[]> {
  const original = page.getViewport({ scale: 1 });
  const scale = Math.min(3, 2450 / Math.max(original.width, original.height));
  const viewport = page.getViewport({ scale });
  const factory = pdf.canvasFactory as CanvasFactory;
  const surface = factory.create(
    Math.max(1, Math.ceil(viewport.width)),
    Math.max(1, Math.ceil(viewport.height))
  );
  try {
    const render = page.render({
      canvas: surface.canvas as unknown as HTMLCanvasElement,
      viewport
    });
    const cancel = () => render.cancel();
    options.signal?.addEventListener('abort', cancel, { once: true });
    try {
      await render.promise;
    } finally {
      options.signal?.removeEventListener('abort', cancel);
    }
    options.signal?.throwIfAborted();
    const fragments: Fragment[] = [];
    const strips = await scoreStrips(surface.canvas, factory, options.signal);
    await worker.setParameters({
      tessedit_pageseg_mode: strips ? Tesseract.PSM.SINGLE_LINE : Tesseract.PSM.SINGLE_BLOCK,
      user_defined_dpi: '220'
    });
    if (strips) {
      for (const strip of strips) {
        const data = await recognize(worker, strip.image, false, options.signal);
        if (data.confidence >= 28)
          fragments.push({
            text: data.text.trim(),
            x: 0,
            y: strip.y / scale,
            height: strip.height / scale
          });
      }
    } else {
      const data = await recognize(
        worker,
        await surface.canvas.encode('png'),
        true,
        options.signal
      );
      for (const block of data.blocks ?? []) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) {
            if (line.confidence < 28) continue;
            const { x0, y0, y1 } = line.bbox;
            fragments.push({
              text: line.text.trim(),
              x: x0 / scale,
              y: y1 / scale,
              height: (y1 - y0) / scale
            });
          }
        }
      }
    }
    return rowsOf(fragments, original.height, options.title);
  } finally {
    factory.destroy(surface);
  }
}

async function openOcr(options: PdfLyricOptions): Promise<Tesseract.Worker> {
  const require = createRequire(typeof __filename === 'string' ? __filename : import.meta.url);
  const workerPath = require
    .resolve('tesseract.js/src/worker-script/node/index.js')
    .replace(/([/\\]app\.asar)([/\\])/u, '$1.unpacked$2');
  const languages = ['chi_sim', 'chi_tra', 'eng'];
  await Promise.all(
    languages.map((code) => access(join(options.modelDirectory, code + '.traineddata.gz')))
  );
  options.signal?.throwIfAborted();
  let reportError!: (reason: Error) => void;
  const failed = new Promise<never>((_, reject) => {
    reportError = reject;
  });
  return Promise.race([
    failed,
    Tesseract.createWorker(languages, Tesseract.OEM.LSTM_ONLY, {
      workerPath,
      langPath: options.modelDirectory,
      cacheMethod: 'none',
      errorHandler: (reason) => reportError(new Error(String(reason)))
    })
  ]);
}

export async function extractPdfLyrics(
  filePath: string,
  options: PdfLyricOptions
): Promise<string[]> {
  const { signal, title } = options;
  const task = getDocument({
    data: new Uint8Array(await readFile(filePath, { signal })),
    useSystemFonts: true
  });
  let worker: Tesseract.Worker | undefined;
  try {
    const pdf = await task.promise;
    const result: string[] = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      signal?.throwIfAborted();
      const page = await pdf.getPage(index);
      try {
        const native = await textRows(page, title);
        let rows = native;
        let hasImage = options.ocr !== false && native.length === 0;
        if (options.ocr !== false && native.length) {
          const { fnArray, argsArray } = await page.getOperatorList();
          hasImage = fnArray.some(
            (op, i) =>
              op === OPS.paintInlineImageXObject ||
              (op === OPS.paintImageXObject && argsArray[i][1] >= 180 && argsArray[i][2] >= 45)
          );
        }
        if (hasImage) {
          signal?.throwIfAborted();
          if (!worker) {
            worker = await openOcr(options);
          }
          signal?.throwIfAborted();
          const ocr = await recognizePage(pdf, page, worker, options);
          // Embedded words are more reliable than OCR on the same baseline.
          rows = [
            ...native,
            ...ocr.filter(
              (row) =>
                !native.some(
                  (known) => Math.abs(known.y - row.y) < Math.max(known.height, row.height) * 0.55
                )
            )
          ].sort((a, b) => a.y - b.y);
        }
        result.push(...rows.map((row) => row.text));
      } finally {
        page.cleanup();
      }
    }
    signal?.throwIfAborted();
    return result;
  } finally {
    await worker?.terminate();
    await task.destroy();
  }
}
export async function readScorePages(file: string, modelDirectory: string) {
  const task = getDocument({ data: new Uint8Array(await readFile(file)), useSystemFonts: true });
  let worker: Tesseract.Worker | undefined;
  const lines: string[] = [];
  let scanned = false;
  try {
    const pdf = await task.promise;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      try {
        const content = await page.getTextContent();
        const items = content.items
          .filter((item) => 'str' in item && item.str.trim())
          .map((item) => {
            if (!('str' in item)) throw Error('无效文字');
            return { s: item.str, x: item.transform[4], y: item.transform[5] };
          })
          .sort((a, b) => b.y - a.y);
        const groups: { y: number; items: typeof items }[] = [];
        for (const item of items) {
          let row = groups.at(-1);
          if (!row || Math.abs(item.y - row.y) > 3) {
            row = { y: item.y, items: [] };
            groups.push(row);
          }
          row.items.push(item);
        }
        const text = groups.map((row) =>
          row.items
            .sort((a, b) => a.x - b.x)
            .map((item) => item.s)
            .join(' ')
        );
        const ops = await page.getOperatorList();
        const image =
          ops.fnArray.includes(OPS.paintImageXObject) ||
          ops.fnArray.includes(OPS.paintInlineImageXObject);
        if (!text.length || (image && text.join('').length < 100)) {
          scanned = true;
          worker ??= await openOcr({ modelDirectory });
          const base = page.getViewport({ scale: 1 }),
            viewport = page.getViewport({
              scale: Math.min(3, 2400 / Math.max(base.width, base.height))
            });
          const factory = pdf.canvasFactory as CanvasFactory,
            surface = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
          try {
            await page.render({ canvas: surface.canvas as unknown as HTMLCanvasElement, viewport })
              .promise;
            const data = await recognize(worker, await surface.canvas.encode('png'), false);
            lines.push(...(data.text.trim() ? data.text.trim().split(/\r?\n/) : text));
          } finally {
            factory.destroy(surface);
          }
        } else {
          for (let k = 0; k < groups.length; k++) {
            const row = groups[k],
              next = groups[k + 1];
            const tokens = row.items.flatMap((item) => item.s.trim().split(/\s+/));
            const chordOnly =
              tokens.length > 0 &&
              tokens.every((t) =>
                /^[A-G][#b♯♭]?(?:maj|min|sus|dim|aug|add|m)?\d*(?:\/[A-G][#b♯♭]?)?$/.test(t)
              );
            if (
              chordOnly &&
              next &&
              /[\p{L}]/u.test(text[k + 1]) &&
              /[\p{Script=Han}a-z]{2}|[\p{Script=Han}]/u.test(text[k + 1]) &&
              row.items.every((it) => !it.s.trim().includes(' '))
            ) {
              const marks = new Map<number, string[]>();
              for (const item of row.items) {
                let ix = 0;
                for (let j = 1; j < next.items.length; j++)
                  if (Math.abs(next.items[j].x - item.x) < Math.abs(next.items[ix].x - item.x))
                    ix = j;
                marks.set(ix, [...(marks.get(ix) ?? []), item.s.trim()]);
              }
              lines.push(
                next.items
                  .map(
                    (item, ix) => (marks.get(ix) ?? []).map((c) => '[' + c + ']').join('') + item.s
                  )
                  .join(' ')
              );
              k++;
            } else lines.push(text[k]);
          }
        }
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await worker?.terminate();
    await task.destroy();
  }
  const normalized = lines.map(line=>line.normalize('NFKC').replace(/(?<=\p{Script=Han})[ \t]+(?=\p{Script=Han})/gu,''));
  const raw = normalized.join('\n'),
    tokens = raw.replace(/[|｜\[\]（）()]/g, ' ').split(/\s+/);
  const chords = tokens.filter((s) =>
    /^[A-G][#b♯♭]?(?:(?:maj|min|sus|dim|aug|add|m)\d*|[2679])?(?:\/[A-G][#b♯♭]?)?$/.test(s)
  );
  const hint = basename(file) + '\n' + raw;
  const white = /白版|白本/.test(hint) || new Set(chords).size >= 3;
  const blue =
    /蓝版|藍版/.test(hint) || /[1-7]\s*[-|]\s*[1-7]/.test(raw) || /[\uE000-\uF8FF]/.test(raw);
  const explicitWhite = /白版|白本/.test(hint),
    explicitBlue = /蓝版|藍版/.test(hint);
  const edition =
    explicitBlue && explicitWhite
      ? 'unknown'
      : explicitBlue && !explicitWhite
        ? 'blue'
        : explicitWhite && !explicitBlue
          ? 'white'
          : white
            ? 'white'
            : blue
              ? 'blue'
              : 'unknown';
  return {
    raw,
    edition,
    scanned,
    chords: [...new Set(chords)],
    author: normalized
      .map((l) => l.match(/^\s*(?:作[词詞曲]|[词詞曲]|作者)\s*[:：]\s*(.{2,80})/u)?.[1])
      .filter(Boolean)
      .join('、')
  };
}
