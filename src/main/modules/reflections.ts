import { app, ipcMain } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export interface Reflection {
  id: string;
  text: string;
  created: number;
  updated: number;
}

export function validateReflections(value: unknown): asserts value is Reflection[] {
  if (
    !Array.isArray(value) ||
    !value.every(
      (note) =>
        note &&
        typeof note.id === 'string' &&
        typeof note.text === 'string' &&
        note.text.length <= 10000 &&
        Number.isFinite(note.created) &&
        Number.isFinite(note.updated)
    )
  )
    throw Error('心迹文件格式无效');
}

function notePath(song: string) {
  if (typeof song !== 'string' || !song || song.length > 4096) throw Error('请选择一首歌曲');
  return join(
    app.getPath('userData'),
    'SongReflections',
    createHash('sha256').update(song).digest('hex') + '.json'
  );
}

async function read(song: string): Promise<Reflection[]> {
  try {
    const value = JSON.parse(await fs.readFile(notePath(song), 'utf8'));
    validateReflections(value);
    return value;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

export function registerReflections() {
  let pending = Promise.resolve();
  ipcMain.handle('poems:notes', (_, song: string) => read(song));
  ipcMain.handle(
    'poems:note-write',
    (_, song: string, text: string | null, id?: string, previous?: number) => {
      const result = pending.then(async () => {
        const notes = await read(song);
        const existing = notes.find((n) => n.id === id);
        if (id && (!existing || existing.updated !== previous))
          throw Error('这条心迹已更新，请重新打开查看');
        if (text === null) {
          if (!existing) throw Error('找不到这条心迹');
          notes.splice(notes.indexOf(existing), 1);
        } else {
          if (typeof text !== 'string' || !text.trim() || text.length > 10000)
            throw Error('请输入 1 至 10000 字');
          const now = Date.now();
          if (existing) {
            existing.text = text.trim();
            existing.updated = Math.max(now, existing.updated + 1);
          } else notes.unshift({ id: randomUUID(), text: text.trim(), created: now, updated: now });
        }
        const path = notePath(song),
          temp = path + '.' + randomUUID() + '.tmp';
        await fs.mkdir(join(app.getPath('userData'), 'SongReflections'), { recursive: true });
        try {
          await fs.writeFile(temp, JSON.stringify(notes), 'utf8');
          await fs.rename(temp, path);
        } finally {
          await fs.rm(temp, { force: true });
        }
        return notes;
      });
      pending = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    }
  );
}
