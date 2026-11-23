import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';

import type { AppliedLyricsResult, ApplyLyricsReviewRequest } from '../../shared/localAi';
import type { LyricsRecognitionResult } from '../../shared/hymnLibrary';

export type SongFiles = { pdf: string; audio?: string; duration: number; title: string };
export type SongLookup = (id: string) => Promise<SongFiles | undefined>;
export type SavedLyrics =
  | { source: 'pdf'; lines: string[]; timingLines?: string[] }
  | { source: 'audio'; path: string; size: number; mtimeMs: number; lrc: string };

const cachePath = (id: string) =>
  join(
    app.getPath('userData'),
    'HymnLyrics',
    createHash('sha1').update(id).digest('hex') + '.json'
  );

export function buildTimedLyrics(lines: string[], duration: number): string | null {
  if (!lines.length) return null;
  const start = duration > 0 ? Math.min(2000, duration * 0.04) : 0;
  const available = duration > 0 ? duration - start : lines.length * 5000;
  const weights = lines.map((line) => Math.max(4, Array.from(line.replace(/\s/g, '')).length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = start;
  return lines
    .map((line, index) => {
      const ticks = Math.floor(cursor / 10);
      cursor += (available * weights[index]) / total;
      const pad = (value: number) => String(value).padStart(2, '0');
      return `[${pad(Math.floor(ticks / 6000))}:${pad(Math.floor(ticks / 100) % 60)}.${pad(ticks % 100)}]${line}`;
    })
    .join('\n');
}

const timestamp = /^(?:\[\d+:\d{2}(?:[.:]\d+)?\])+/;
const splitLines = (value: string) => value.split(/\r\n|\n|\r/);

function replaceTimedText(lrc: string, lines: string[]): string {
  const timed = splitLines(lrc);
  if (timed.length !== lines.length) throw new Error('歌词和时间轴行数不一致');
  return timed
    .map((line, i) => {
      const prefix = timestamp.exec(line)?.[0];
      if (!prefix) throw new Error('歌词时间戳格式异常');
      return prefix + lines[i];
    })
    .join('\n');
}

async function readRecord(id: string): Promise<SavedLyrics | null> {
  try {
    return JSON.parse(await fs.readFile(cachePath(id), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      console.warn('[lyrics] 读取识别结果失败', error);
    return null;
  }
}

async function displayRecord(
  saved: SavedLyrics,
  audio: string | undefined,
  duration: number,
  playback: boolean
): Promise<(LyricsRecognitionResult & { source: 'audio' | 'pdf' }) | null> {
  if (saved.source === 'pdf') {
    const text = saved.lines.join('\n');
    const timed =
      (duration > 0 || playback) && buildTimedLyrics(saved.timingLines ?? saved.lines, duration);
    return {
      source: 'pdf',
      text,
      lrc: timed ? replaceTimedText(timed, saved.lines) : undefined,
      timing: timed ? 'estimated' : 'none'
    };
  }
  if (saved.source !== 'audio' || !audio || saved.path !== audio) return null;
  const stat = await fs.stat(audio).catch(() => null);
  if (!stat || stat.size !== saved.size || stat.mtimeMs !== saved.mtimeMs) return null;
  return {
    source: 'audio',
    text: splitLines(saved.lrc)
      .map((line) => line.replace(timestamp, '').trimStart())
      .join('\n'),
    lrc: saved.lrc,
    timing: 'recognized'
  };
}

export async function loadRecognition(
  id: string,
  audio: string | undefined,
  duration: number,
  playback = false
) {
  const saved = await readRecord(id);
  return saved ? displayRecord(saved, audio, duration, playback) : null;
}

export async function readRecognizedLyrics(id: string, audio: string, duration: number) {
  return (await loadRecognition(id, audio, duration, true))?.lrc ?? null;
}

// Keep the comparison and replacement of a recognition result in the same write queue.
let pendingWrites: Promise<void> = Promise.resolve();
function serializeWrite<T>(action: () => Promise<T>): Promise<T> {
  const result = pendingWrites.then(action);
  pendingWrites = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

async function writeRecord(id: string, saved: SavedLyrics, signal?: AbortSignal) {
  const target = cachePath(id);
  const temp = target + '.' + randomUUID() + '.tmp';
  await fs.mkdir(dirname(target), { recursive: true });
  try {
    await fs.writeFile(temp, JSON.stringify(saved), 'utf8');
    signal?.throwIfAborted();
    await fs.rename(temp, target);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

export function storeRecognition(id: string, saved: SavedLyrics, signal: AbortSignal) {
  return serializeWrite(() => writeRecord(id, saved, signal));
}

export async function applyLyricsReview(
  request: ApplyLyricsReviewRequest,
  lookup: SongLookup
): Promise<AppliedLyricsResult> {
  const { documentId, originalText, originalLrc, lines } = request;
  if (
    typeof originalText !== 'string' ||
    !originalText.trim() ||
    !Array.isArray(lines) ||
    splitLines(originalText).length !== lines.length ||
    !lines.every((line) => typeof line === 'string' && !/[\r\n]/.test(line))
  ) {
    throw new Error('校对结果行数或格式异常');
  }
  const text = lines.join('\n');
  const lrc = originalLrc === undefined ? undefined : replaceTimedText(originalLrc, lines);
  if (documentId === undefined) return { text, lrc };
  if (!documentId || typeof documentId !== 'string') throw new Error('无效的诗歌编号');
  return serializeWrite(async () => {
    const song = await lookup(documentId);
    const saved = await readRecord(documentId);
    if (!song || !saved) throw new Error('未找到这份识别结果，请重新打开诗歌');
    const current = await displayRecord(saved, song.audio, song.duration, false);
    if (!current || current.text !== originalText || current.lrc !== originalLrc)
      throw new Error('原歌词或音频已更新，请重新打开诗歌后再校对');
    if (saved.source === 'audio') {
      if (lrc === undefined) throw new Error('缺少音频时间轴');
      await writeRecord(documentId, { ...saved, lrc });
    } else {
      await writeRecord(documentId, {
        ...saved,
        lines,
        timingLines: saved.timingLines ?? saved.lines
      });
    }
    return { text, lrc };
  });
}
