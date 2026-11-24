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
            <n-button secondary :loading="readingScore" @click="readScore">识别蓝版 / 白版 PDF</n-button>
            <n-button type="primary" secondary @click="piano?.open()">司琴歌单</n-button>
            <n-button v-if="isElectron" secondary @click="workshop?.open()"
              >聚会歌单与备份</n-button
            >
            <n-button @click="showTools=!showTools" :aria-expanded="showTools">资料工具</n-button>
          </div>
        </div>
        <div v-if="showTools" class="mt-4 flex flex-wrap gap-2 rounded-lg border p-3"><div class="flex flex-wrap gap-2">
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
        <div class="mt-5 flex flex-wrap items-center gap-3">

          <n-input
            v-model:value="searchKeyword"
            class="max-w-md"
            clearable
            placeholder="搜作者、歌手、歌名或歌词"
          >
            <template #prefix><i class="ri-search-line text-neutral-400" /></template>
          </n-input>
          <n-button secondary @click="browseAuthors=!browseAuthors; selectedPerson=''">作者与歌手</n-button>
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
        <section v-if="selectedPerson" class="person-hero">
          <div class="person-avatar">{{selectedPerson.slice(0,1)}}</div><div><button @click="selectedPerson='';browseAuthors=true">‹ 所有作者与歌手</button><h2>{{selectedPerson}}</h2><p>{{filteredDocuments.length+localResults.length}} 首作品</p></div>
        </section>
        <section v-else-if="browseAuthors || (searchKeyword.trim() && foundPeople.length)" class="people-section">
          <h2>作者与歌手</h2><div class="people-list"><button v-for="person in foundPeople" :key="person.name" @click="openPerson(person.name)">
          <span>{{person.name.slice(0,1)}}</span><strong>{{person.name}}</strong><small>{{person.count}} 首 · {{person.roles.join(' / ')}}</small></button></div>
          <p v-if="!foundPeople.length">没有匹配的作者或歌手。</p>
        </section>
        <section v-if="localResults.length" class="people-section"><h2>本地歌曲</h2>
          <button class="local-result" v-for="track in localResults.slice(0,limit)" :key="track.id" @click="playLocal(track)"><i class="ri-play-circle-line"/><strong>{{track.title}}</strong><span>{{track.artist}} · {{track.album}}</span></button>
        </section>
        <div v-if="!selectedPerson" class="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="诗歌分类">
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
          v-if="selectedCategory === '全部' && !selectedPerson && !searchKeyword"
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
            v-for="document in filteredDocuments.slice(0,limit)"
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
              <small v-if="author(document)" class="block">{{author(document)}}</small>{{ songTitle(document)
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
              <button class="shrink-0 text-sm" title="司琴谱与署名" @click="piano?.open(document.id)">司琴谱</button>
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
        <n-button v-if="filteredDocuments.length>limit || localResults.length>limit" class="mt-4" @click="limit+=60">显示更多歌曲</n-button>
      </div>
    </n-scrollbar>

    <n-modal :show="!!preview" :mask-closable="false" preset="card" title="确认歌谱版别" style="width:min(680px,94vw)">
      <template v-if="preview"><p>{{preview.name}} · {{preview.scanned?'扫描件 OCR':'PDF 文字层'}}</p>
      <p>识别结果：{{({blue:'蓝版',white:'白版',unknown:'待确认'})[preview.edition]}} · 和弦：{{preview.chords.join('、')||'未识别'}}</p>
      <pre class="my-3 max-h-56 overflow-auto whitespace-pre-wrap">{{preview.raw||'未提取到文字，可保留原谱并手动编谱。'}}</pre>
      <n-radio-group v-model:value="edition"><n-radio value="blue">蓝版歌谱</n-radio><n-radio value="white">白版司琴谱</n-radio></n-radio-group>
      <div class="mt-4 flex justify-end gap-2"><n-button @click="preview=null">取消</n-button><n-button type="primary" :disabled="!edition" :loading="importBusy" @click="confirmScore">确认导入</n-button></div></template>
    </n-modal>
    <piano-book ref="piano" :documents="documents" :lyrics="lyrics" :scores="scores" @change="saveScore" />
    <n-modal v-model:show="scoreVisible" preset="card" :title="scoreDoc?songTitle(scoreDoc):'蓝版歌谱'" style="width:min(1080px,95vw)">
      <div class="score-nav"><n-button :disabled="scoreBusy || !scorePage || scorePage.number<=1" @click="turnPage(-1)">上一页</n-button><span>{{scorePage?.number||1}} / {{scorePage?.total||'…'}}</span><n-button :disabled="scoreBusy || !scorePage || scorePage.number>=scorePage.total" @click="turnPage(1)">下一页</n-button><n-button text @click="externalScore">用系统打开 PDF</n-button></div>
      <div class="clean-page"><n-spin v-if="scoreBusy"/><img v-else-if="scorePage" :src="scorePage.image" alt="蓝版歌谱"/></div>
    </n-modal>
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
import { computed, onMounted, ref, shallowRef, watch } from 'vue';

import type { CustomHymnBook, HymnDocument } from '../../../shared/hymnLibrary';
import SongJournal from '@/components/player/SongJournal.vue';
import {useLocalMusicStore} from '@/store/modules/localMusic';
import titles from './titles.json';
import printedCredits from './credits.json';
import PianoBook from './PianoBook.vue';
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

const showTools=ref(false);
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

type Score = {author:string,chart:string};
type ScorePreview={edition:'blue'|'white'|'unknown',raw:string,author:string,token:string,name:string,scanned:boolean,chords:string[]};
const preview=ref<ScorePreview|null>(null), edition=ref(''), readingScore=ref(false),importBusy=ref(false);
async function readScore(){readingScore.value=true;try{preview.value=await window.api.invoke('poems:score-read');edition.value=preview.value?.edition==='unknown'?'':preview.value?.edition||''}catch(e){message.error(String(e))}finally{readingScore.value=false}}
async function confirmScore(){if(!preview.value||!edition.value||importBusy.value)return;importBusy.value=true;try{const id=await window.api.invoke('poems:score-import',preview.value.token,edition.value);saveScore(id,{author:preview.value.author,chart:preview.value.raw});preview.value=null;await reloadLibrary();selectedCategory.value=edition.value==='white'?'白版 · 司琴谱':'蓝版 · 歌谱';searchKeyword.value='';selectedPerson.value='';if(edition.value==='white')piano.value?.open(id);message.success('已保存原谱和识别内容')}catch(e){message.error(String(e))}finally{importBusy.value=false}}
const piano=ref<InstanceType<typeof PianoBook>|null>(null);
const scores=ref<Record<string,Score>>(JSON.parse(localStorage.getItem('poems-piano-scores')||'{}'));
const selectedPerson=ref(''),browseAuthors=ref(false),limit=ref(60);
const local=useLocalMusicStore();
const songTitle=(d:HymnDocument)=>(titles as Record<string,string>)[d.id]||d.title;
const names=(v:string)=>[...new Set(v.split(/[、;；&＆，,]/).map(s=>s.trim()).filter(s=>s && !['未知艺术家','未知歌手','Unknown Artist'].includes(s)))];
function openPerson(name:string){selectedPerson.value=name;searchKeyword.value='';selectedCategory.value='全部';browseAuthors.value=false}
watch([searchKeyword,selectedPerson,selectedCategory],()=>limit.value=60);
async function playLocal(track:LocalMusicEntry){const songs=localResults.value.map(toSongResult);playerStore.setPlayList(songs);await playerStore.setPlay(toSongResult(track))}

const author=(d:HymnDocument)=>scores.value[d.id]?.author || d.authors?.join('、') || (printedCredits as Record<string,string>)[d.id] || '';
function saveScore(id:string,value:Score){scores.value[id]=value;localStorage.setItem('poems-piano-scores',JSON.stringify(scores.value))}
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
const docPeople=(d:HymnDocument)=>names(author(d)+'、'+(d.performer||''));
const people=computed(()=>{
  const people=new Map<string,{name:string,count:number,roles:string[]}>();
  function add(name:string,role:string,count=true){const p=people.get(name)??{name,count:0,roles:[]};if(count)p.count++;if(!p.roles.includes(role))p.roles.push(role);people.set(name,p)}
  for(const d of documents.value){const writers=names(author(d));for(const w of writers)add(w,'词曲');for(const v of names(d.performer||''))add(v,'演唱',!writers.includes(v))}
  for(const t of local.musicList)for(const n of names(t.artist))add(n,'演唱');
  return Array.from(people.values()).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'zh-CN'));
});
const foundPeople=computed(()=>people.value.filter(p=>normalize(p.name).includes(normalize(searchKeyword.value))));
const localResults=computed(()=>{const q=normalize(searchKeyword.value),person=selectedPerson.value;if(!q&&!person)return [];
return local.musicList.filter(t=>(!person||names(t.artist).includes(person))&&(!q||normalize([t.artist,t.title,t.album,t.lyrics||''].join(' ')).includes(q)))});
const indexedLines=computed(()=>Object.fromEntries(Object.entries(lyrics.value).map(([id,lines])=>[id,lines.map(normalize)])));
const hits = computed(() => {
  const q = normalize(searchKeyword.value),
    found: Record<string, string> = {};
  if (q)
    for (const [id, rows] of Object.entries(indexedLines.value)) {
      const i = rows.findIndex(line => line.includes(q));
      if (i>=0) found[id] = lyrics.value[id][i];
    }
  return found;
});
const searchFields = computed(() =>
  documents.value.map((document) =>
    [songTitle(document),author(document),document.performer||'',document.number, document.category, document.relativePath, document.audioFileName ?? ''].map(
      (field) => field.toLocaleLowerCase('zh-CN')
    )
  )
);

