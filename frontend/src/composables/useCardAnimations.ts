/**
 * GSAP-based card animation composable for UNO No Mercy
 * Handles card movements, flips, and pile animations
 */

import gsap from 'gsap'

export interface AnimationOptions {
    duration?: number
    ease?: string
    delay?: number
}

// ============================================================
// UNO Card Back Element Factory
// ============================================================

/**
 * Style configuration for the UNO card back element. Mirrors CardBack.vue's
 * shell so the flying clone reads as the same physical card that leaves the deck.
 */
const UNO_CARD_BACK_STYLES = {
    width: '60px',
    height: '84px',
    borderRadius: '6px',
    overflow: 'hidden',
    position: 'relative',
    boxShadow: '0 6px 0 rgba(13,42,107,0.35), 0 10px 18px rgba(13,42,107,0.3)',
    pointerEvents: 'none'
} as const

// The "OPEN MERCY" back, kept in sync with CardBack.vue. Gradient/pattern ids are
// prefixed so they can't collide with the CardBack instances already in the DOM
// (duplicate SVG ids in one document break url() references).
const CARD_BACK_SVG = `<svg width="100%" height="100%" viewBox="0 0 250 350" xmlns="http://www.w3.org/2000/svg" style="display:block">
  <rect x="0" y="0" width="250" height="350" rx="22" ry="22" fill="#ffffff" />
  <rect x="10" y="10" width="230" height="330" rx="16" ry="16" fill="url(#fcFace)" />
  <g opacity="0.16" fill="#ffffff">
    <path d="M125 175 L95 10 L155 10 Z" /><path d="M125 175 L240 60 L240 130 Z" /><path d="M125 175 L240 230 L240 300 Z" />
    <path d="M125 175 L155 340 L95 340 Z" /><path d="M125 175 L10 300 L10 230 Z" /><path d="M125 175 L10 130 L10 60 Z" />
  </g>
  <rect x="22" y="22" width="206" height="306" rx="12" ry="12" fill="none" style="stroke: var(--card-back-stripe, #ffc928)" stroke-width="6" stroke-dasharray="2 10" stroke-linecap="round" />
  <g transform="rotate(-18 125 175)">
    <ellipse cx="125" cy="182" rx="96" ry="60" fill="#0d2a6b" opacity="0.35" />
    <ellipse cx="125" cy="175" rx="96" ry="60" fill="#ffffff" />
    <ellipse cx="125" cy="175" rx="86" ry="51" style="fill: var(--card-back-accent, #ff3d4f)" />
    <ellipse cx="125" cy="155" rx="70" ry="22" fill="#ffffff" opacity="0.25" />
    <text x="125" y="168" font-family="Lilita One, Arial Rounded MT Bold, sans-serif" font-size="40" fill="#ffffff" stroke="#0d2a6b" stroke-width="2" paint-order="stroke" text-anchor="middle" dominant-baseline="middle">OPEN</text>
    <text x="125" y="200" font-family="Lilita One, Arial Rounded MT Bold, sans-serif" font-size="28" fill="#ffc928" stroke="#0d2a6b" stroke-width="2" paint-order="stroke" text-anchor="middle" dominant-baseline="middle">MERCY</text>
  </g>
  <defs>
    <linearGradient id="fcFace" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#4d8dff" />
      <stop offset="55%" stop-color="#2a5fd0" />
      <stop offset="100%" stop-color="#173f9e" />
    </linearGradient>
  </defs>
</svg>`

const CARD_BACK_SCRATCHES = ''

/**
 * Create a styled UNO card back element for animations
 */
function createCardBackElement(): HTMLElement {
    const cardEl = document.createElement('div')
    cardEl.className = 'flying-card-anim'
    Object.assign(cardEl.style, UNO_CARD_BACK_STYLES)
    cardEl.innerHTML = CARD_BACK_SVG + CARD_BACK_SCRATCHES
    return cardEl
}

/**
 * Position an element at a fixed location
 */
