<script setup lang="ts">
import { vFocusRing } from '@/directives/focusRing'

withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'hazard'
    size?: 'sm' | 'md' | 'lg'
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
    block?: boolean
  }>(),
  {
    variant: 'primary',
    size: 'md',
    type: 'button',
    disabled: false,
    block: false,
  },
)
</script>

<template>
  <button
    v-focus-ring
    :type="type"
    :disabled="disabled"
    :class="[
      'btn',
      `btn--${variant}`,
      `btn--${size}`,
      { 'btn--block': block },
    ]"
  >
    <slot />
  </button>
</template>

<style scoped>
/* Sky Arena: chunky glossy candy buttons with a solid bottom lip that the
   button presses into on :active. */
.btn {
  --btn-top: var(--color-alert);
  --btn-bottom: var(--color-alert-dim);
  --btn-lip: #8a0f1f;
  font-family: var(--font-display);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
  color: #fff;
  text-shadow: 0 2px 0 rgba(13, 42, 107, 0.3);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.35) 0%, rgba(255, 255, 255, 0) 48%),
    linear-gradient(180deg, var(--btn-top) 0%, var(--btn-bottom) 100%);
  border: 3px solid rgba(255, 255, 255, 0.9);
  border-radius: var(--radius-pill);
  box-shadow: 0 5px 0 var(--btn-lip), 0 9px 16px rgba(13, 42, 107, 0.3);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-2);
  min-height: 44px;
  transition:
    transform var(--duration-snap) var(--ease-snap),
    box-shadow var(--duration-snap) var(--ease-snap),
    filter var(--duration-snap) var(--ease-snap);
  white-space: nowrap;
}
.btn:hover:not(:disabled) {
  transform: translateY(-2px);
  filter: brightness(1.06);
  box-shadow: 0 7px 0 var(--btn-lip), 0 12px 20px rgba(13, 42, 107, 0.32);
}
.btn:active:not(:disabled) {
  transform: translateY(4px);
  box-shadow: 0 1px 0 var(--btn-lip), 0 3px 6px rgba(13, 42, 107, 0.3);
}

.btn:disabled {
  opacity: 0.5;
  filter: grayscale(0.4);
  cursor: not-allowed;
}

.btn--block {
  width: 100%;
}

.btn--sm {
  padding: var(--spacing-2) var(--spacing-4);
  font-size: var(--text-sm);
}

.btn--md {
  padding: var(--spacing-3) var(--spacing-6);
  font-size: var(--text-lg);
}

.btn--lg {
  padding: var(--spacing-4) var(--spacing-8);
  font-size: var(--text-xl);
  min-height: 58px;
}

/* primary — candy red, the create / go action */
.btn--primary { --btn-top: #ff5a68; --btn-bottom: #e8253a; --btn-lip: #a3132a; }

/* secondary — aqua, multiplayer */
.btn--secondary { --btn-top: #4fe6ff; --btn-bottom: #12a8e0; --btn-lip: #0b6f9e; }

/* ghost — royal blue, low-attention */
.btn--ghost { --btn-top: #3f7cf0; --btn-bottom: #2552c4; --btn-lip: #163a8e; }

/* danger — deep red, destructive confirms */
.btn--danger { --btn-top: #ff4a4a; --btn-bottom: #c41a1a; --btn-lip: #7d0d0d; }

/* hazard — sunny yellow, answering someone / daily loop */
.btn--hazard {
  --btn-top: #ffe066; --btn-bottom: #ffb400; --btn-lip: #c27a00;
  color: #5a3300;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.5);
}
</style>
