import { registerServiceTools } from './serviceTools';
import { loadRecognition, storeRecognition } from './recognizedLyrics';
import { createHash, randomUUID } from 'crypto';
import { app, dialog, ipcMain, shell } from 'electron';
import { promises as fs } from 'fs';
import * as mm from 'music-metadata';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'path';
import { initializeLyricsRecognition, ocrModelDirectory } from './lyricsRecognition';
import { buildTimedLyrics, readRecognizedLyrics } from './recognizedLyrics';
import { extractPdfLyrics, readScorePages, renderScorePage } from './pdfLyrics';

import type {
  CustomHymnBook,
  HymnDocument,
  HymnImportResult,
  HymnLibraryResult,
  HymnPlayback
} from '../../shared/hymnLibrary';

type StoredDocument = {
  id: string;
  bookId: string;
  title: string;
  number: string;
  fileName: string;
};

type AudioLink = {
  authors?: string[];
  path: string;
  duration: number;
  title: string;
  artist: string;
};

type HymnManifest = {
  books: CustomHymnBook[];
  documents: StoredDocument[];
  audioLinks: Record<string, AudioLink>;
};

type ResolvedDocument = HymnDocument & { filePath: string };

const EMPTY_MANIFEST: HymnManifest = { books: [], documents: [], audioLinks: {} };

const getBuiltinRoot = (): string =>
  app.isPackaged ? join(process.resourcesPath, 'hymns') : join(app.getAppPath(), 'songbooks');
const getCustomRoot = (): string => join(app.getPath('userData'), 'CustomHymnLibrary');
const getManifestPath = (): string => join(getCustomRoot(), 'library.json');
const getLyricsRoot = (): string => join(app.getPath('userData'), 'HymnLyrics');

const isInsideRoot = (root: string, candidate: string): boolean => {
  const relativePath = relative(resolve(root), resolve(candidate));
  return relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
};

const readManifest = async (): Promise<HymnManifest> => {
  try {
    const raw = await fs.readFile(getManifestPath(), 'utf8');
    const data = JSON.parse(raw) as Partial<HymnManifest>;
    return {
      books: Array.isArray(data.books) ? data.books : [],
      documents: Array.isArray(data.documents) ? data.documents : [],
      audioLinks: data.audioLinks && typeof data.audioLinks === 'object' ? data.audioLinks : {}
    };
  } catch {
    return structuredClone(EMPTY_MANIFEST);
  }
};

const writeManifest = async (manifest: HymnManifest): Promise<void> => {
  await fs.mkdir(getCustomRoot(), { recursive: true });
  const target = getManifestPath();
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(manifest, null, 2), 'utf8');
  await fs.rename(temporary, target);
};

const walkFiles = async (directory: string, extensions: readonly string[]): Promise<string[]> => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) return await walkFiles(fullPath, extensions);
      return extensions.includes(extname(entry.name).toLowerCase()) ? [fullPath] : [];
    })
  );
  return files.flat();
};

const numberCollator = new Intl.Collator('zh-CN', { numeric: true });
const categoryCollator = new Intl.Collator('zh-CN');
const naturalSort = (a: HymnDocument, b: HymnDocument): number =>
  a.category === b.category
    ? numberCollator.compare(a.number, b.number)
    : categoryCollator.compare(a.category, b.category);

const lyricsCachePath = (documentId: string): string =>
  join(getLyricsRoot(), `${createHash('sha1').update(documentId).digest('hex')}.lrc`);

const buildBuiltinDocuments = async (manifest: HymnManifest): Promise<ResolvedDocument[]> => {
  const root = getBuiltinRoot();
  const files = await walkFiles(root, ['.pdf']);
  return files.map((filePath) => {
    const relativePath = relative(root, filePath);
    const pathParts = relativePath.split(sep);
    const fileName = pathParts.at(-1) ?? '';
    const number = fileName.replace(/\.pdf$/i, '');
    const id = `builtin:${relativePath.replaceAll('\\', '/')}`;
    const audio = manifest.audioLinks[id];
    return {
      id,
      category: pathParts[0] ?? '其他',
      title: number,
      number,
      relativePath,
      source: 'builtin',
      hasAudio: Boolean(audio),
      authors: audio?.authors,
      performer: audio?.artist==='诗歌本'?undefined:audio?.artist,
      audioFileName: audio ? basename(audio.path) : undefined,
      lyricsReady: false,
      filePath
    };
  });
};

