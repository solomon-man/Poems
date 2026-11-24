import { ref, watch } from 'vue';
export const palettes = {
  classic: { name: 'Poems 经典', light: '#15803d', dark: '#4ade80' },
  nord: { name: 'Nord 极光', light: '#496888', dark: '#88c0d0' },
  latte: { name: 'Catppuccin 拿铁', light: '#8839ef', dark: '#cba6f7' }
};
export type Palette = keyof typeof palettes;
const saved = localStorage.getItem('poems-palette');
export const palette = ref<Palette>(
  saved && Object.hasOwn(palettes, saved) ? (saved as Palette) : 'classic'
);
watch(
  palette,
  (value) => {
    document.documentElement.dataset.palette = value;
    localStorage.setItem('poems-palette', value);
  },
  { immediate: true }
);
