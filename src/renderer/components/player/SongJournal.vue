<template>
  <n-modal :show="visible" :mask-closable="false" :close-on-esc="false" @esc="close">
    <section class="journal" role="dialog" aria-modal="true" aria-labelledby="journal-heading">
      <header class="journal-head">
        <div class="journal-caption"><i class="ri-quill-pen-line" /> 心迹</div>
        <button class="dismiss" aria-label="关闭心迹" @click="close">
          <i class="ri-close-line" />
        </button>
        <h2 id="journal-heading">{{ /^\d+$/.test(title) ? '第 ' + title + ' 首' : title }}</h2>
        <p>{{ context || '歌曲随记' }}</p>
      </header>
      <div class="journal-body">
        <div v-if="loading" role="status">正在翻开心迹…</div>
        <template v-else>
          <label for="reflection-body">{{ editing ? '编辑心迹' : '写下此刻的感悟' }}</label>
          <textarea
            id="reflection-body"
            v-model="text"
            maxlength="10000"
            placeholder="这首歌，让你想起了什么？"
          />
          <div class="journal-actions">
            <small>{{ text.length.toLocaleString() }} / 10,000</small>
            <button v-if="editing" :disabled="busy" @click="reset">取消编辑</button>
            <button class="save" :disabled="busy || !text.trim()" @click="save">
              <i class="ri-quill-pen-line" /> {{ editing ? '保存修改' : '记下心迹' }}
            </button>
          </div>
          <div class="history-title">
            <h3>往日心迹</h3>
            <span>{{ notes.length }} 则</span>
          </div>
          <p v-if="!notes.length" class="empty">这首歌的第一则心迹，等你落笔。</p>
          <article v-for="note in notes" :key="note.id">
            <div class="entry-head">
              <time>{{ date(note.created) }}</time
              ><span v-if="note.updated !== note.created">已编辑</span>
              <button :disabled="busy" aria-label="编辑这则心迹" @click="edit(note)">
                <i class="ri-pencil-line" />
              </button>
              <button :disabled="busy" aria-label="删除这则心迹" @click="remove(note)">
                <i class="ri-delete-bin-line" />
              </button>
            </div>
            <p>{{ note.text }}</p>
          </article>
        </template>
      </div>
    </section>
  </n-modal>
</template>
<script setup lang="ts">
import { ref } from 'vue';
interface Entry {
  id: string;
  text: string;
  created: number;
  updated: number;
}
const visible = ref(false),
  loading = ref(false),
  busy = ref(false),
  key = ref(''),
  title = ref(''),
  context = ref(''),
  text = ref('');
const notes = ref<Entry[]>([]),
  editing = ref<Entry | null>(null);
const msg = useMessage(),
  dialog = useDialog();
const date = (ms: number) =>
  new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(ms);