function positionAtRect(el: HTMLElement, rect: DOMRect, zIndex = 2000): void {
    Object.assign(el.style, {
        position: 'fixed',
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        zIndex: String(zIndex)
    })
}

// Flying clones are appended to document.body, outside any component tree —
// if the game view unmounts mid-flight (player leaves during a big draw) the
// tweens and their card-back nodes would keep sailing over the lobby. Track
// the live ones so the view can kill them on unmount.
const activeFlyingCards = new Set<HTMLElement>()

function spawnFlyingCard(el: HTMLElement): void {
    activeFlyingCards.add(el)
    document.body.appendChild(el)
}

function despawnFlyingCard(el: HTMLElement): void {
    activeFlyingCards.delete(el)
    el.remove()
}

function killAllFlyingCards(): void {
    for (const el of activeFlyingCards) {
        gsap.killTweensOf(el)
        el.remove()
    }
    activeFlyingCards.clear()
}

// ============================================================
// Main composable
// ============================================================

export function useCardAnimations() {

    // ============================================================
    // UNO-specific animations (flying card from deck to hand)
    // ============================================================

    /**
     * Animate a single card being dealt from deck to target
     * Creates a temporary card element, animates it, then removes it
     */
    function animateFlyingCard(
        deckEl: HTMLElement,
        targetEl: HTMLElement,
        options: AnimationOptions = {}
    ): Promise<void> {
        const deckRect = deckEl.getBoundingClientRect()
        const targetRect = targetEl.getBoundingClientRect()

        const cardEl = createCardBackElement()
        positionAtRect(cardEl, deckRect)
        spawnFlyingCard(cardEl)

        const targetLeft = targetRect.left + targetRect.width / 2 - 30
        const targetTop = targetRect.top + targetRect.height / 2 - 42

        gsap.set(cardEl, { x: 0, y: 0, willChange: 'transform' })

        return new Promise<void>((resolve) => {
            gsap.to(cardEl, {
                x: targetLeft - deckRect.left,
                y: targetTop - deckRect.top,
                rotation: gsap.utils.random(-10, 10),
                duration: options.duration || 0.3,
                delay: options.delay || 0,
                ease: options.ease || 'power2.out',
                onComplete: () => {
                    despawnFlyingCard(cardEl)
                    resolve()
                }
            })
        })
    }

    /**
     * Animate multiple cards being drawn with stagger (non-blocking)
     * Cards animate with delay between each, but function returns immediately
     */
    function animateDrawCardsStaggered(
        deckEl: HTMLElement,
        targetEl: HTMLElement,
        count: number,
        options: { staggerDelay?: number } & AnimationOptions = {},
        onEachComplete?: (index: number) => void
    ): void {
        const deckRect = deckEl.getBoundingClientRect()
        const targetRect = targetEl.getBoundingClientRect()
        const staggerDelay = options.staggerDelay ?? 0.12

        const targetLeft = targetRect.left + targetRect.width / 2 - 30
        const targetTop = targetRect.top + targetRect.height / 2 - 42

        for (let i = 0; i < count; i++) {
            const cardEl = createCardBackElement()
            positionAtRect(cardEl, deckRect)
            spawnFlyingCard(cardEl)
            gsap.set(cardEl, { x: 0, y: 0, willChange: 'transform' })

            gsap.to(cardEl, {
                x: targetLeft - deckRect.left,
                y: targetTop - deckRect.top,
                rotation: gsap.utils.random(-10, 10),
                duration: options.duration || 0.3,
                delay: i * staggerDelay,
                ease: options.ease || 'power2.out',
                onComplete: () => {
                    despawnFlyingCard(cardEl)
                    onEachComplete?.(i)
                }
            })
        }
    }

    return {
        // Flying card animations (deck ↔ hand ↔ discard)
        animateFlyingCard,
        animateDrawCardsStaggered,
        killAllFlyingCards,
        // Utilities
        createCardBackElement
    }
}
