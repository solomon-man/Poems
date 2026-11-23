<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    title="本地 AI"
    class="max-h-[90vh] overflow-y-auto"
    style="width: min(620px, 92vw)"
    :closable="!running"
    :mask-closable="!running"
    :close-on-esc="!running"
  >
    <div class="flex flex-wrap items-center justify-between gap-2">
      <local-ai-model-select :disabled="engineBusy" />
      <n-button v-if="history.length" size="small" quaternary :disabled="running" @click="clear"
        >清空对话</n-button
      >
    </div>
    <p class="my-3 text-sm text-neutral-500">
      每个模型首次使用需下载约 1.1 GB，问题和歌词只在本机处理。
    </p>
    <div
      v-if="history.length || pendingQuestion"
      ref="log"
      class="mb-3 max-h-[38vh] space-y-3 overflow-y-auto"
      role="log"
      aria-label="对话记录"
    >
      <div v-for="(turn, index) in history" :key="index">
        <p class="font-semibold">{{ turn.role === 'user' ? '你' : '本地 AI' }}</p>
        <p class="whitespace-pre-wrap break-words">{{ turn.content }}</p>
      </div>
      <div v-if="pendingQuestion">
        <p class="font-semibold">你</p>
        <p class="whitespace-pre-wrap break-words">{{ pendingQuestion }}</p>
      </div>
    </div>
    <n-input
      v-model:value="draft"
      type="textarea"
      :disabled="running"
      :maxlength="1500"
      show-count
      :autosize="{ minRows: 3, maxRows: 6 }"
      placeholder="输入关于歌曲的问题，或粘贴歌词一起提问"
      @keydown.ctrl.enter.prevent="ask"
    />
    <p v-if="status" role="status" class="mt-2 whitespace-pre-wrap break-words">{{ status }}</p>
    <div class="mt-3 flex flex-wrap items-center justify-end gap-2">
      <template v-if="running">
        <n-spin size="small" /><span role="status">{{ canceling ? '正在取消…' : stage }}</span>
        <n-button :disabled="canceling" @click="cancel">取消回答</n-button>
      </template>
      <n-button v-else type="primary" :disabled="engineBusy || !draft.trim()" @click="ask"
        >发送</n-button
      >
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { nextTick, ref, shallowRef } from 'vue';

import type { AiChatMessage } from '../../../shared/localAi';
import LocalAiModelSelect from './LocalAiModelSelect.vue';
import { localAiModel, useLocalAiTask } from './useLocalAiTask';

const { running, engineBusy, stage, canceling, run, cancel } = useLocalAiTask();
const visible = ref(false);
const draft = ref('');
const history = shallowRef<AiChatMessage[]>([]);
const pendingQuestion = ref('');
const status = ref('');
const log = ref<HTMLElement>();

async function scrollToLatest(): Promise<void> {
  await nextTick();
  if (log.value) log.value.scrollTop = log.value.scrollHeight;
}

function clear(): void {
  history.value = [];
  draft.value = '';
  status.value = '';
}

async function ask(): Promise<void> {
  const content = draft.value.trim();
  if (!content || engineBusy.value) return;
  const question: AiChatMessage = { role: 'user', content };
  const messages = [...history.value.slice(-10), question];
  status.value = '';
  pendingQuestion.value = content;
  draft.value = '';
  void scrollToLatest();
  try {
    const response = await run(() =>
      window.api.askLocalAi({ messages, model: localAiModel.value })
    );
    if (response.text?.trim() && !response.canceled) {
      history.value = [...history.value, question, { role: 'assistant', content: response.text }];
    } else {
      draft.value = content;
      status.value = response.canceled
        ? '已取消回答。'
        : response.message || '模型没有生成回答，请重试。';
    }
  } catch (error) {
    draft.value = content;
    status.value = error instanceof Error ? error.message : String(error);
  } finally {
    pendingQuestion.value = '';
    void scrollToLatest();
  }
}

defineExpose({
  open: () => {
    visible.value = true;
  }
});
</script>
