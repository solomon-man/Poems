import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { app } from 'electron';
import { existsSync, promises as fs } from 'fs';
import { isAbsolute, join } from 'path';
import { promisify } from 'util';

const execute = promisify(execFile);
const engineVersion = '1.2.1';
// Newer PyAV releases removed the metadata_errors argument used by this engine.
const avVersion = '16.1.0';
let queue: Promise<void> = Promise.resolve();

async function run(
  command: string,
  args: string[],
  label: string,
  signal?: AbortSignal
): Promise<string> {
  try {
    const result = await execute(command, args, {
      windowsHide: true,
      signal,
      encoding: 'utf8',
      timeout: 30 * 60_000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, PYTHONUTF8: '1', PIP_NO_INPUT: '1', PYTHONNOUSERSITE: '1' }
    });
    return result.stdout.trim();
  } catch (error) {
    if (signal?.aborted) throw new Error('已取消歌词识别');
    const failure = error as NodeJS.ErrnoException & { killed?: boolean; stderr?: string };
    if (failure.killed) throw new Error(label + '超时，请稍后重试');
    const detail = failure.stderr?.trim().split(/\r?\n/).at(-1) || failure.code || failure.message;
    throw new Error(label + '失败：' + String(detail).slice(-600));
  }
}

async function installWindowsPython(install: string, signal?: AbortSignal): Promise<void> {
  const url = 'https://api.nuget.org/v3-flatcontainer/python/3.13.17/python.3.13.17.nupkg';
  const sha256 = 'dce409744b088f94c6e37ba41f8100c384c27e029e843237364c602d30d475e5';
  const archive = join(install, 'python.zip');
  await fs.mkdir(install, { recursive: true });
  try {
    await run('curl.exe', [
      '--fail', '--silent', '--show-error', '--location', '--retry', '2', '--max-time', '180',
      '--output', archive, url
    ], '下载识别引擎运行环境', signal);
    if (createHash('sha256').update(await fs.readFile(archive)).digest('hex') !== sha256) {
      throw new Error('Python 安装包校验失败，请重试');
    }
    await run('tar.exe', ['-xf', archive, '-C', install], '解压识别引擎运行环境', signal);
    await fs.writeFile(join(install, 'ready'), '3.13.17');
  } finally {
    await fs.rm(archive, { force: true });
  }
}

async function getPython(root: string, signal?: AbortSignal): Promise<string> {
  if (process.env.LOVE_HYMN_WHISPER_PYTHON) return process.env.LOVE_HYMN_WHISPER_PYTHON;

  const windows = process.platform === 'win32';
  const install = join(root, windows ? 'python-win64-3.13.17' : 'venv');
  const python = windows ? join(install, 'tools', 'python.exe') : join(install, 'bin', 'python');
  const ready = join(install, 'faster-whisper-' + engineVersion + '-av-' + avVersion + '.ready');
  if (existsSync(ready) && existsSync(python)) return python;

  await fs.mkdir(root, { recursive: true });
  if (windows && (!existsSync(join(install, 'ready')) || !existsSync(python))) {
    await installWindowsPython(install, signal);
  } else if (!windows && !existsSync(python)) {
    await run('python3', ['-m', 'venv', install], '创建 Python 3 运行环境', signal);
  }
  await run(python, [
    '-m', 'pip', '--disable-pip-version-check', 'install', '--quiet', '--only-binary=:all:',
    'faster-whisper==' + engineVersion, 'av==' + avVersion
  ], '安装本地识别引擎', signal);
  await run(python, ['-c', 'from faster_whisper import WhisperModel'], '检查识别引擎', signal);
  await fs.writeFile(ready, engineVersion);
  return python;
}

export function transcribeAudioToLrc(audioPath: string, signal?: AbortSignal): Promise<string> {
  const result = queue.then(async () => {
    if (signal?.aborted) throw new Error('已取消歌词识别');
    if (!isAbsolute(audioPath) || !(await fs.stat(audioPath).catch(() => null))?.isFile()) {
      throw new Error('找不到待识别的音频文件');
    }
    const root = join(app.getPath('userData'), 'transcription');
    const scripts = app.isPackaged
      ? join(process.resourcesPath, 'transcription')
      : join(__dirname, '..', '..', 'resources', 'transcription');
    const python = await getPython(root, signal);
    return await run(python, [join(scripts, 'transcribe.py'), audioPath, root], '生成歌词', signal);
  });
  // Only one installation or CPU inference may use this profile at a time.
  queue = result.then(() => undefined, () => undefined);
  return result;
}
