import { app, BrowserWindow, dialog, ipcMain, screen } from 'electron';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const roots = ['CustomHymnLibrary', 'HymnLyrics'];
const allowedKey = new Set(['poems-services', 'favoriteList', 'favoriteSongDetails']);
const uuid = /^[a-f0-9-]{36}$/i;
const safeName = (s: string) =>
  !!s &&
  !/[\\/:*?"<>|\x00-\x1f]/.test(s) &&
  !/[. ]$/.test(s) &&
  !/^(con|nul|prn|aux|com\d|lpt\d)(\.|$)/i.test(s);
function allowed(path: string) {
  const [root, a, b, ...rest] = path.split('/');
  if (!roots.includes(root) || rest.length || !safeName(a || '')) return false;
  if (root === 'HymnLyrics') return !b && /^[a-f0-9]{40}\.(json|lrc)$/.test(a);
  return (!b && a === 'library.json') || (uuid.test(a) && safeName(b || '') && /\.pdf$/i.test(b));
}
async function pack(root: string, rel: string, files: Record<string, string>) {
  const entries = await fs.readdir(join(root, rel), { withFileTypes: true }).catch((e) => {
    if (e.code === 'ENOENT') return [];
    throw e;
  });
  for (const entry of entries) {
    const key = rel + '/' + entry.name;
    if (entry.isDirectory() && rel === 'CustomHymnLibrary' && uuid.test(entry.name))
      await pack(root, key, files);
    if (entry.isFile() && allowed(key))
      files[key] = (await fs.readFile(join(root, key))).toString('base64');
  }
}
export function registerServiceTools() {
  ipcMain.handle('poems:diagnostics', async () => {
    const root = app.isPackaged ? process.resourcesPath : app.getAppPath();
    const assets = [
      ['内置歌谱目录', app.isPackaged ? 'hymns' : 'songbooks'],
      ['简体中文 OCR 字库', 'ocr-data/chi_sim.traineddata.gz'],
      ['繁体中文 OCR 字库', 'ocr-data/chi_tra.traineddata.gz'],
      ['英文 OCR 字库', 'ocr-data/eng.traineddata.gz'],
      ['语音转写脚本', 'transcription/transcribe.py'],
      ['本地 AI 引擎包', 'local-ai/llama-b12651-win-cpu.zip']
    ];
    const components = await Promise.all(assets.map(async ([name, file], index) => {
      const prefix = app.isPackaged || index === 0 ? '' : file.startsWith('transcription/') ? 'resources' : 'build';
      const stat = await fs.stat(join(root, prefix, file)).catch(() => null);
      return { name, present: index === 0 ? !!stat?.isDirectory() : !!stat?.isFile() && stat.size > 0 };
    }));
    return { version: app.getVersion(), platform: process.platform, arch: process.arch,
      electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node,
      packaged: app.isPackaged, checkedAt: new Date().toISOString(), components };
  });
  let display: BrowserWindow | null = null;
  ipcMain.handle('poems:project', async (event, line: string | null) => {
    if (line === null) {
      display?.close();
      return;
    }
    if (!display) {
      const main = BrowserWindow.fromWebContents(event.sender);
      const current = main && screen.getDisplayMatching(main.getBounds());
      const target =
        screen.getAllDisplays().find((d) => d.id !== current?.id) ||
        current ||
        screen.getPrimaryDisplay();
      display = new BrowserWindow({
        ...target.bounds,
        fullscreen: true,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: '#101513',
        webPreferences: { sandbox: true }
      });
      display.on('closed', () => {
        display = null;
      });
      display.webContents.on('before-input-event', (_, key) => {
        if (key.key === 'Escape') display?.close();
      });
      await display.loadURL(
        'data:text/html;charset=utf-8,' +
          encodeURIComponent(
            '<meta charset="utf-8"><style>body{background:#101513;color:white;display:grid;place-items:center;height:100vh;margin:0;font:600 clamp(40px,7vw,130px)/1.4 system-ui;text-align:center}main{padding:4vw;white-space:pre-wrap}</style><main></main>'
          )
      );
    }
    await display?.webContents.executeJavaScript(
      'document.querySelector("main").textContent=' + JSON.stringify(String(line).slice(0, 1500))
    );
    display?.showInactive();
  });
  ipcMain.handle('poems:backup', async (_, settings: Record<string, string>) => {
    const { filePath } = await dialog.showSaveDialog({
      defaultPath: 'Poems-歌库.poems',
      filters: [{ name: 'Poems 歌库', extensions: ['poems'] }]
    });
    if (!filePath) return false;
    const files: Record<string, string> = {};
    for (const dir of roots) await pack(app.getPath('userData'), dir, files);
    const temp = filePath + '.' + randomUUID() + '.tmp';
    try {
      await fs.writeFile(
        temp,
        gzipSync(
          JSON.stringify({
            version: 1,
            files,
            settings: Object.fromEntries(
              Object.entries(settings).filter(([k]) => allowedKey.has(k))
            )
          })
        )
      );
      await fs.rename(temp, filePath);
    } finally {
      await fs.rm(temp, { force: true });
    }
    return true;
  });
  ipcMain.handle('poems:restore', async () => {
    const { filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Poems 歌库', extensions: ['poems'] }]
    });
    if (!filePaths[0]) return null;
    const data = JSON.parse(
      gunzipSync(await fs.readFile(filePaths[0]), { maxOutputLength: 1024 ** 3 }).toString()
    );
    if (data.version !== 1 || !data.files || !data.settings) throw Error('备份格式无效');
    const user = app.getPath('userData'),
      stage = await fs.mkdtemp(join(user, 'poems-restore-'));
    const old: string[] = [],
      moved: string[] = [];
    try {
      for (const dir of roots) await fs.mkdir(join(stage, dir));
      for (const [key, content] of Object.entries(data.files)) {
        if (!allowed(key) || typeof content !== 'string') throw Error('备份文件名无效');
        const path = join(stage, key),
          bytes = Buffer.from(content, 'base64');
        if (key.endsWith('/library.json')) {
          const manifest = JSON.parse(bytes.toString());
          if (
            !Array.isArray(manifest.books) ||
            !Array.isArray(manifest.documents) ||
            !manifest.books.every((b: any) => uuid.test(b.id)) ||
            !manifest.documents.every(
              (d: any) => uuid.test(d.bookId) && safeName(d.fileName) && /\.pdf$/i.test(d.fileName)
            )
          )
            throw Error('歌本清单无效');
        }
        await fs.mkdir(dirname(path), { recursive: true });
        await fs.writeFile(path, bytes);
      }
      if (
        (
          await dialog.showMessageBox({
            type: 'question',
            buttons: ['取消', '恢复'],
            defaultId: 0,
            message: '用备份替换当前歌本、校对记录、歌单和收藏？'
          })
        ).response !== 1
      )
        return null;
      for (const dir of roots) {
        try {
          await fs.rename(join(user, dir), join(stage, 'old-' + dir));
          old.push(dir);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        }
        await fs.rename(join(stage, dir), join(user, dir));
        moved.push(dir);
      }
      return Object.fromEntries(
        Object.entries(data.settings).filter(([k, v]) => allowedKey.has(k) && typeof v === 'string')
      );
    } catch (e) {
      for (const dir of moved.reverse()) await fs.rename(join(user, dir), join(stage, dir));
      for (const dir of old.reverse()) await fs.rename(join(stage, 'old-' + dir), join(user, dir));
      throw e;
    } finally {
      await fs.rm(stage, { recursive: true, force: true });
    }
  });
}
