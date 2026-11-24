<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    :title="doc ? doc.category + ' · ' + doc.title : '聚会歌单'"
    style="width: min(760px, 94vw)"
    @after-leave="stop"
  >
    <template v-if="doc">
      <audio
        v-if="url"
        ref="audio"
        :src="url"
        controls
        style="width: 100%"
        @timeupdate="repeatLine"
      />
      <div class="my-3 flex flex-wrap gap-2">
        <n-button @click="mark">空格打点</n-button
        ><n-button @click="loop = !loop">单句循环 {{ loop ? '开' : '关' }}</n-button>
        <n-button @click="split">从光标拆行</n-button
        ><n-button :disabled="pos + 1 >= lines.length" @click="merge">合并下一行</n-button>
        <n-button type="primary" @click="save">保存校对</n-button>
      </div>
      <div style="max-height: 34vh; overflow: auto">
        <div
          v-for="(l, i) in lines"
          :key="i"
          class="flex items-center gap-2 py-1"
          :style="{ background: i === pos ? '#22a87726' : '' }"
        >
          <button :aria-label="'播放第' + (i + 1) + '行'" @click="seek(i)">
            ▶ {{ (l.ms / 1000).toFixed(2) }}s
          </button>
          <input
            v-model="l.text"
            class="flex-1 bg-transparent p-1"
            @focus="pos = i"
            @select="cursor = ($event.target as HTMLInputElement).selectionStart ?? 0"
            @click="cursor = ($event.target as HTMLInputElement).selectionStart ?? 0"
          />
        </div>
      </div>
    </template>
    <div class="my-4 flex flex-wrap gap-2">
      <select
        v-model="name"
        aria-label="选择聚会歌单"
        class="rounded bg-neutral-100 p-2 text-black"
        @change="at = 0"
      >
        <option v-for="(_, k) in lists" :key="k">{{ k }}</option>
      </select>
      <n-input v-model:value="newName" placeholder="新歌单名称" style="width: 130px" /><n-button
        @click="create"
        >新建</n-button
      >
      <n-button v-if="doc" @click="add">加入歌单</n-button>
    </div>
    <div v-for="(id, i) in lists[name]" :key="i" class="flex items-center gap-3">
      <button class="flex-1 text-left" @click="selectSong(i)">{{ i + 1 }}. {{ label(id) }}</button>
      <button :disabled="!i" @click="up(i)">上移</button
      ><button @click="lists[name].splice(i, 1)">移除</button>
    </div>
    <div class="mt-4 flex flex-wrap gap-2">
      <n-button :disabled="!lines.length" @click="project">投影当前行</n-button
      ><n-button @click="step(-1)">上一行</n-button><n-button @click="step(1)">下一行</n-button>
      <n-button @click="closeProjection">结束投影</n-button>
    </div>
    <p v-if="projecting" class="mt-2">
      下一行：{{ lines[pos + 1]?.text || '本首结束' }} · ← → 翻行，↑ ↓ 切歌
    </p>
    <div class="mt-5 flex flex-wrap gap-2 border-t pt-3">
      <n-button @click="backup">备份歌库</n-button><n-button @click="restore">恢复备份</n-button
      ><n-button @click="relink">重新关联音乐目录</n-button>
    </div>
  </n-modal>
</template>
<script setup lang="ts">
import { ref, watch, onBeforeUnmount, nextTick } from 'vue';
import type { HymnDocument } from '../../../shared/hymnLibrary';
import { filePathToLocalUrl } from '../../../shared/localUrl';
const props = defineProps<{ documents: HymnDocument[]; lyrics: Record<string, string[]> }>();
const emit = defineEmits<{ changed: [] }>();
const msg = useMessage(),
  visible = ref(false),
  doc = ref<HymnDocument | null>(null),
  lines = ref<{ ms: number; text: string }[]>([]);
const audio = ref<HTMLAudioElement | null>(null),
  url = ref(''),
  pos = ref(0),
  at = ref(0),
  loop = ref(false),
  cursor = ref(0),
  projecting = ref(false);
const lists = ref<Record<string, string[]>>(
  JSON.parse(localStorage.getItem('poems-services') || '{"聚会歌单":[]}')
);
const name = ref(Object.keys(lists.value)[0]),
  newName = ref('');
