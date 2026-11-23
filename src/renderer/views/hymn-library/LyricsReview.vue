<template>
  <section
    class="mt-4 border-t border-neutral-200 pt-3 dark:border-neutral-700"
    aria-label="AI 校对"
  >
    <template v-if="running">
      <div class="flex flex-wrap items-center gap-2" role="status">
        <n-spin size="small" />
        <span>{{ canceling ? '正在取消…' : stage }}</span>
        <n-button size="small" :disabled="canceling" @click="cancel">取消校对</n-button>
      </div>
    </template>
    <template v-else-if="changes.length">
      <h3 class="mb-2 font-semibold">校对建议（{{ changes.length }} 行）</h3>
      <div class="max-h-[36vh] space-y-2 overflow-y-auto">
        <label
          v-for="change in changes"
          :key="change.index"
          class="flex cursor-pointer items-start gap-2 rounded border border-neutral-200 p-2 dark:border-neutral-700"
        >
          <input
            v-model="selected"
            type="checkbox"
            class="mt-1"
            :disabled="applying"
            :value="change.index"
            :aria-label="`采用第 ${change.index + 1} 行建议`"
          />
          <span class="min-w-0 text-sm">
            <span class="block text-neutral-500"
              >第 {{ change.index + 1 }} 行 {{ change.time }}</span
            >
            <span class="block break-words">原文 {{ change.original }}</span>
            <span class="block break-words font-semibold">建议 {{ change.suggestion }}</span>
          </span>
        </label>
      </div>
      <div class="mt-2 flex flex-wrap justify-end gap-2">
        <n-button size="small" :disabled="applying" @click="discard">放弃建议</n-button>
        <n-button
          size="small"
          type="primary"
          :disabled="!selected.length"
          :loading="applying"
          @click="apply"
          >采用所选（{{ selected.length }}）</n-button
        >
      </div>
    </template>
    <template v-else>
      <div class="flex flex-wrap items-center gap-3">
        <local-ai-model-select :disabled="disabled || engineBusy" />
        <n-button secondary :disabled="disabled || engineBusy" @click="review"
          >AI 校对歌词</n-button
        >
      </div>
      <p class="mt-2 text-sm text-neutral-500">
        每个模型首次使用需下载约 1.1 GB，歌词只在本机处理。
      </p>
    </template>
    <p v-if="status" role="status" class="mt-2 whitespace-pre-wrap break-words text-sm">
      {{ status }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import LocalAiModelSelect from './LocalAiModelSelect.vue';
import { localAiModel, useLocalAiTask } from './useLocalAiTask';

const props = defineProps<{ text: string; lrc?: string; documentId?: string; disabled: boolean }>();
const emit = defineEmits<{
  busy: [busy: boolean];
  applied: [lyrics: { text: string; lrc?: string }];
}>();

const { running, engineBusy, stage, canceling, run, cancel } = useLocalAiTask();
const applying = ref(false);
const status = ref('');
const suggestions = ref<string[]>([]);
const selected = ref<number[]>([]);
const originals = computed(() => props.text.split(/\r?\n/));
const changes = computed(() => {
  const timestamps = props.lrc?.split(/\r?\n/);
  return suggestions.value.flatMap((suggestion, index) =>
    suggestion === originals.value[index]
      ? []
      : [
          {
            index,
            suggestion,
            original: originals.value[index],
            time: timestamps?.[index]?.match(/^(?:\[\d+:\d{2}(?:[.:]\d+)?\])+/)?.[0] || ''
          }
        ]
  );
});

watch(
  () => running.value || applying.value,
  (busy) => emit('busy', busy),
  { flush: 'sync' }
);

function discard(): void {
  suggestions.value = [];
  selected.value = [];
  status.value = '';
}

async function review(): Promise<void> {
  if (engineBusy.value || props.disabled || applying.value) return;
  discard();
  try {
    const response = await run(() =>
      window.api.reviewLyrics({ text: props.text, model: localAiModel.value })
    );
    if (response.canceled) {
      status.value = '已取消校对。';
      return;
    }
    if (!response.lines || response.lines.length !== originals.value.length) {
      status.value = response.message || '校对结果与原文行数不一致，请重试。';
      return;
    }
    suggestions.value = response.lines;
    selected.value = changes.value.map((item) => item.index);
    if (!changes.value.length) status.value = '校对完成，没有修改建议。';
  } catch (error) {
    status.value = error instanceof Error ? error.message : String(error);
  }
}

async function apply(): Promise<void> {
  if (applying.value || props.disabled || !selected.value.length) return;
  applying.value = true;
  status.value = '';
  try {
    const accepted = new Set(selected.value);
    const response = await window.api.applyLyricsReview({
      documentId: props.documentId,
      originalText: props.text,
      originalLrc: props.lrc,
      lines: originals.value.map((line, index) =>
        accepted.has(index) ? suggestions.value[index] : line
      )
    });
    if (!response.text) {
      status.value = response.message || '未能应用修改，请重试。';
      return;
    }
    emit('applied', { text: response.text, lrc: response.lrc });
    discard();
    status.value = `已采用 ${accepted.size} 行修改。`;
  } catch (error) {
    status.value = error instanceof Error ? error.message : String(error);
  } finally {
    applying.value = false;
  }
}
</script>
