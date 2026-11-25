import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { app, dialog, ipcMain } from 'electron';

import {
  applyLyricsReview, buildTimedLyrics, loadRecognition, storeRecognition,
  type SavedLyrics, type SongFiles, type SongLookup
} from './recognizedLyrics';
import type { ApplyLyricsReviewRequest } from '../../shared/localAi';
import type { LyricsRecognitionRequest, LyricsRecognitionResult } from '../../shared/hymnLibrary';
import { transcribeAudioToLrc } from './audioTranscription';

export const ocrModelDirectory = () =>
  app.isPackaged
    ? join(process.resourcesPath, 'ocr-data')
    : join(__dirname, '../../build/ocr-data');

async function recognize(
  request: LyricsRecognitionRequest,
  lookup: SongLookup,
  signal: AbortSignal
): Promise<LyricsRecognitionResult> {
  if (!request || !['audio', 'pdf'].includes(request.source)) throw new Error('请选择音频或 PDF');
  const { source, documentId } = request;
  let filePath: string;
  let song: SongFiles | undefined;
  if (documentId !== undefined) {
    if (typeof documentId !== 'string') throw new Error('无效的诗歌编号');
    song = await lookup(documentId);
    if (!song) throw new Error('诗歌已移除，请刷新诗歌本');
    const selected = song[source];
    if (!selected) throw new Error('请先为这首诗歌匹配音频');
    filePath = selected;
  } else {
    const audio = source === 'audio';
    const picked = await dialog.showOpenDialog({
      title: audio ? '选择要识别的音频' : '选择要识别的歌谱',
      properties: ['openFile'],
      filters: audio
        ? [{ name: '音频', extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wma'] }]
        : [{ name: 'PDF 歌谱', extensions: ['pdf'] }]
    });
    if (picked.canceled || !picked.filePaths.length) return { canceled: true };
    filePath = picked.filePaths[0];
  }
  signal.throwIfAborted();
  const before = await fs.stat(filePath);
  let saved: SavedLyrics;
  let result: LyricsRecognitionResult;
  if (source === 'audio') {
    const lrc = (await transcribeAudioToLrc(filePath, signal)).trim();
    if (!lrc) return { message: '没有识别到可用的人声歌词' };
    saved = { source, path: filePath, size: before.size, mtimeMs: before.mtimeMs, lrc };
    result = { lrc, text: lrc.replace(/^\[\d+:\d+(?:[.:]\d+)?\]\s*/gm, ''), timing: 'recognized' };
  } else {
    const lines = await (await import('./pdfLyrics')).extractPdfLyrics(filePath, {
      title: song?.title,
      modelDirectory: ocrModelDirectory(),
      signal
    });
    if (!lines.length) return { message: '这份 PDF 中未识别到可用歌词' };
    const lrc = song && song.duration > 0 ? buildTimedLyrics(lines, song.duration) : null;
    saved = { source, lines };
    result = { text: lines.join('\n'), lrc: lrc ?? undefined, timing: lrc ? 'estimated' : 'none' };
  }
  signal.throwIfAborted();
  if (documentId && song) {
    const current = await lookup(documentId);
    const after = await fs.stat(filePath);
    if (
      current?.[source] !== filePath ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    )
      throw new Error('识别期间源文件已更改，请重新识别');
    await storeRecognition(documentId, saved, signal);
  }
  return result;
}

export function initializeLyricsRecognition(lookup: SongLookup) {
  let active: { senderId: number; controller: AbortController } | undefined;
  ipcMain.handle('hymn-library:cancel-recognition', (event) => {
    if (active?.senderId === event.sender.id) active.controller.abort();
  });
  app.on('before-quit', () => active?.controller.abort());
  ipcMain.handle('hymn-library:recognize', async (event, request: LyricsRecognitionRequest) => {
    if (active) return { message: '正在识别另一份歌词，请稍后重试' };
    const controller = new AbortController();
    active = { senderId: event.sender.id, controller };
    const abort = () => controller.abort();
    event.sender.once('destroyed', abort);
    try {
      return await recognize(request, lookup, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return { canceled: true };
      return { message: error instanceof Error ? error.message : '歌词识别失败' };
    } finally {
      event.sender.removeListener('destroyed', abort);
      active = undefined;
    }
  });
  ipcMain.handle('hymn-library:load-lyrics', async (_, id: string) => {
    if (typeof id !== 'string' || !id) return null;
    const song = await lookup(id);
    return song ? loadRecognition(id, song.audio, song.duration) : null;
  });
  ipcMain.handle('local-ai:apply-review', async (_, request: ApplyLyricsReviewRequest) => {
    try {
      return await applyLyricsReview(request, lookup);
    } catch (error) {
      return { message: error instanceof Error ? error.message : '无法采用校对结果' };
    }
  });
  ipcMain.handle('hymn-library:save-lyrics', async (_, content: string, format: string) => {
    if (!['txt', 'lrc'].includes(format) || typeof content !== 'string' || !content.trim())
      throw new Error('没有可导出的歌词');
    const choice = await dialog.showSaveDialog({
      title: '导出歌词',
      defaultPath: '歌词.' + format,
      filters: [{ name: format === 'lrc' ? 'LRC 时间轴歌词' : '纯文本歌词', extensions: [format] }]
    });
    if (choice.canceled || !choice.filePath) return false;
    await fs.writeFile(choice.filePath, content, 'utf8');
    return true;
  });
}