watch(lists, (v) => localStorage.setItem('poems-services', JSON.stringify(v)), { deep: true });
const api = (channel: string, ...args: any[]) => window.api.invoke('poems:' + channel, ...args);
const label = (id: string) => {
  const d = props.documents.find((x) => x.id === id);
  return d ? d.category + ' · ' + d.title : '歌谱已移除';
};
function create() {
  const k = newName.value.trim();
  if (!k || k in lists.value) return;
  lists.value[k] = [];
  name.value = k;
  at.value = 0;
  newName.value = '';
}
function add() {
  if (doc.value) lists.value[name.value].push(doc.value.id);
}
function up(i: number) {
  const a = lists.value[name.value];
  a.splice(i - 1, 0, ...a.splice(i, 1));
}
let generation = 0;
async function open(d?: HymnDocument, hit?: string) {
  const token = ++generation;
  audio.value?.pause();
  pos.value = 0;
  url.value = '';
  doc.value = d || null;
  visible.value = true;
  lines.value = [];
  if (!d) return;
  try {
    const saved = await window.api.getRecognizedLyrics(d.id);
    const playback = d.hasAudio ? await window.api.getHymnPlayback(d.id) : null;
    if (token !== generation) return;
    const timed = (saved?.lrc || playback?.lyrics || '').split(/\r?\n/).flatMap((s) => {
      const m = s.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
      return m ? [{ ms: Math.round((+m[1] * 60 + +m[2]) * 1000), text: m[3] }] : [];
    });
    lines.value = timed.length
      ? timed
      : (saved?.text?.split(/\r?\n/) || props.lyrics[d.id] || ['']).map((text) => ({
          ms: 0,
          text
        }));
    if (playback) url.value = filePathToLocalUrl(playback.audioPath);
    if (hit) {
      const i = lines.value.findIndex((l) => l.text === hit);
      if (i >= 0) {
        await nextTick();
        seek(i);
      }
    }
  } catch (e) {
    msg.error(String(e));
  }
}
async function selectSong(i: number) {
  const d = props.documents.find((x) => x.id === lists.value[name.value]?.[i]);
  if (d) {
    at.value = i;
    await open(d);
    if (projecting.value) await project();
  }
}
function seek(i: number) {
  pos.value = i;
  if (audio.value) {
    audio.value.currentTime = lines.value[i].ms / 1000;
    void audio.value.play().catch(() => {});
  }
}
function repeatLine() {
  const a = audio.value;
  if (!a || !loop.value || a.paused) return;
  const end = lines.value[pos.value + 1]?.ms ?? a.duration * 1000;
  if (end > lines.value[pos.value].ms && a.currentTime * 1000 >= end)
    a.currentTime = lines.value[pos.value].ms / 1000;
}
function mark() {
  if (!audio.value || !lines.value[pos.value]) return;
  lines.value[pos.value].ms = Math.round(audio.value.currentTime * 1000);
  pos.value = Math.min(pos.value + 1, lines.value.length - 1);
}
function split() {
  const l = lines.value[pos.value];
  if (!l) return;
  const c = cursor.value;
  if (c < 1 || c >= l.text.length) {
    msg.info('先在歌词中点击拆分位置');
    return;
  }
  lines.value.splice(pos.value + 1, 0, { ms: l.ms, text: l.text.slice(c) });
  l.text = l.text.slice(0, c);
}
function merge() {
  const [n] = lines.value.splice(pos.value + 1, 1);
  if (n) lines.value[pos.value].text += n.text;
}
async function save() {
  try {
    await api('edit', doc.value!.id, JSON.parse(JSON.stringify(lines.value)));
    emit('changed');
    msg.success('已保存');
  } catch (e) {
    msg.error(String(e));
  }
}
async function project() {
  if (lines.value[pos.value]) {
    await api('project', lines.value[pos.value].text);
    projecting.value = true;
  }
}
async function closeProjection() {
  await api('project', null);
  projecting.value = false;
}
async function step(delta: number) {
  pos.value = Math.max(0, Math.min(lines.value.length - 1, pos.value + delta));
  if (projecting.value) await project();
}
function keys(e: KeyboardEvent) {
  if (!visible.value || ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName))
    return;
  if (e.code === 'Space' && audio.value) {
    e.preventDefault();
    mark();
  } else if (projecting.value && e.key.startsWith('Arrow')) {
    e.preventDefault();
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') void step(e.key === 'ArrowLeft' ? -1 : 1);
    else void selectSong(at.value + (e.key === 'ArrowUp' ? -1 : 1));
  }
}
const keysToSave = ['poems-services', 'poems-piano-order', 'poems-piano-scores', 'favoriteList', 'favoriteSongDetails'];
async function backup() {
  try {
    const data = Object.fromEntries(
      keysToSave.map((k) => [k, localStorage.getItem(k)]).filter((a) => a[1] !== null)
    );
    if (await api('backup', data)) msg.success('备份已保存');
  } catch (e) {
    msg.error(String(e));
  }
}
async function restore() {
  try {
    const data = await api('restore');
    if (data) {
      for (const k of keysToSave) {
        if (k in data) localStorage.setItem(k, data[k]);
        else localStorage.removeItem(k);
      }
      location.reload();
    }
  } catch (e) {
    msg.error(String(e));
  }
}
async function relink() {
  try {
    const n = await api('relink');
    if (n !== null) {
      emit('changed');
      msg.info('已重新关联 ' + n + ' 首');
    }
  } catch (e) {
    msg.error(String(e));
  }
}
function stop() {
  generation++;
  audio.value?.pause();
  if (projecting.value) void closeProjection();
}
window.addEventListener('keydown', keys);
onBeforeUnmount(() => {
  window.removeEventListener('keydown', keys);
  stop();
});
defineExpose({ open });
</script>
