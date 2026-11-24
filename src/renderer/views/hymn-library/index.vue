<template>
  <div class="h-full w-full bg-white text-neutral-900 dark:bg-black dark:text-white">
    <n-scrollbar class="h-full">
      <header class="border-b border-neutral-200 px-8 pb-5 pt-6 dark:border-neutral-800">
        <div class="flex flex-wrap items-end justify-between gap-5">
          <div>
            <h1 class="text-2xl font-bold">诗歌本</h1>
            <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              {{ totalCount }} 份诗歌谱 · {{ audioCount }} 首已匹配音频
            </p>
          </div>
          <div class="flex flex-wrap items-center justify-end gap-2">
            <n-button v-if="isElectron" secondary @click="workshop?.open()"
              >聚会歌单与备份</n-button
            >
            <n-button v-if="isElectron" secondary @click="localAiDialog?.open()">
              <template #icon><i class="ri-chat-3-line" /></template>
              本地 AI
            </n-button>
            <n-button v-if="isElectron" secondary @click="recognitionDialog?.open()">
              <template #icon><i class="ri-file-music-line" /></template>
              从文件识别歌词
            </n-button>
            <n-button secondary @click="showCreateModal = true">
              <template #icon><i class="ri-add-line" /></template>
              新建诗歌本
            </n-button>
            <n-button
              v-if="activeCustomBook"
              secondary
              :loading="importingPdfs"
              @click="importPdfs"
            >
              <template #icon><i class="ri-file-add-line" /></template>
              导入 PDF
            </n-button>
            <n-button
              v-if="selectedCategory !== '全部'"
              type="primary"
              :loading="importingAudio"
              @click="importAudio"
            >
              <template #icon><i class="ri-folder-music-line" /></template>
              匹配 MP3
            </n-button>
          </div>
        </div>
        <div class="mt-5 flex items-center gap-3">
          <n-input
            v-model:value="searchKeyword"
            class="max-w-md"
            clearable
            placeholder="搜歌词、歌名、编号或文件名"
          >
            <template #prefix><i class="ri-search-line text-neutral-400" /></template>
          </n-input>
          <n-button
            v-if="activeCustomBook"
            quaternary
            type="error"
            title="删除当前自定义诗歌本"
            @click="removeActiveBook"
          >
            <template #icon><i class="ri-delete-bin-line" /></template>
          </n-button>
        </div>
      </header>

      <div class="px-8 pb-32 pt-5">
        <div class="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="诗歌分类">
          <button
            v-for="category in categories"
            :key="category.name"
            class="category-tab"
            :class="{ active: selectedCategory === category.name }"
            type="button"
            @click="selectedCategory = category.name"
          >
            <span>{{ category.name }}</span>
            <span class="count">{{ category.count }}</span>
            <i v-if="category.custom" class="ri-user-line text-xs" title="自定义诗歌本" />
          </button>
        </div>

        <div
          v-if="selectedCategory === '全部'"
          class="mb-4 border-l-2 border-primary bg-neutral-50 px-4 py-3 text-sm text-neutral-600 dark:bg-neutral-900/60 dark:text-neutral-300"
        >
          选择一本诗歌本后，可按 MP3 文件名中的编号自动匹配音频；首次播放会从 PDF
          提取歌词并生成滚动时间轴。
        </div>

        <div class="overflow-hidden border-y border-neutral-200 dark:border-neutral-800">
          <div
            class="document-grid bg-neutral-50 px-4 py-2 text-xs font-semibold text-neutral-500 dark:bg-neutral-900/70 dark:text-neutral-400"
          >
            <span>编号</span>
            <span>分类</span>
            <span>文件</span>
            <span>音频</span>
            <span class="sr-only">操作</span>
          </div>

          <div v-if="loading" class="flex items-center justify-center py-24">
            <n-spin size="small" />
          </div>

          <div
            v-else-if="filteredDocuments.length === 0"
            class="flex flex-col items-center justify-center py-24 text-neutral-400"
          >
            <i class="ri-file-music-line mb-3 text-4xl" />
            <p>{{ emptyText }}</p>
            <n-button
              v-if="activeCustomBook"
              class="mt-4"
              secondary
              :loading="importingPdfs"
              @click="importPdfs"
            >
              导入 PDF
            </n-button>
          </div>

          <div
            v-for="document in filteredDocuments"
            v-else
            :key="document.id"
            class="document-grid document-row"
            @dblclick="document.hasAudio ? playDocument(document) : openDocument(document)"
          >
            <span class="font-semibold tabular-nums">{{ document.number }}</span>
            <span class="text-neutral-600 dark:text-neutral-300">{{ document.category }}</span>
            <button
              class="min-w-0 truncate text-left text-sm text-neutral-400"
              @click="openDocument(document)"
            >
              {{ document.relativePath
              }}<small v-if="hits[document.id]" class="block truncate text-primary">{{
                hits[document.id]
              }}</small>
            </button>
            <span
              class="min-w-0 truncate text-sm"
              :class="
                document.hasAudio ? 'text-neutral-700 dark:text-neutral-200' : 'text-neutral-400'
              "
            >
              {{ document.audioFileName || '尚未匹配' }}
            </span>
            <div class="flex items-center justify-end gap-1" @dblclick.stop>
              <button v-if="isElectron" class="rounded-full px-2 py-1 text-sm hover:bg-rose-100 dark:hover:bg-neutral-800" title="写心迹" @click="journal?.open('hymn:'+document.id, document.title, document.category)"><i class="ri-quill-pen-line"/> 心迹</button>
              <button
                v-if="isElectron"
                title="校对、从匹配句播放或加入歌单"
                @click="workshop?.open(document, hits[document.id])"
              >
                编排
              </button>
              <button
                v-if="isElectron"
                class="h-8 w-8 shrink-0 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800"
                type="button"
                title="识别歌词"
                :aria-label="`识别${document.category}《${document.title}》的歌词`"
                @click="recognitionDialog?.open(document)"
              >
                <i class="ri-file-text-line" />
              </button>
              <n-button
                v-if="document.hasAudio"
                quaternary
                circle
                title="播放并显示滚动歌词"
                :loading="playingId === document.id"
                @click="playDocument(document)"
              >
                <template #icon><i class="ri-play-fill text-primary" /></template>
              </n-button>
              <n-button quaternary circle title="打开 PDF" @click="openDocument(document)">
                <template #icon><i class="ri-file-pdf-2-line" /></template>
              </n-button>
            </div>
          </div>
        </div>
      </div>
    </n-scrollbar>

    <song-journal ref="journal" />
    <service-workshop
      v-if="isElectron"
      ref="workshop"
      :documents="documents"
      :lyrics="lyrics"
      @changed="reloadLibrary"
    />
    <lyrics-recognition-dialog @changed="refreshLyrics" v-if="isElectron" ref="recognitionDialog" />
    <local-ai-dialog v-if="isElectron" ref="localAiDialog" />

    <n-modal
      v-model:show="showCreateModal"
      preset="dialog"
      title="新建自定义诗歌本"
      positive-text="创建"
      negative-text="取消"
      :positive-button-props="{ disabled: !newBookName.trim(), loading: creatingBook }"
      @positive-click="createBook"
    >
      <n-input
        v-model:value="newBookName"
        class="mt-3"
        maxlength="40"
        show-count
        placeholder="例如：主日敬拜诗歌"
        @keyup.enter="createBook"
      />
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue';