const filteredDocuments = computed(() => {
  const keyword = searchKeyword.value.trim().toLocaleLowerCase('zh-CN');
  const category = selectedCategory.value;
  if (category === '全部' && !keyword && !selectedPerson.value) return documents.value;

  return documents.value.filter(
    (document, index) =>
      (category === '全部' || document.category === category) &&
      (!selectedPerson.value || docPeople(document).includes(selectedPerson.value)) &&
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

const scoreVisible=ref(false),scoreBusy=ref(false),scoreDoc=shallowRef<HymnDocument|null>(null);
const scorePage=shallowRef<{number:number,total:number,image:string}|null>(null);
let request=0;
async function turnPage(delta:number){if(!scoreDoc.value)return;const token=++request;scoreBusy.value=true;
try{const p=await window.api.invoke('poems:score-page',scoreDoc.value.id,(scorePage.value?.number||1)+delta);if(token===request)scorePage.value=p}
catch(e){message.error(String(e))}finally{if(token===request)scoreBusy.value=false}}
async function externalScore(){if(scoreDoc.value){const error=await window.api.openHymnDocument(scoreDoc.value.id);if(error)message.error(error)}}
const openDocument=async(d:HymnDocument)=>{if(!isElectron)return;scoreDoc.value=d;if(d.source==='builtin'||d.category.startsWith('蓝版')){scorePage.value=null;scoreVisible.value=true;await turnPage(0)}else await externalScore()};

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
    await Promise.all([reloadLibrary(),local.loadFromCache()]);
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
  grid-template-columns: 90px 130px minmax(180px, 1fr) minmax(160px, 0.8fr) 222px;
  align-items: center;
  gap: 16px;
}

.document-row {
  @apply border-t border-neutral-100 px-4 py-3 transition-colors hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900/60;
  min-height: 56px;
}

@media (max-width: 900px) {
  .document-grid {
    grid-template-columns: 70px minmax(100px, 1fr) 222px;
  }

  .document-grid > :nth-child(2),
  .document-grid > :nth-child(4) {
    display: none;
  }
}
.person-hero,.people-section{border-radius:24px;background:var(--poems-panel,rgba(128,140,150,.09));padding:22px;margin-bottom:18px}.person-hero{display:flex;align-items:center;gap:20px}.person-hero h2{font-size:32px;font-weight:700;margin:6px 0}.person-hero button,.people-list small,.local-result span{opacity:.72;font-size:13px}.person-avatar,.people-list button span{border-radius:32%;background:linear-gradient(135deg,#c4e4d7,#8baaa1);color:#183c34;display:grid;place-items:center}.person-avatar{width:78px;height:78px;font-size:36px}.people-section h2{font-weight:650;margin-bottom:12px}.people-list{display:flex;flex-wrap:wrap;gap:10px}.people-list button{display:grid;grid-template-columns:42px 1fr;column-gap:10px;padding:8px 12px;border-radius:15px;text-align:left;background:var(--poems-page,rgba(128,140,150,.1))}.people-list button span{width:42px;height:42px;grid-row:span 2}.local-result{display:flex;align-items:center;gap:12px;width:100%;padding:10px;text-align:left}.score-nav{display:flex;align-items:center;gap:14px;margin-bottom:12px}.clean-page{max-height:70vh;overflow:auto;text-align:center}.clean-page img{width:100%;display:block;border-radius:12px}
</style>
