<template>
  <div
    class="card-back"
    :style="{
      width: `${size.width}px`,
      height: `${size.height}px`,
      // Per-instance skin override (someone else's seat). Undefined values
      // are dropped by Vue, so the root-level equipped skin still applies.
      '--card-back-accent': accent,
      '--card-back-stripe': stripe,
    }"
  >
    <svg
      :width="size.width"
      :height="size.height"
      viewBox="0 0 250 350"
      xmlns="http://www.w3.org/2000/svg"
      class="card-back-svg"
    >
      <!-- White card edge -->
      <rect x="0" y="0" width="250" height="350" rx="22" ry="22" fill="#ffffff" />

      <!-- Royal-blue face with a soft top gloss -->
      <rect x="10" y="10" width="230" height="330" rx="16" ry="16" fill="url(#cbFace)" />

      <!-- Sunburst rays from the centre -->
      <g opacity="0.16" fill="#ffffff">
        <path d="M125 175 L95 10 L155 10 Z" />
        <path d="M125 175 L240 60 L240 130 Z" />
        <path d="M125 175 L240 230 L240 300 Z" />
        <path d="M125 175 L155 340 L95 340 Z" />
        <path d="M125 175 L10 300 L10 230 Z" />
        <path d="M125 175 L10 130 L10 60 Z" />
      </g>

      <!-- Inner frame in the skin's stripe colour -->
      <rect
        x="22" y="22" width="206" height="306" rx="12" ry="12"
        fill="none" stroke-width="6" stroke-dasharray="2 10" stroke-linecap="round"
        style="stroke: var(--card-back-stripe, #ffc928)"
      />

      <!-- Tilted lozenge carrying the wordmark, in the skin's accent colour -->
      <g transform="rotate(-18 125 175)">
        <ellipse cx="125" cy="182" rx="96" ry="60" fill="#0d2a6b" opacity="0.35" />
        <ellipse cx="125" cy="175" rx="96" ry="60" fill="#ffffff" />
        <ellipse cx="125" cy="175" rx="86" ry="51" style="fill: var(--card-back-accent, #ff3d4f)" />
        <ellipse cx="125" cy="155" rx="70" ry="22" fill="#ffffff" opacity="0.25" />
        <text
          x="125" y="168"
          font-family="Lilita One, Arial Rounded MT Bold, sans-serif"
          font-size="40" fill="#ffffff" stroke="#0d2a6b" stroke-width="2" paint-order="stroke"
          text-anchor="middle" dominant-baseline="middle"
        >OPEN</text>
        <text
          x="125" y="200"
          font-family="Lilita One, Arial Rounded MT Bold, sans-serif"
          font-size="28" fill="#ffc928" stroke="#0d2a6b" stroke-width="2" paint-order="stroke"
          text-anchor="middle" dominant-baseline="middle"
        >MERCY</text>
      </g>

      <defs>
        <linearGradient id="cbFace" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#4d8dff" />
          <stop offset="55%" stop-color="#2a5fd0" />
          <stop offset="100%" stop-color="#173f9e" />
        </linearGradient>
      </defs>
    </svg>
  </div>
</template>

<script setup lang="ts">
interface Props {
  size?: { width: number; height: number }
  /** Skin override for rendering someone else's card back. */
  accent?: string
  stripe?: string
}

withDefaults(defineProps<Props>(), {
  size: () => ({ width: 100, height: 140 }),
  accent: undefined,
  stripe: undefined,
})
</script>

<style scoped>
.card-back {
  display: inline-block;
  border-radius: 12px;
  overflow: hidden;
  position: relative;
  box-shadow: 0 6px 0 rgba(13, 42, 107, 0.35), 0 10px 18px rgba(13, 42, 107, 0.3);
}
</style>
