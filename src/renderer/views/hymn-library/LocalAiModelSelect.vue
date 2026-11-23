<template>
  <label class="inline-flex items-center gap-2 text-sm">
    模型
    <select
      v-model="localAiModel"
      :disabled="disabled"
      class="rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-600 dark:bg-neutral-900"
    >
      <option value="qwen">Qwen2.5 1.5B</option>
      <option value="deepseek">DeepSeek R1 1.5B</option>
    </select>
  </label>
</template>

<script setup lang="ts">
import { localAiModel } from './useLocalAiTask';

defineProps<{ disabled: boolean }>();
</script>
