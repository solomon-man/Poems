import { execFile, spawn } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { app } from 'electron';
import { createReadStream, promises as fs } from 'fs';
import { request } from 'http';
import { homedir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

import type { LocalAiModel as Model } from '../../shared/localAi';

const execute = promisify(execFile);
type Progress = (stage: string) => void;
type Asset = { name: string; bytes: number; sha256: string; urls: string[] };

// Server, CPU backends and runtime libraries from the pinned upstream archive.
const bundledRuntime = {
  name: 'llama-server-b12651-win-cpu.tar.xz',
  sha256: 'a97d60ea74cc639608696560570c862c4906a1b0e9533ff1c9817a637f7ebbfc'
};

const runtime: Asset = {
  name: 'llama-b12651-win-cpu.zip',
  bytes: 25096571,
  sha256: 'b2d794fa7587aba29f654d717ff9b73e31caeabf50a7766692903008bbe0855d',
  urls: [
    'https://api.github.com/repos/ggml-org/llama.cpp/releases/assets/782226472',
    'https://github.com/ggml-org/llama.cpp/releases/download/b12651/llama-b12651-bin-win-cpu-x64.zip'
  ]
};
const models: Record<Model, Asset> = {
  qwen: modelAsset(
    'Qwen/Qwen2.5-1.5B-Instruct-GGUF',
    '91cad51170dc346986eccefdc2dd33a9da36ead9',
    'e8b19c78f775ccbcf6df15ceace6bb5276f09765',
    'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    1117320736,
    '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e'
  ),
  deepseek: modelAsset(
    'bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF',
    '9cc28b17e86fa2415fcb070f8ee5ec27c965aa61',
    '5fabb0decd67d4fbdbef9b4c7476e3614053d773',
    'DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf',
    1117320800,
    '1741e5b2d062b07acf048bf0d2c514dadf2a48f94e2b4aa0cfe069af3838ee2f'
  )
};

function modelAsset(
  repo: string,
  rev: string,
  modelScopeRev: string,
  name: string,
  bytes: number,
  sha256: string
): Asset {
  const file = '/' + repo + '/resolve/' + rev + '/' + name + '?download=true';
  return {
    name,
    bytes,
    sha256,
    urls: [
      'https://www.modelscope.cn/models/' + repo + '/resolve/' + modelScopeRev + '/' + name,
      'https://huggingface.co' + file,
      'https://hf-mirror.com' + file
    ]
  };
}

const cache = () => join(homedir(), '.cache', 'love-hymn', 'local-ai', 'v1');
const verified = new Map<string, number>();

async function fileHash(path: string, signal: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  for await (const data of createReadStream(path, { signal })) hash.update(data);
  return hash.digest('hex');
}

// Ranges are only reused after a successful transfer; a single published SHA-256 covers the assembled file.
async function prepareAsset(
  asset: Asset,
  label: string,
  signal: AbortSignal,
  progress: Progress
): Promise<string> {
  const path = join(cache(), asset.name);
  const existing = await fs.stat(path).catch(() => null);
  if (existing?.size === asset.bytes) {
    if (
      verified.get(path) === existing.mtimeMs ||
      (await fileHash(path, signal)) === asset.sha256
    ) {
      verified.set(path, existing.mtimeMs);
      return path;
    }
  }

  await fs.mkdir(cache(), { recursive: true });
  const partSize = (asset === runtime ? 1 : 16) * 1024 * 1024;
  const partCount = Math.ceil(asset.bytes / partSize);
  const parts = Array.from({ length: partCount }, (_, i) => path + '.part-' + i);
  const controller = new AbortController();
  const downloadSignal = AbortSignal.any([signal, controller.signal]);
  let next = 0,
    bytesDone = 0,
    preferred = 0;
  const update = () => progress(label + ' ' + Math.floor((bytesDone * 100) / asset.bytes) + '%');
  update();
  async function worker(): Promise<void> {
    while (next < partCount) {
      downloadSignal.throwIfAborted();
      const i = next++;
      const start = i * partSize;
      const size = Math.min(partSize, asset.bytes - start);
      const part = parts[i];
      if ((await fs.stat(part).catch(() => null))?.size !== size) {
        const indices = [...new Set([preferred, ...asset.urls.map((_, j) => j)])];
        const temp = part + '.' + process.pid + '.tmp';
        try {
          let failure = '';
          for (const j of indices) {
            downloadSignal.throwIfAborted();
            try {
              const { stdout } = await execute(
                'curl.exe',
                [
                  '--fail',
                  '--silent',
                  '--show-error',
                  '--location',
                  '--proto',
                  '=https',
                  '--proto-redir',
                  '=https',
                  '--connect-timeout',
                  '8',
                  '--max-time',
                  '240',
                  '--speed-time',
                  '40',
                  '--speed-limit',
                  '1024',
                  '--range',
                  start + '-' + (start + size - 1),
                  '--max-filesize',
                  String(size),
                  '--header',
                  'Accept: application/octet-stream',
                  '--write-out',
                  '%{http_code}',
                  '--output',
                  temp,
                  asset.urls[j]
                ],
                { signal: downloadSignal, windowsHide: true, maxBuffer: 8192 }
              );
              if (stdout.trim() !== '206' || (await fs.stat(temp)).size !== size)
                throw new Error('分段大小有误');
              await fs.rename(temp, part);
              preferred = j;
              failure = '';
              break;
            } catch (error) {
              downloadSignal.throwIfAborted();
              failure =
                String((error as Error).message)
                  .split('\n')
                  .at(-1)
                  ?.trim() || '连接失败';
            }
          }
          if (failure) throw new Error(label + '失败，请检查网络并重试：' + failure.slice(-180));
        } finally {
          await fs.rm(temp, { force: true }).catch(() => undefined);
        }
      }
      bytesDone += size;
      update();
    }
  }

  const workers = Array.from({ length: Math.min(asset === runtime ? 6 : 4, partCount) }, worker);
  try {
    await Promise.all(workers);
  } catch (error) {
    controller.abort();
    await Promise.allSettled(workers);
    throw error;
  }
  progress('正在校验' + asset.name);
  const staging = path + '.' + process.pid + '.assembling';
  try {
    const output = await fs.open(staging, 'w');
    const hash = createHash('sha256');
    try {
      for (const part of parts) {
        signal.throwIfAborted();
        const chunk = await fs.readFile(part);
        hash.update(chunk);
        await output.writeFile(chunk);
      }
    } finally {
      await output.close();
    }
    if (hash.digest('hex') !== asset.sha256) {
      await Promise.all(parts.map((part) => fs.rm(part, { force: true })));
      throw new Error('下载文件校验失败，请重试');
    }
    signal.throwIfAborted();
    await fs.rename(staging, path);
    verified.set(path, (await fs.stat(path)).mtimeMs);
    await Promise.all(parts.map((part) => fs.rm(part, { force: true })));
    return path;
  } finally {
    await fs.rm(staging, { force: true }).catch(() => undefined);
  }
}

async function runtimeExecutable(signal: AbortSignal, progress: Progress): Promise<string> {
  const install = join(cache(), 'llama-b12651-win-cpu');
  const exe = join(install, 'llama-server.exe');
  if (
    (await fs.stat(join(install, 'ready')).catch(() => null))?.isFile() &&
    (await fs.stat(exe).catch(() => null))?.isFile()
  )
    return exe;
  const bundled = app.isPackaged
    ? join(process.resourcesPath, 'local-ai', bundledRuntime.name)
    : join(__dirname, '..', '..', 'build', 'local-ai', bundledRuntime.name);
  let archive = bundled;
  if ((await fs.stat(bundled).catch(() => null))?.isFile()) {
    progress('正在校验内置推理引擎');
    if ((await fileHash(bundled, signal)) !== bundledRuntime.sha256)
      throw new Error('内置推理引擎校验失败，请重新安装播放器');
  } else {
    archive = await prepareAsset(runtime, '正在下载本地推理引擎', signal, progress);
  }
  progress('正在解压本地推理引擎');
  await fs.mkdir(install, { recursive: true });
  await execute('tar.exe', ['-xf', archive, '-C', install], {
    signal,
    windowsHide: true,
    timeout: 120000
  });
  await fs.access(exe);
  await fs.writeFile(join(install, 'ready'), runtime.sha256);
  return exe;
}

type Completion = { choices?: Array<{ finish_reason?: string; message?: { content?: string } }> };

// Node's http client connects directly to the private loopback port without a proxy or redirects.
function complete(port: number, key: string, prompt: string, signal: AbortSignal): Promise<string> {
  const body = JSON.stringify({
    model: 'hymn-local',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    max_tokens: 1024,
    stream: false,
    chat_template_kwargs: { enable_thinking: false }
  });
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/v1/chat/completions',
        method: 'POST',
        signal,
        agent: false,
        headers: {
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let size = 0;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 128 * 1024) res.destroy(new Error('本地模型返回内容过长'));
          else chunks.push(chunk);
        });
        res.once('error', reject);
        res.once('end', () => {
          try {
            if (res.statusCode !== 200)
              throw new Error('本地模型请求失败（HTTP ' + res.statusCode + '），请缩短输入后重试');
            const choice = (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Completion)
              .choices?.[0];
            if (choice?.finish_reason !== 'stop')
              throw new Error('本地模型回复未完成，请缩短问题后重试');
            const raw = choice.message?.content;
            if (typeof raw !== 'string') throw new Error('本地模型未给出答复');
            const answer = raw
              .slice(raw.lastIndexOf('</think>') < 0 ? 0 : raw.lastIndexOf('</think>') + 8)
              .trim();
            if (!answer || /<think>/i.test(answer)) throw new Error('本地模型未给出完整答复');
            resolve(answer);
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    req.once('error', reject);
    req.end(body);
  });
}

