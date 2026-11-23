<template>
  <setting-section v-if="isElectron" :title="t('settings.sections.application')">
    <setting-item
      :title="t('settings.application.closeAction')"
      :description="t('settings.application.closeActionDesc')"
    >
      <s-select
        v-model="setData.closeAction"
        :options="closeActionOptions"
        width="w-40 max-md:w-full"
      />
    </setting-item>

    <setting-item
      :title="t('settings.application.shortcut')"
      :description="t('settings.application.shortcutDesc')"
    >
      <s-btn @click="showShortcutModal = true">{{ t('common.configure') }}</s-btn>
    </setting-item>

    <setting-item
      :title="t('settings.application.remoteControl')"
      :description="t('settings.application.remoteControlDesc')"
    >
      <s-btn @click="showRemoteControlModal = true">{{ t('common.configure') }}</s-btn>
    </setting-item>

    <shortcut-settings v-model:show="showShortcutModal" @change="handleShortcutsChange" />
    <remote-control-setting v-model:visible="showRemoteControlModal" />
  </setting-section>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import RemoteControlSetting from '@/components/settings/ServerSetting.vue';
import ShortcutSettings from '@/components/settings/ShortcutSettings.vue';
import { isElectron } from '@/utils';

import { SETTINGS_DATA_KEY } from '../keys';
import SBtn from '../SBtn.vue';
import SettingItem from '../SettingItem.vue';
import SettingSection from '../SettingSection.vue';
import SSelect from '../SSelect.vue';

const { t } = useI18n();
const setData = inject(SETTINGS_DATA_KEY)!;

const showShortcutModal = ref(false);
const showRemoteControlModal = ref(false);

const closeActionOptions = computed(() => [
  { label: t('settings.application.closeOptions.ask'), value: 'ask' },
  { label: t('settings.application.closeOptions.minimize'), value: 'minimize' },
  { label: t('settings.application.closeOptions.close'), value: 'close' }
]);

const handleShortcutsChange = (shortcuts: any) => {
  console.log('快捷键已更新:', shortcuts);
};
</script>