const buildCustomDocuments = async (manifest: HymnManifest): Promise<ResolvedDocument[]> => {
  const books = new Map(manifest.books.map((book) => [book.id, book]));
  return await Promise.all(
    manifest.documents.map(async (document) => {
      const book = books.get(document.bookId);
      const filePath = join(getCustomRoot(), document.bookId, document.fileName);
      const audio = manifest.audioLinks[document.id];
      let lyricsReady = false;
      try {
        await fs.access(lyricsCachePath(document.id));
        lyricsReady = true;
      } catch {
        // Lyrics are generated lazily when the hymn is first played.
      }
      return {
        id: document.id,
        category: book?.name ?? '自定义诗歌本',
        title: document.title,
        number: document.number,
        relativePath: join(book?.name ?? '自定义诗歌本', document.fileName),
        source: 'custom' as const,
        bookId: document.bookId,
        hasAudio: Boolean(audio),
      authors: audio?.authors,
      performer: audio?.artist==='诗歌本'?undefined:audio?.artist,
        audioFileName: audio ? basename(audio.path) : undefined,
        lyricsReady,
        filePath
      };
    })
  );
};

const resolveDocuments = async (manifest: HymnManifest): Promise<ResolvedDocument[]> => {
  let builtin: ResolvedDocument[] = [];
  try {
    builtin = await buildBuiltinDocuments(manifest);
  } catch (error) {
    console.error('[hymn-library] Failed to load bundled documents:', error);
  }
  const custom = await buildCustomDocuments(manifest);
  return [...builtin, ...custom].sort(naturalSort);
};

const normalizeMatchKey = (value: string): string =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/第\s*(\d+)\s*首/g, '$1')
    .replace(/\.(mp3|pdf)$/i, '')
    .replace(/[\s_\-—()（）【】\[\].·]+/g, '');

const numericKey = (value: string): string | null => {
  const match = value.normalize('NFKC').match(/(?:^|\D)0*(\d{1,4})(?:\D|$)/);
  return match ? String(Number(match[1])) : null;
};

const toAudioCandidate = (document: ResolvedDocument) => ({
  id: document.id,
  titleKey: normalizeMatchKey(document.title),
  numberKey: normalizeMatchKey(document.number),
  number: numericKey(document.number)
});

const findAudioMatch = (
  filePath: string,
  candidates: ReturnType<typeof toAudioCandidate>[]
): string | null => {
  const fileBase = basename(filePath, extname(filePath));
  const fileKey = normalizeMatchKey(fileBase);
  const fileNumber = numericKey(fileBase);
  let bestScore = 0;
  let bestId: string | null = null;
  for (const { id, titleKey, numberKey, number } of candidates) {
    let score = 0;
    if (fileNumber && number === fileNumber) score += 100;
    if (titleKey.length >= 2 && fileKey.includes(titleKey)) score += 40 + titleKey.length;
    if (numberKey === fileKey) score += 80;
    if (score > bestScore) {
      bestScore = score;
      bestId = id;
    } else if (score === bestScore) {
      bestId = null;
    }
  }
  return bestId;
};

const getOrCreateLyrics = async (
  document: ResolvedDocument,
  audio: AudioLink
): Promise<string | null> => {
  const recognized = await readRecognizedLyrics(document.id, audio.path, audio.duration);
  if (recognized) return recognized;
  const cachePath = lyricsCachePath(document.id);
  try {
    return await fs.readFile(cachePath, 'utf8');
  } catch {
    const lines = await extractPdfLyrics(document.filePath, {
      title: document.title,
      modelDirectory: ocrModelDirectory(),
      ocr: false
    });
    const lyrics = buildTimedLyrics(lines, audio.duration);
    if (lyrics) {
      await fs.mkdir(getLyricsRoot(), { recursive: true });
      await fs.writeFile(cachePath, lyrics, 'utf8');
    }
    return lyrics;
  }
};