async function infer(
  exe: string,
  modelPath: string,
  prompt: string,
  signal: AbortSignal,
  progress: Progress
): Promise<string> {
  const key = randomUUID();
  const child = spawn(
    exe,
    [
      '-m',
      modelPath,
      '--alias',
      'hymn-local',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      '--api-key',
      key,
      '--offline',
      '--no-webui',
      '--no-warmup',
      '--parallel',
      '1',
      '--ctx-size',
      '4096',
      '--n-gpu-layers',
      '0',
      '--reasoning-format',
      'deepseek',
      '--reasoning-budget',
      '0'
    ],
    { signal, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const stop = () => {
    if (child.exitCode === null) child.kill();
  };
  app.once('before-quit', stop);
  process.once('exit', stop);
  try {
    const port = await new Promise<number>((resolve, reject) => {
      let log = '';
      const read = (chunk: Buffer) => {
        log = (log + chunk.toString()).slice(-16000);
        const match = log.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) resolve(Number(match[1]));
      };
      child.stdout.on('data', read);
      child.stderr.on('data', read);
      child.once('error', reject);
      child.once('exit', (code) =>
        reject(
          new Error(
            '本地推理引擎启动失败（' + code + '）：' + log.trim().split(/\r?\n/).at(-1)?.slice(-180)
          )
        )
      );
    });
    progress('正在本机生成回复');
    return await complete(port, key, prompt, signal);
  } finally {
    app.removeListener('before-quit', stop);
    process.removeListener('exit', stop);
    stop();
  }
}

let busy = false;
export async function generateLocalText(
  prompt: string,
  signal: AbortSignal,
  onStage: Progress,
  model: Model = 'qwen'
): Promise<string> {
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error('本地 AI 需要 Windows x64 版播放器');
  if (!Object.hasOwn(models, model)) throw new Error('请选择可用的本地模型');
  if (!prompt.trim() || prompt.length > 12000) throw new Error('请输入较短的问题或分批校对歌词');
  if (busy) throw new Error('本地 AI 正在处理另一项任务');
  busy = true;
  try {
    signal.throwIfAborted();
    const exe = await runtimeExecutable(signal, onStage);
    const modelPath = await prepareAsset(
      models[model],
      '正在下载 ' + (model === 'deepseek' ? 'DeepSeek' : 'Qwen') + ' 模型',
      signal,
      onStage
    );
    onStage('正在加载本地模型');
    const timeout = AbortSignal.timeout(5 * 60_000);
    try {
      return await infer(exe, modelPath, prompt, AbortSignal.any([signal, timeout]), onStage);
    } catch (error) {
      if (timeout.aborted) throw new Error('本地推理超时，请缩短问题后再试');
      throw error;
    }
  } catch (error) {
    if (signal.aborted) throw new Error('已取消本地 AI 任务');
    throw error;
  } finally {
    busy = false;
  }
}