import type { CustomHymnBook, HymnDocument } from '../../../shared/hymnLibrary';
import SongJournal from '@/components/player/SongJournal.vue';
import ServiceWorkshop from './ServiceWorkshop.vue';
import baseIndex from './search-index.json';
import LocalAiDialog from './LocalAiDialog.vue';
import LyricsRecognitionDialog from './LyricsRecognitionDialog.vue';
import { usePlayerStore } from '@/store/modules/player';
import type { LocalMusicEntry } from '@/types/localMusic';
import { isElectron } from '@/utils';
import { toSongResult } from '@/utils/localMusicUtils';

const PREVIEW_COUNTS: Record<string, number> = {
  儿童诗歌: 330,
  唱诗人: 126,
  大本: 789,
  新歌颂咏: 156,
  补充本: 513
};

const message = useMessage();
const dialog = useDialog();
const playerStore = usePlayerStore();
const documents = shallowRef<HymnDocument[]>([]);
const customBooks = ref<CustomHymnBook[]>([]);
const loading = ref(true);
const rootAvailable = ref(false);
const searchKeyword = ref('');
const selectedCategory = ref('全部');
const showCreateModal = ref(false);
const newBookName = ref('');
const creatingBook = ref(false);
const importingPdfs = ref(false);
const importingAudio = ref(false);
const playingId = ref<string | null>(null);
const recognitionDialog = ref<InstanceType<typeof LyricsRecognitionDialog> | null>(null);
const localAiDialog = ref<InstanceType<typeof LocalAiDialog> | null>(null);

