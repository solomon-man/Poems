import { useStorage } from '@vueuse/core';
import { useMessage } from 'naive-ui';
import { onBeforeUnmount, ref } from 'vue';

import type { LocalAiModel } from '../../../shared/localAi';

const engineBusy = ref(false);
export const localAiModel = useStorage<LocalAiModel>('hymn-local-ai-model', 'qwen');

export function useLocalAiTask() {
  const message = useMessage();
  const running = ref(false);
  const canceling = ref(false);
  const stage = ref('');

  async function run<T>(operation: () => Promise<T>): Promise<T> {
    if (engineBusy.value) throw new Error('本地 AI 正在处理另一项任务。');
    engineBusy.value = true;
    running.value = true;
    stage.value = '正在准备本地模型…';
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = window.api.onAiStage((value) => {
        stage.value = value;
      });
      return await operation();
    } finally {
      unsubscribe?.();
      running.value = false;
      canceling.value = false;
      engineBusy.value = false;
    }
  }

  async function cancel(): Promise<void> {
    if (!running.value || canceling.value) return;
    canceling.value = true;
    try {
      await window.api.cancelAiReview();
    } catch (error) {
      canceling.value = false;
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  onBeforeUnmount(() => {
    void cancel();
  });
  return { engineBusy, running, canceling, stage, run, cancel };
}
