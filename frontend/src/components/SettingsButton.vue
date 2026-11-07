<template>
  <button
    type="button"
    class="settings-btn"
    @click="settings.open()"
    aria-label="Open settings"
    title="Settings"
  >
    <Settings :size="20" :stroke-width="2" aria-hidden="true" />
  </button>
</template>

<script setup lang="ts">
import { Settings } from 'lucide-vue-next'
import { useSettingsStore } from '../stores/settingsStore'
const settings = useSettingsStore()
</script>

<style scoped>
.settings-btn {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.4) 0%, rgba(255, 255, 255, 0) 50%),
    linear-gradient(180deg, #ffe066 0%, #ffb400 100%);
  border: 3px solid #fff;
  color: #7a4600;
  width: 48px;  /* touch target >= 44px */
  height: 48px;
  border-radius: 50%;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 0 #c27a00, 0 8px 14px rgba(13, 42, 107, 0.3);
  transition: transform 0.18s, filter 0.18s;
  padding: 0;
}

.settings-btn:hover {
  filter: brightness(1.06);
  transform: rotate(30deg);
}

.settings-btn:active {
  transform: rotate(60deg) scale(0.95);
}

@media (prefers-reduced-motion: reduce) {
  .settings-btn,
  .settings-btn:hover,
  .settings-btn:active { transform: none; }
}
</style>