const totalCount = computed(() =>
  documents.value.length > 0
    ? documents.value.length
    : Object.values(PREVIEW_COUNTS).reduce((sum, count) => sum + count, 0)
);
const audioCount = computed(() => documents.value.filter((document) => document.hasAudio).length);
const activeCustomBook = computed(() =>
  customBooks.value.find((book) => book.name === selectedCategory.value)
);

const categories = computed(() => {
  const counts = new Map<string, number>();
  for (const document of documents.value) {
    counts.set(document.category, (counts.get(document.category) ?? 0) + 1);
  }
  const source = counts.size > 0 ? Object.fromEntries(counts) : PREVIEW_COUNTS;
  const items = Object.entries(source).map(([name, count]) => ({
    name,
    count,
    custom: customBooks.value.some((book) => book.name === name)
  }));
  for (const book of customBooks.value) {
    if (!items.some((item) => item.name === book.name)) {
      items.push({ name: book.name, count: 0, custom: true });
    }
  }
  return [{ name: '全部', count: totalCount.value, custom: false }, ...items];
});

const journal = ref<InstanceType<typeof SongJournal>|null>(null);
const workshop = ref<InstanceType<typeof ServiceWorkshop> | null>(null);
const lyrics = shallowRef<Record<string, string[]>>(baseIndex);
async function refreshLyrics() {
  lyrics.value = { ...baseIndex, ...(await window.api.invoke('poems:lyrics')) };
}
const normalize = (s: string) =>
  s
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}]+/gu, '');
const hits = computed(() => {
  const q = normalize(searchKeyword.value),
    found: Record<string, string> = {};
  if (q)
    for (const [id, rows] of Object.entries(lyrics.value)) {
      const row = rows.find((line) => normalize(line).includes(q));
      if (row) found[id] = row;
    }
  return found;
});
const searchFields = computed(() =>
  documents.value.map((document) =>
    [document.number, document.category, document.relativePath, document.audioFileName ?? ''].map(
      (field) => field.toLocaleLowerCase('zh-CN')
    )
  )
);

const filteredDocuments = computed(() => {
  const keyword = searchKeyword.value.trim().toLocaleLowerCase('zh-CN');
  const category = selectedCategory.value;
  if (category === '全部' && !keyword) return documents.value;

  return documents.value.filter(
    (document, index) =>
      (category === '全部' || document.category === category) &&
      (!keyword ||
        hits.value[document.id] ||
        searchFields.value[index].some((field) => field.includes(keyword)))
  );
});

const emptyText = computed(() => {
  if (!rootAvailable.value && customBooks.value.length === 0) return '诗歌谱资源尚未加载';
  if (activeCustomBook.value && !searchKeyword.value) return '这本诗歌本还没有 PDF';
  return '没有匹配的诗歌谱';
});

const reloadLibrary = async (): Promise<void> => {
  const result = await window.api.listHymnDocuments();
  rootAvailable.value = result.rootAvailable;
  documents.value = result.documents;
  customBooks.value = result.customBooks;
  await refreshLyrics();
};

const createBook = async (): Promise<boolean> => {
  if (!newBookName.value.trim() || creatingBook.value) return false;
  creatingBook.value = true;
  try {
    const book = await window.api.createCustomHymnBook(newBookName.value);
    await reloadLibrary();
    selectedCategory.value = book.name;
    newBookName.value = '';
    showCreateModal.value = false;
    message.success('自定义诗歌本已创建');
    return true;
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
    return false;
  } finally {
    creatingBook.value = false;
  }
};

