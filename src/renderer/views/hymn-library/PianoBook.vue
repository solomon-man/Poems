<template>
  <n-modal v-model:show="visible" preset="card" title="司琴歌单" style="width: min(920px, 95vw)">
    <div class="piano-layout">
      <aside>
        <p class="eyebrow">演奏顺序</p>
        <button
          v-for="(id, i) in queue"
          :key="id"
          class="piece"
          :class="{ selected: id === active }"
          @click="select(id)"
        >
          <small>{{ String(i + 1).padStart(2, '0') }}</small> {{ title(id) }}
        </button>
        <div class="tools">
          <n-button size="small" :disabled="index < 1" @click="move(-1)">上移</n-button
          ><n-button
            size="small"
            :disabled="index < 0 || index >= queue.length - 1"
            @click="move(1)"
            >下移</n-button
          >
        </div>
        <n-button v-if="index >= 0" size="small" text @click="remove">从歌单移除</n-button>
      </aside>
      <section v-if="active">
        <div class="tools">
          <n-button v-if="index < 0" type="primary" @click="queue.push(active)"
            >加入司琴歌单</n-button
          >
          <n-button @click="editing = !editing">{{
            editing ? '查看白版' : '编辑作者与和弦'
          }}</n-button>
        </div>
        <div v-if="editing" class="edit">
          <label
            >词曲作者<input v-model="current.author" placeholder="按原谱填写，可用顿号分隔"
          /></label>
          <label
            >和弦谱<textarea
              v-model="current.chart"
              rows="8"
              placeholder="把和弦写在对应歌词前，例如：[C]第一句 [G7]第二句"
            />
          </label>
        </div>
        <div class="score">
          <p class="eyebrow">司琴 · 和弦谱</p>
          <h2>{{ title(active) }}</h2>
          <p>{{ current.author || '作者待补录' }}</p>
          <div v-for="(line, i) in rows" :key="i" class="music-line">
            <span v-for="(part, j) in line" :key="j"
              ><b>{{ part.chord || ' ' }}</b
              >{{ part.words || ' ' }}</span
            >
          </div>
          <p v-if="!current.chart.trim()" class="hint">点击「编辑作者与和弦」录入原谱。</p>
        </div>
      </section>
      <p v-else>在诗歌本点击歌曲的「司琴谱」，即可编谱并加入歌单。</p>
    </div>
  </n-modal>
</template>
<script setup lang="ts">
import printedCredits from './credits.json';
import { computed, ref, watch } from 'vue';
import type { HymnDocument } from '../../../shared/hymnLibrary';
const props = defineProps<{
  documents: HymnDocument[];
  lyrics: Record<string, string[]>;
  scores: Record<string, { author: string; chart: string }>;
}>();
const emit = defineEmits<{ change: [id: string, value: { author: string; chart: string }] }>();
const example = 'piano:warmup',
  visible = ref(false),
  editing = ref(false),
  active = ref('');
const queue = ref<string[]>(
  JSON.parse(localStorage.getItem('poems-piano-order') || JSON.stringify([example]))
);
const current = ref({ author: '', chart: '' });
const index = computed(() => queue.value.indexOf(active.value));
function title(id: string) {
  const d = props.documents.find((x) => x.id === id);
  return id === example ? '和弦热身 · 四小节' : d ? d.category + ' · ' + d.title : '歌谱已移除';
}
function select(id: string) {
  active.value = id;
  editing.value = false;
  const d = props.documents.find((x) => x.id === id);
  current.value = {
    ...(props.scores[id] ??
      (id === example
        ? {
            author: 'Poems 练习谱',
            chart: '[C]1  3  5  3    [Am]6  1  3  1\n[F]4  6  1  6    [G7]5  7  2  4'
          }
        : {
            author: d?.authors?.join('、') || (printedCredits as Record<string, string>)[id] || '',
            chart: (props.lyrics[id] || []).join('\n')
          }))
  };
}
watch(
  current,
  () => {
    if (active.value && editing.value) emit('change', active.value, { ...current.value });
  },
  { deep: true, flush: 'sync' }
);
watch(queue, (v) => localStorage.setItem('poems-piano-order', JSON.stringify(v)), { deep: true });
function open(id?: string) {
  select(id || queue.value[0] || '');
  visible.value = true;
}
function move(delta: number) {
  const i = index.value;
  queue.value.splice(i + delta, 0, ...queue.value.splice(i, 1));
}
function remove() {
  queue.value.splice(index.value, 1);
  select(queue.value[0] || '');
}
const rows = computed(() =>
  current.value.chart.split(/\r?\n/).map((line) =>
    Array.from(line.matchAll(/(?:\[([^\]\n]+)\])?([^\[\n]*)/g))
      .filter((m) => m[0])
      .map((m) => ({ chord: m[1], words: m[2] }))
  )
);
defineExpose({ open });
</script>
<style scoped>
.piano-layout {
  display: grid;
  grid-template-columns: minmax(150px, 1fr) minmax(0, 3fr);
  gap: 22px;
  max-height: 70vh;
  overflow: auto;
}
.eyebrow {
  font-size: 12px;
  letter-spacing: 0.12em;
  font-weight: 650;
}
.piece {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  border-radius: 7px;
  padding: 9px 8px;
}
.piece small {
  opacity: 0.65;
}
.selected {
  background: #71849927;
}
.tools {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 10px 0;
}
.score {
  background: white;
  color: #222c35;
  border: 1px solid #d9dfe3;
  border-radius: 10px;
  padding: clamp(16px, 4vw, 38px);
  min-height: 220px;
}
.score h2 {
  font:
    600 28px/1.3 Georgia,
    SimSun,
    serif;
  margin: 8px 0;
}
.music-line {
  display: flex;
  flex-wrap: wrap;
  margin: 16px 0;
  min-height: 1em;
}
.music-line span {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.music-line b {
  display: block;
  color: #76451d;
  font: 700 15px/1.6 monospace;
}
.edit label {
  display: grid;
  margin: 8px 0;
  gap: 4px;
}
.edit input,
.edit textarea {
  padding: 8px;
  border: 1px solid #8996;
  border-radius: 6px;
  background: transparent;
}
.hint {
  color: #626d77;
}
@media (max-width: 650px) {
  .piano-layout {
    grid-template-columns: 1fr;
  }
}
</style>
