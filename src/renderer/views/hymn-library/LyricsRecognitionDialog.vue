<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    title="识别歌词"
    class="max-h-[90vh] overflow-y-auto"
    style="width: min(560px, 92vw)"
    :closable="!busy"
    :mask-closable="!busy"
    :close-on-esc="!busy"
  >
    <p class="mb-3 break-words font-semibold">{{ target?.relativePath || '选择本地文件' }}</p>
    <div class="flex flex-wrap gap-2">
      <n-button
        secondary
        :disabled="busy || target?.hasAudio === false"
        :title="target && !target.hasAudio ? '请先为这首诗歌匹配音频' : undefined"
        @click="recognize('audio')"
      >
        <template #icon><i class="ri-music-2-line" /></template>
        {{ target ? '从匹配音频识别' : '选择音频' }}
      </n-button>
      <n-button secondary :disabled="busy" @click="recognize('pdf')">
        <template #icon><i class="ri-file-pdf-2-line" /></template>
        {{ target ? '从当前 PDF 识别' : '选择 PDF' }}
      </n-button>
    </div>
    <p v-if="target && !target.hasAudio" class="mt-2 text-sm text-neutral-500">
      这首诗歌尚未匹配音频，可从 PDF 识别。
    </p>
    <p v-if="loadingSaved" role="status" class="mt-2 text-sm text-neutral-500">
      正在读取已保存的歌词…
    </p>
    <div v-if="activeSource" class="mt-4" role="status">
      <div class="flex items-center gap-2">
        <n-spin size="small" />
        {{ canceling ? '正在取消…' : activeSource === 'audio' ? '正在识别音频…' : '正在识别 PDF…' }}
        <n-button size="small" :disabled="canceling" @click="cancel">取消识别</n-button>
      </div>
      <p v-if="activeSource === 'audio'" class="mt-2 text-sm text-neutral-500">
        首次使用需联网下载引擎和模型，准备完成后可离线识别。
      </p>
    </div>
    <p v-if="notice" role="status" class="mt-3 whitespace-pre-wrap break-words">{{ notice }}</p>
    <section v-if="preview && !activeSource" class="mt-4">
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 class="font-semibold">
          {{ resultSource === 'audio' ? '音频识别结果' : 'PDF 识别结果' }}
        </h3>
        <n-radio-group
          v-if="result?.text && result.lrc"
          v-model:value="format"
          size="small"
          aria-label="歌词预览格式"
        >
          <n-radio-button value="txt">纯文本</n-radio-button>
          <n-radio-button value="lrc">时间轴（LRC）</n-radio-button>
        </n-radio-group>
      </div>
      <n-input
        type="textarea"
        :value="preview"
        readonly
        :autosize="{ minRows: 4, maxRows: 9 }"
        aria-label="识别出的歌词"
      />
      <p v-if="result?.timing === 'estimated'" class="mt-2 text-sm text-neutral-500">
        时间轴为估算值，可对照录音校对。
      </p>
      <p v-if="target?.hasAudio" class="mt-2 text-sm text-neutral-500">
        下次从诗歌本播放时将使用这份歌词。
      </p>
      <lyrics-review
        v-if="result?.text"
        :text="result.text"
        :lrc="result.lrc"
        :document-id="target?.id"
        :disabled="saving"
        @busy="reviewBusy = $event"
        @applied="updateLyrics"
      />
      <div class="mt-3 flex justify-end gap-2">
        <n-button secondary @click="copy">复制{{ format === 'lrc' ? ' LRC' : '歌词' }}</n-button>
        <n-button type="primary" :loading="saving" :disabled="reviewBusy" @click="save"
          >保存 {{ format.toUpperCase() }}</n-button
        >
      </div>
    </section>
  </n-modal>
</template>

<script setup lang="ts">
const emit = defineEmits<{ changed: [] }>();

import { useMessage } from 'naive-ui';
import { computed, ref, shallowRef, watch } from 'vue';

import type {
  HymnDocument,
  LyricsRecognitionRequest,
  LyricsRecognitionResult
} from '../../../shared/hymnLibrary';
import LyricsReview from './LyricsReview.vue';

type Source = LyricsRecognitionRequest['source'];

const message = useMessage();
const visible = ref(false);
const target = shallowRef<HymnDocument>();
const result = shallowRef<LyricsRecognitionResult>();
const loadingSaved = ref(false);
let loadVersion = 0;
const resultSource = ref<Source>();
const activeSource = ref<Source>();
const format = ref<'lrc' | 'txt'>('txt');
const saving = ref(false);
const reviewBusy = ref(false);
const canceling = ref(false);
const notice = ref('');
const busy = computed(() => Boolean(activeSource.value) || saving.value || reviewBusy.value);
const preview = computed(
  () => (format.value === 'lrc' ? result.value?.lrc : result.value?.text) || ''
);

function updateLyrics(lyrics: { text: string; lrc?: string }): void {
  result.value = { ...result.value, ...lyrics };
  if (!lyrics.lrc) format.value = 'txt';
}

async function open(document?: HymnDocument): Promise<void> {
  visible.value = true;
  if (busy.value) return;
  const version = ++loadVersion;
  loadingSaved.value = false;
  if (target.value?.id !== document?.id) {
    result.value = undefined;
    notice.value = '';
  }
  target.value = document;
  if (!document || result.value?.text || result.value?.lrc) return;
  loadingSaved.value = true;
  try {
    const saved = await window.api.getRecognizedLyrics(document.id);
    if (version === loadVersion && saved) {
      result.value = saved;
      resultSource.value = saved.source;
      format.value = saved.lrc ? 'lrc' : 'txt';
      notice.value = '';
    }
  } catch (error) {
    if (version === loadVersion)
      notice.value = error instanceof Error ? error.message : String(error);
  } finally {
    if (version === loadVersion) loadingSaved.value = false;
  }
}

async function recognize(source: Source): Promise<void> {
  if (busy.value) return;
  ++loadVersion;
  loadingSaved.value = false;
  activeSource.value = source;
  canceling.value = false;
  notice.value = '';
  try {
    const documentId = target.value?.id;
    const response = await window.api.recognizeLyrics(
      documentId ? { source, documentId } : { source }
    );
    if (response.canceled) return;
    result.value = response;
    resultSource.value = source;
    format.value = response.lrc ? 'lrc' : 'txt';
    notice.value =
      response.message || (preview.value.trim() ? '' : '没有识别到歌词，可换用另一种来源。');
  } catch (error) {
    result.value = undefined;
    notice.value = error instanceof Error ? error.message : String(error);
  } finally {
    activeSource.value = undefined;
    canceling.value = false;
  }
}

async function cancel(): Promise<void> {
  if (!activeSource.value || canceling.value) return;
  canceling.value = true;
  try {
    await window.api.cancelLyricsRecognition();
  } catch (error) {
    canceling.value = false;
    message.error(error instanceof Error ? error.message : String(error));
  }
}

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(preview.value);
    message.success('已复制');
  } catch {
    message.error('无法写入剪贴板，请在预览框中选中并复制歌词。');
  }
}

async function save(): Promise<void> {
  if (busy.value || !preview.value) return;
  saving.value = true;
  try {
    if (await window.api.saveRecognizedLyrics(preview.value, format.value))
      message.success('歌词已保存');
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  } finally {
    saving.value = false;
  }
}

watch(visible, (value) => {
  if (!value) emit('changed');
});
defineExpose({ open });
</script>
