<template>
  <setting-section :title="t('settings.sections.about')">
    <setting-item :title="t('settings.about.version')" :description="config.version" />
    <setting-item title="Poems" description="本地诗歌、歌谱与歌词桌面播放器" />
  </setting-section>
  <setting-section v-if="isElectron" title="开发者诊断">
    <div class="p-4">
      <div class="flex gap-2">
        <n-button :loading="busy" @click="check">检查本机环境</n-button>
        <n-button :disabled="!report || busy" @click="copy">复制诊断报告</n-button>
      </div>
      <pre v-if="report" class="mt-3 overflow-auto whitespace-pre-wrap text-sm">{{ report }}</pre>
    </div>
  </setting-section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { isElectron } from '@/utils';
import { useI18n } from 'vue-i18n';

import config from '../../../../../package.json';
import SettingItem from '../SettingItem.vue';
import SettingSection from '../SettingSection.vue';

const busy = ref(false);
const report = ref('');
const message = useMessage();
async function check() {
  busy.value = true;
  try {
    const d = await window.api.invoke('poems:diagnostics');
    report.value = [
      'Poems ' + d.version + ' · ' + d.platform + ' ' + d.arch + (d.packaged ? ' · 发行版' : ' · 开发版'),
      'Electron ' + d.electron + ' · Chromium ' + d.chromium + ' · Node ' + d.node,
      '检查时间 ' + d.checkedAt,
      ...d.components.map((c: {name:string;present:boolean}) => (c.present ? '已找到  ' : '缺失  ') + c.name)
    ].join('\n');
  } catch (error) { report.value = ''; message.error(String(error)); }
  finally { busy.value = false; }
}
async function copy() {
  try { await navigator.clipboard.writeText(report.value); message.success('诊断报告已复制'); }
  catch { message.error('复制失败，可选中报告手动复制'); }
}
const { t } = useI18n();
</script>
