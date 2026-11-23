<template>
  <setting-section :title="t('settings.sections.about')">
    <setting-item :title="t('settings.about.version')" :description="config.version" />
    <setting-item title="Poems" description="本地诗歌、歌谱与歌词桌面播放器" />
  </setting-section>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

import config from '../../../../../package.json';
import SettingItem from '../SettingItem.vue';
import SettingSection from '../SettingSection.vue';

const { t } = useI18n();
</script>