function reset() {
  editing.value = null;
  text.value = '';
}
function discard(action: () => void) {
  if (text.value.trim() && text.value !== editing.value?.text) {
    dialog.warning({
      title: '放弃未保存的文字？',
      positiveText: '放弃',
      negativeText: '继续写',
      onPositiveClick: action
    });
  } else action();
}
function close() {
  if (!busy.value)
    discard(() => {
      visible.value = false;
      reset();
    });
}
function edit(n: Entry) {
  discard(() => {
    editing.value = n;
    text.value = n.text;
    document.querySelector<HTMLTextAreaElement>('#reflection-body')?.focus();
  });
}
async function open(song: string, name: string, category = '') {
  key.value = song;
  title.value = name;
  context.value = category;
  notes.value = [];
  reset();
  visible.value = true;
  loading.value = true;
  try {
    notes.value = await window.api.invoke('poems:notes', song);
  } catch (e) {
    msg.error(String(e));
    visible.value = false;
  } finally {
    loading.value = false;
  }
}
async function save() {
  if (busy.value || !text.value.trim()) return;
  busy.value = true;
  try {
    notes.value = await window.api.invoke(
      'poems:note-write',
      key.value,
      text.value,
      editing.value?.id,
      editing.value?.updated
    );
    reset();
    msg.success('心迹已保存到本机');
  } catch (e) {
    msg.error(String(e));
  } finally {
    busy.value = false;
  }
}
function remove(n: Entry) {
  dialog.warning({
    title: '删除这则心迹？',
    content: '删除后无法撤销。',
    positiveText: '删除',
    negativeText: '保留',
    async onPositiveClick() {
      busy.value = true;
      try {
        notes.value = await window.api.invoke('poems:note-write', key.value, null, n.id, n.updated);
        if (editing.value?.id === n.id) reset();
      } catch (e) {
        msg.error(String(e));
      } finally {
        busy.value = false;
      }
    }
  });
}
defineExpose({ open });
</script>
<style scoped>
.journal {
  --paper: #fffaf1;
  --ink: #352d30;
  --muted: #766268;
  --line: #dfd0ca;
  --accent: #783d51;
  --sheet: #fffdf8;
  width: min(590px, calc(100vw - 32px));
  max-height: 86vh;
  overflow: auto;
  background: var(--paper);
  color: var(--ink);
  border-radius: 22px;
  box-shadow: 0 24px 90px #170d174d;
  font-family: system-ui, sans-serif;
}
:global(.dark .journal) {
  --paper: #272326;
  --ink: #f1e8df;
  --muted: #c3b1b4;
  --line: #51434a;
  --sheet: #302a2d;
  --accent: #a85572;
}
.journal-head {
  position: relative;
  overflow: hidden;
  padding: 24px 34px 27px;
  color: #fff4e5;
  background:
    radial-gradient(ellipse at 100% 110%, #9a6470, transparent 57%),
    linear-gradient(115deg, #422b39, #714553);
}
.journal-head:after {
  content: '♪';
  position: absolute;
  right: 44px;
  bottom: -67px;
  font:
    185px Georgia,
    serif;
  transform: rotate(-14deg);
  color: #f5d5bc15;
  pointer-events: none;
}
.journal-caption {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  letter-spacing: 0.16em;
  color: #f0d0ca;
}
.journal-head h2 {
  position: relative;
  z-index: 1;
  margin: 18px 0 4px;
  font:
    600 clamp(26px, 4vw, 36px)/1.22 Georgia,
    'Songti SC',
    SimSun,
    serif;
  overflow-wrap: anywhere;
}
.journal-head p {
  margin: 0;
  color: #f0dbd3;
  font-size: 13px;
}
.dismiss {
  position: absolute;
  top: 18px;
  right: 20px;
  color: white;
  width: 32px;
  height: 32px;
  background: #ffffff18;
  border-radius: 50%;
}
.journal-body {
  padding: 23px clamp(16px, 4vw, 34px) 28px;
}
.journal-body label,
.history-title h3 {
  font-size: 15px;
  font-weight: 650;
}
.journal textarea {
  width: 100%;
  box-sizing: border-box;
  margin: 10px 0 0;
  padding: 11px 15px;
  min-height: 108px;
  resize: vertical;
  border: 1px solid var(--line);
  border-radius: 12px;
  color: var(--ink);
  background:
    repeating-linear-gradient(
        transparent 0 27px,
        color-mix(in srgb, var(--line) 52%, transparent) 27px 28px
      )
      0 10px/100% 28px,
    var(--sheet);
  font-size: 15px;
  line-height: 28px;
}
.journal textarea::placeholder {
  color: var(--muted);
}
.journal :focus-visible {
  outline: 2px solid #ba8094;
  outline-offset: 2px;
}
.journal-actions,
.entry-head,
.history-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.journal-actions {
  margin: 8px 0 23px;
}
.journal-actions small,
.entry-head time {
  margin-right: auto;
}
.journal-actions small,
.empty,
.entry-head,
.history-title span {
  color: var(--muted);
  font-size: 12px;
}
.journal button {
  cursor: pointer;
}
.journal button:disabled {
  opacity: 0.5;
  cursor: default;
}
.save {
  padding: 7px 15px;
  border-radius: 20px;
  background: var(--accent);
  color: white;
}
.history-title {
  padding-bottom: 9px;
  border-bottom: 1px solid var(--line);
}
.history-title h3 {
  margin: 0;
}
.empty {
  padding: 16px 0 2px;
}
.journal article {
  margin-top: 16px;
  padding-left: 13px;
  border-left: 2px solid #c28d9a;
}
.entry-head button {
  padding: 4px 6px;
  border-radius: 5px;
}
.entry-head button:hover {
  background: var(--line);
}
.journal article p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 6px 0;
  line-height: 1.75;
}
</style>