const importPdfs = async (): Promise<void> => {
  const book = activeCustomBook.value;
  if (!book || importingPdfs.value) return;
  importingPdfs.value = true;
  try {
    const result = await window.api.importCustomHymnPdfs(book.id);
    if (!result.canceled) {
      await reloadLibrary();
      message.success(`已导入 ${result.imported} 份 PDF`);
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  } finally {
    importingPdfs.value = false;
  }
};

const importAudio = async (): Promise<void> => {
  if (selectedCategory.value === '全部' || importingAudio.value) return;
  importingAudio.value = true;
  try {
    const result = await window.api.importHymnAudio(selectedCategory.value);
    if (!result.canceled) {
      await reloadLibrary();
      const unmatched = result.unmatched?.length ?? 0;
      message.success(`识别 ${result.imported} 个 MP3，成功匹配 ${result.matched ?? 0} 首`);
      if (unmatched > 0) message.warning(`${unmatched} 个文件名未能匹配，请检查诗歌编号`);
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  } finally {
    importingAudio.value = false;
  }
};

const removeActiveBook = (): void => {
  const book = activeCustomBook.value;
  if (!book) return;
  dialog.warning({
    title: '删除自定义诗歌本',
    content: `确定删除“${book.name}”及其已导入 PDF 吗？外部 MP3 文件不会被删除。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await window.api.removeCustomHymnBook(book.id);
      selectedCategory.value = '全部';
      await reloadLibrary();
      message.success('诗歌本已删除');
    }
  });
};

const openDocument = async (document: HymnDocument): Promise<void> => {
  if (!isElectron) return;
  const error = await window.api.openHymnDocument(document.id);
  if (error) message.error(error);
};

const playDocument = async (document: HymnDocument): Promise<void> => {
  if (!document.hasAudio || playingId.value) return;
  playingId.value = document.id;
  try {
    const playback = await window.api.getHymnPlayback(document.id);
    if (!playback) {
      message.error('MP3 文件已移动或无法读取，请重新匹配');
      return;
    }
    const entry: LocalMusicEntry = {
      id: `hymn:${playback.id}`,
      filePath: playback.audioPath,
      title: playback.title,
      artist: playback.artist,
      album: playback.album,
      duration: playback.duration,
      coverPath: null,
      lyrics: playback.lyrics,
      fileSize: 0,
      modifiedTime: 0
    };
    const song = toSongResult(entry);
    playerStore.setPlayList([song]);
    await playerStore.setPlay(song);
    if (!playback.lyrics) message.warning('这份 PDF 未提取到可用歌词，仍可正常播放音频');
  } catch (error) {
    console.error('播放诗歌失败:', error);
    message.error('播放失败，请检查 PDF 和 MP3 文件');
  } finally {
    playingId.value = null;
  }
};

onMounted(async () => {
  if (!isElectron) {
    loading.value = false;
    return;
  }
  try {
    await reloadLibrary();
  } catch (error) {
    console.error('加载诗歌谱失败:', error);
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.category-tab {
  @apply flex h-9 items-center gap-2 border border-neutral-200 bg-white px-3 text-sm text-neutral-600 transition-colors hover:border-neutral-300 hover:text-neutral-900 dark:border-neutral-800 dark:bg-black dark:text-neutral-300 dark:hover:border-neutral-700 dark:hover:text-white;
  border-radius: 6px;
}

.category-tab.active {
  @apply border-primary bg-primary/10 font-semibold text-primary dark:border-primary;
}

.category-tab .count {
  @apply text-xs tabular-nums text-neutral-400;
}

.category-tab.active .count {
  @apply text-primary;
}

.document-grid {
  display: grid;
  grid-template-columns: 90px 130px minmax(180px, 1fr) minmax(160px, 0.8fr) 178px;
  align-items: center;
  gap: 16px;
}

.document-row {
  @apply border-t border-neutral-100 px-4 py-3 transition-colors hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900/60;
  min-height: 56px;
}

@media (max-width: 900px) {
  .document-grid {
    grid-template-columns: 70px minmax(100px, 1fr) 178px;
  }

  .document-grid > :nth-child(2),
  .document-grid > :nth-child(4) {
    display: none;
  }
}
</style>