export function initializeHymnLibrary(): void {
  registerServiceTools();
  ipcMain.handle('poems:score-page',async(_,id:string,page:number)=>{
    const manifest=await readManifest();
    if(id.startsWith('builtin:')){
      const root=getBuiltinRoot(), path=join(root,id.slice(8));
      if(!isInsideRoot(root,path)||extname(path).toLowerCase()!=='.pdf')throw Error('无效歌谱');
      return renderScorePage(path,page);
    }
    const doc=manifest.documents.find(d=>d.id===id);
    if(!doc)throw Error('歌谱不存在');
    const path=join(getCustomRoot(),doc.bookId,doc.fileName);
    if(!isInsideRoot(getCustomRoot(),path))throw Error('无效歌谱');
    return renderScorePage(path,page);
  });
  let pendingScore:{path:string,token:string}|undefined;
  ipcMain.handle('poems:score-read',async ()=>{
    const choice=await dialog.showOpenDialog({properties:['openFile'],filters:[{name:'PDF 歌谱',extensions:['pdf']}]});
    if(choice.canceled)return null;
    const path=choice.filePaths[0], token=randomUUID();
    const result=await readScorePages(path,ocrModelDirectory());
    pendingScore={path,token};
    return {...result,token,name:basename(path)};
  });
  ipcMain.handle('poems:score-import',async (_,token:string,edition:string)=>{
    if(!pendingScore||token!==pendingScore.token||!['blue','white'].includes(edition))throw Error('请重新预览歌谱');
    const path=pendingScore.path;
    const manifest=await readManifest(), name=edition==='blue'?'蓝版 · 歌谱':'白版 · 司琴谱';
    let book=manifest.books.find(b=>b.name===name);
    if(!book){book={id:randomUUID(),name,createdAt:Date.now()};manifest.books.push(book)}
    const folder=join(getCustomRoot(),book.id), id='custom:'+randomUUID(),fileName=id.slice(7)+'.pdf',title=basename(path,extname(path));
    await fs.mkdir(folder,{recursive:true});await fs.copyFile(path,join(folder,fileName));
    manifest.documents.push({id,bookId:book.id,title,number:numericKey(title)??title,fileName});
    await writeManifest(manifest);pendingScore=undefined;return id;
  });
  const customText = new Map<string, { stamp: number; lines: string[] }>();
  ipcMain.handle('poems:lyrics', async () => {
    const manifest = await readManifest(),
      docs = await resolveDocuments(manifest);
    const files = new Set(await fs.readdir(getLyricsRoot()).catch(() => []));
    const output: Record<string, string[]> = {};
    for (const doc of docs) {
      const audio = manifest.audioLinks[doc.id];
      const stem = createHash('sha1').update(doc.id).digest('hex');
      if (files.has(stem + '.json')) {
        const result = await loadRecognition(doc.id, audio?.path, audio?.duration ?? 0);
        if (result?.text) {
          output[doc.id] = result.text.split(/\r?\n/);
          continue;
        }
      }
      if (doc.source === 'custom') {
        try {
          const stamp = (await fs.stat(doc.filePath)).mtimeMs;
          if (customText.get(doc.id)?.stamp !== stamp)
            customText.set(doc.id, {
              stamp,
              lines: await extractPdfLyrics(doc.filePath, {
                title: doc.title,
                modelDirectory: ocrModelDirectory(),
                ocr: false
              })
            });
          output[doc.id] = customText.get(doc.id)!.lines;
        } catch {
          continue;
        }
      }
    }
    return output;
  });
  ipcMain.handle('poems:edit', async (_, id: string, lines: { ms: number; text: string }[]) => {
    const manifest = await readManifest();
    if (
      !(await resolveDocuments(manifest)).some((d) => d.id === id) ||
      !Array.isArray(lines) ||
      !lines.length ||
      lines.some(
        (l, i) =>
          !Number.isFinite(l.ms) ||
          l.ms < 0 ||
          (i > 0 && l.ms < lines[i - 1].ms) ||
          typeof l.text !== 'string' ||
          !l.text.trim() ||
          /[\r\n]/.test(l.text)
      )
    )
      throw Error('请检查空行和时间顺序');
    const audio = manifest.audioLinks[id],
      signal = new AbortController().signal;
    if (!audio) {
      await storeRecognition(id, { source: 'pdf', lines: lines.map((l) => l.text) }, signal);
      return;
    }
    const stat = await fs.stat(audio.path);
    const lrc = lines
      .map(
        (l) =>
          '[' +
          String(Math.floor(l.ms / 60000)).padStart(2, '0') +
          ':' +
          ((l.ms % 60000) / 1000).toFixed(3).padStart(6, '0') +
          ']' +
          l.text
      )
      .join('\n');
    await storeRecognition(
      id,
      { source: 'audio', path: audio.path, size: stat.size, mtimeMs: stat.mtimeMs, lrc },
      signal
    );
  });
  ipcMain.handle('poems:relink', async () => {
    const choice = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (choice.canceled) return null;
    const files = await walkFiles(choice.filePaths[0], ['.mp3']);
    const names = new Map<string, string[]>();
    for (const path of files) {
      const k = basename(path).toLowerCase();
      names.set(k, [...(names.get(k) ?? []), path]);
    }
    const manifest = await readManifest();
    let count = 0;
    for (const [id, audio] of Object.entries(manifest.audioLinks)) {
      if (
        await fs.access(audio.path).then(
          () => true,
          () => false
        )
      )
        continue;
      const matches = names.get(basename(audio.path).toLowerCase());
      if (matches?.length === 1) {
        const previous = audio.path;
        audio.path = matches[0];
        const file = lyricsCachePath(id).replace(/\.lrc$/, '.json');
        try {
          const record = JSON.parse(await fs.readFile(file, 'utf8'));
          const stat = await fs.stat(audio.path);
          if (record.source === 'audio' && record.path === previous && stat.size === record.size)
            await storeRecognition(
              id,
              { ...record, path: audio.path, mtimeMs: stat.mtimeMs },
              new AbortController().signal
            );
        } catch {
          /* No recognition record for this item. */
        }
        count++;
      }
    }
    await writeManifest(manifest);
    return count;
  });
  initializeLyricsRecognition(async (id) => {
    const manifest = await readManifest();
    const document = (await resolveDocuments(manifest)).find((item) => item.id === id);
    if (!document) return undefined;
    const root = document.source === 'builtin' ? getBuiltinRoot() : getCustomRoot();
    if (!isInsideRoot(root, document.filePath)) throw new Error('无效的歌谱路径');
    const audio = manifest.audioLinks[id];
    return {
      pdf: document.filePath,
      title: document.title,
      audio: audio?.path,
      duration: audio?.duration ?? 0
    };
  });
  ipcMain.handle('hymn-library:list', async (): Promise<HymnLibraryResult> => {
    const manifest = await readManifest();
    const documents = await resolveDocuments(manifest);
    return {
      rootAvailable: documents.length > 0,
      documents: documents.map(({ filePath: _filePath, ...document }) => document),
      customBooks: manifest.books
    };
  });

  ipcMain.handle('hymn-library:create-book', async (_, name: string): Promise<CustomHymnBook> => {
    const trimmedName = String(name ?? '')
      .trim()
      .slice(0, 40);
    if (!trimmedName) throw new Error('请输入诗歌本名称');
    const manifest = await readManifest();
    if (
      manifest.books.some(
        (book) => book.name.toLocaleLowerCase('zh-CN') === trimmedName.toLocaleLowerCase('zh-CN')
      )
    ) {
      throw new Error('已存在同名诗歌本');
    }
    const book = { id: randomUUID(), name: trimmedName, createdAt: Date.now() };
    manifest.books.push(book);
    await fs.mkdir(join(getCustomRoot(), book.id), { recursive: true });
    await writeManifest(manifest);
    return book;
  });

  ipcMain.handle('hymn-library:remove-book', async (_, bookId: string): Promise<boolean> => {
    const manifest = await readManifest();
    if (!manifest.books.some((book) => book.id === bookId)) return false;
    const removedIds = new Set(
      manifest.documents
        .filter((document) => document.bookId === bookId)
        .map((document) => document.id)
    );
    manifest.books = manifest.books.filter((book) => book.id !== bookId);
    manifest.documents = manifest.documents.filter((document) => document.bookId !== bookId);
    for (const id of removedIds) delete manifest.audioLinks[id];
    await writeManifest(manifest);
    const bookPath = join(getCustomRoot(), bookId);
    if (isInsideRoot(getCustomRoot(), bookPath))
      await fs.rm(bookPath, { recursive: true, force: true });
    return true;
  });

  ipcMain.handle(
    'hymn-library:import-pdfs',
    async (_, bookId: string): Promise<HymnImportResult> => {
      const manifest = await readManifest();
      if (!manifest.books.some((book) => book.id === bookId)) throw new Error('自定义诗歌本不存在');
      const result = await dialog.showOpenDialog({
        title: '选择诗歌 PDF',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'PDF 文件', extensions: ['pdf'] }]
      });
      if (result.canceled) return { canceled: true, imported: 0 };

      const targetRoot = join(getCustomRoot(), bookId);
      await fs.mkdir(targetRoot, { recursive: true });
      let imported = 0;
      for (const sourcePath of result.filePaths) {
        const originalName = basename(sourcePath);
        let targetName = originalName;
        let suffix = 2;
        while (
          manifest.documents.some((item) => item.bookId === bookId && item.fileName === targetName)
        ) {
          targetName = `${basename(originalName, extname(originalName))}-${suffix}${extname(originalName)}`;
          suffix += 1;
        }
        await fs.copyFile(sourcePath, join(targetRoot, targetName));
        const title = basename(targetName, extname(targetName));
        const number = numericKey(title) ?? title;
        manifest.documents.push({
          id: `custom:${randomUUID()}`,
          bookId,
          title,
          number,
          fileName: targetName
        });
        imported += 1;
      }
      await writeManifest(manifest);
      return { canceled: false, imported };
    }
  );

  ipcMain.handle(
    'hymn-library:import-audio',
    async (_, category: string): Promise<HymnImportResult> => {
      const result = await dialog.showOpenDialog({
        title: `选择“${category}”的 MP3 文件夹`,
        properties: ['openDirectory']
      });
      if (result.canceled || !result.filePaths[0])
        return { canceled: true, imported: 0, matched: 0 };

      const manifest = await readManifest();
      const candidates = (await resolveDocuments(manifest))
        .filter((document) => document.category === category)
        .map(toAudioCandidate);
      const audioFiles = await walkFiles(result.filePaths[0], ['.mp3']);
      const unmatched: string[] = [];
      let matched = 0;
      for (const filePath of audioFiles) {
        const documentId = findAudioMatch(filePath, candidates);
        if (!documentId) {
          unmatched.push(basename(filePath));
          continue;
        }
        try {
          const metadata = await mm.parseFile(filePath, { skipCovers: true });
          manifest.audioLinks[documentId] = {
            path: filePath,
            duration: Math.round((metadata.format.duration ?? 0) * 1000),
            title: metadata.common.title || basename(filePath, extname(filePath)),
            authors: [...new Set([...(metadata.common.lyricist || []), ...(metadata.common.composer || [])])],
            artist: metadata.common.artist || '诗歌本'
          };
          matched += 1;
        } catch (error) {
          console.error(`[hymn-library] Failed to read MP3: ${filePath}`, error);
          unmatched.push(basename(filePath));
        }
      }
      await writeManifest(manifest);
      return { canceled: false, imported: audioFiles.length, matched, unmatched };
    }
  );

  ipcMain.handle('hymn-library:playback', async (_, id: string): Promise<HymnPlayback | null> => {
    const manifest = await readManifest();
    const document = (await resolveDocuments(manifest)).find((item) => item.id === id);
    const audio = manifest.audioLinks[id];
    if (!document || !audio) return null;
    try {
      await fs.access(audio.path);
    } catch {
      return null;
    }
    return {
      id: document.id,
      title: document.title || audio.title,
      album: document.category,
      artist: audio.artist,
      audioPath: audio.path,
      duration: audio.duration,
      lyrics: await getOrCreateLyrics(document, audio).catch((error) => {
        console.warn('[hymn-library] 歌词暂不可用', error);
        return null;
      })
    };
  });

  ipcMain.handle('hymn-library:open', async (_, id: string): Promise<string> => {
    const manifest = await readManifest();
    const document = (await resolveDocuments(manifest)).find((item) => item.id === id);
    if (!document || extname(document.filePath).toLowerCase() !== '.pdf')
      return '无效的诗歌文件路径';
    const allowedRoot = document.source === 'builtin' ? getBuiltinRoot() : getCustomRoot();
    if (!isInsideRoot(allowedRoot, document.filePath)) return '无效的诗歌文件路径';
    return await shell.openPath(document.filePath);
  });
}
