import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';

import type {
  AiChatMessage,
  AiChatRequest,
  AiChatResult,
  AiReviewRequest,
  AiReviewResult,
  LocalAiModel
} from '../../shared/localAi';
import { reviewLyricLines } from './aiLyricReview';
import { generateLocalText } from './localAiEngine';

function selectedModel(model: unknown): LocalAiModel {
  if (model === undefined || model === 'qwen') return 'qwen';
  if (model === 'deepseek') return model;
  throw new Error('请选择可用的本地模型');
}

function chatPrompt(messages: AiChatMessage[]): string {
  if (!Array.isArray(messages) || !messages.length) throw new Error('请输入问题');
  const current = messages.at(-1);
  if (current?.role !== 'user' || typeof current.content !== 'string' || !current.content.trim())
    throw new Error('请输入问题');
  const question = current.content.trim();
  if (Array.from(question).length > 1500) throw new Error('单次提问最多 1500 字，请分段发送');
  const turns: string[] = [];
  let bytes = Buffer.byteLength(question);
  // Keep adjacent question/answer pairs, newest first within the model's 4K context.
  for (let i = messages.length - 2; i >= 1 && turns.length < 5; i -= 2) {
    const answer = messages[i];
    const ask = messages[i - 1];
    if (
      answer?.role !== 'assistant' ||
      ask?.role !== 'user' ||
      typeof answer.content !== 'string' ||
      typeof ask.content !== 'string'
    )
      break;
    const pair = '用户：' + ask.content + '\n助手：' + answer.content;
    bytes += Buffer.byteLength(pair);
    if (bytes > 5400) break;
    turns.unshift(pair);
  }
  return [
    '你是Poems播放器里的本地助手。用用户提问的语言简洁作答。无法确认歌名、出处或原词时，请说明。',
    ...turns,
    '用户：' + question,
    '请直接回答用户最后的问题。'
  ].join('\n\n');
}

export function initializeLocalAi() {
  let active: { owner: number; controller: AbortController } | undefined;
  app.on('before-quit', () => active?.controller.abort());
  ipcMain.handle('local-ai:cancel', (event) => {
    if (active?.owner === event.sender.id) active.controller.abort();
  });

  async function run<T extends AiChatResult | AiReviewResult>(
    event: IpcMainInvokeEvent,
    task: (signal: AbortSignal, stage: (value: string) => void) => Promise<T>
  ): Promise<T | { canceled: true } | { message: string }> {
    if (active) return { message: '本地 AI 正在处理另一项任务，请稍后再试' };
    const controller = new AbortController();
    active = { owner: event.sender.id, controller };
    const abort = () => controller.abort();
    event.sender.once('destroyed', abort);
    try {
      const result = await task(controller.signal, (value) => {
        if (!event.sender.isDestroyed() && !controller.signal.aborted)
          event.sender.send('local-ai:stage', value);
      });
      controller.signal.throwIfAborted();
      return result;
    } catch (error) {
      if (controller.signal.aborted) return { canceled: true };
      return { message: error instanceof Error ? error.message : '本地 AI 运行失败' };
    } finally {
      event.sender.removeListener('destroyed', abort);
      active = undefined;
    }
  }

  ipcMain.handle('local-ai:ask', (event, request: AiChatRequest) =>
    run(event, async (signal, stage) => {
      const text = (
        await generateLocalText(
          chatPrompt(request?.messages),
          signal,
          stage,
          selectedModel(request?.model)
        )
      ).trim();
      if (!text) throw new Error('模型没有生成回答，请简化问题后重试');
      return { text };
    })
  );
  ipcMain.handle('local-ai:review', (event, request: AiReviewRequest) =>
    run(event, async (signal, stage) => ({
      lines: await reviewLyricLines(request?.text, signal, stage, selectedModel(request?.model))
    }))
  );
}
