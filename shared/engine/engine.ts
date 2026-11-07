import type { Card, CardColor, EngineEvent, EngineState, Player, Rng } from './types'
import {
    calculateNextPlayerIndex,
    calculateScore,
    canPlayCard,
    checkMercyRule,
    getDrawValue,
    reshuffleDeck,
    rotateHands,
} from './rules'

export function currentPlayer(s: EngineState): Player | undefined {
    return s.players[s.currentPlayerIndex]
}

export function topCard(s: EngineState): Card | undefined {
    return s.discardPile[s.discardPile.length - 1]
}

export function drawCardFromDeck(s: EngineState, ev: EngineEvent[], rng: Rng = Math.random): Card | undefined {
    if (s.deck.length === 0) {
        if (!reshuffleDeck(s.deck, s.discardPile, rng)) return undefined
        ev.push({ t: 'RESHUFFLE' })
    }
    return s.deck.pop()
}

export function drawCardToHand(s: EngineState, playerId: string, ev: EngineEvent[], rng: Rng = Math.random): Card | undefined {
    const player = s.players.find(p => p.id === playerId)
    if (!player) return undefined
    const card = drawCardFromDeck(s, ev, rng)
    if (card) {
        player.hand.push(card)
        s.hasCalledUno[player.id] = false
        ev.push({ t: 'DRAW', playerId: player.id, card })
    }
    checkMercyElimination(s, player, ev)
    return card
}

/**
 * Official Mercy rule: a knocked-out hand is "set aside until the deck runs out
 * and needs to be reshuffled". Tucking it under the discard pile does exactly
 * that: it never changes the top card, and the next reshuffle takes it back in.
 */
function setAsideHand(s: EngineState, hand: Card[]): void {
    if (hand.length) s.discardPile.unshift(...hand)
}

/** Eliminates the player if they crossed the mercy threshold; ends the game if one player remains. */
export function checkMercyElimination(s: EngineState, player: Player, ev: EngineEvent[]): boolean {
    if (!checkMercyRule(player.hand.length)) return false
    player.isEliminated = true
    setAsideHand(s, player.hand)
    player.hand = []
    ev.push({ t: 'ELIMINATED', playerId: player.id })

    const activePlayers = s.players.filter(p => !p.isEliminated)
    if (activePlayers.length === 1 && activePlayers[0]) {
        endGame(s, activePlayers[0].id, ev)
    }
    return true
}

/**
 * Forced elimination (host kick, permanent leave). Unlike the mercy path —
 * whose callers own the turn advance — this also unparks the turn if the
 * dead seat was holding it.
 */
export function eliminatePlayer(s: EngineState, playerId: string, ev: EngineEvent[]): boolean {
    const player = s.players.find(p => p.id === playerId)
    if (!player || player.isEliminated) return false
    const hadTurn = currentPlayer(s)?.id === playerId
    player.isEliminated = true
    setAsideHand(s, player.hand)
    player.hand = []
    ev.push({ t: 'ELIMINATED', playerId: player.id })

    const activePlayers = s.players.filter(p => !p.isEliminated)
    if (activePlayers.length === 1 && activePlayers[0]) {
        endGame(s, activePlayers[0].id, ev)
        return true
    }
    if (s.gameState === 'PLAYING' && hadTurn) {
        s.turnState = 'WAITING_FOR_ACTION'
        s.drawStack = 0
        s.pendingDiscardAllCards = []
        advanceTurn(s, ev)
    }
    return true
}

export function endGame(s: EngineState, winnerId: string, ev: EngineEvent[]): void {
    s.winnerId = winnerId
    applyScoresToWinner(s, winnerId)
    s.gameState = 'GAME_OVER'
    ev.push({ t: 'GAME_OVER', winnerId })
}

export function applyScoresToWinner(s: EngineState, winningPlayerId: string): void {
    const winner = s.players.find(p => p.id === winningPlayerId)
    if (!winner) return

    const opponentHands: Card[][] = []
    const eliminatedFlags: boolean[] = []
    s.players.forEach(p => {
        if (p.id === winningPlayerId) return
        opponentHands.push(p.hand)
        eliminatedFlags.push(p.isEliminated)
    })

    const totalPoints = calculateScore(opponentHands, eliminatedFlags)
    if (winner.score !== undefined) {
        winner.score += totalPoints
    } else {
        winner.score = totalPoints
    }
}

export function advanceTurn(s: EngineState, ev: EngineEvent[]): void {
    ev.push({ t: 'TURN_ADVANCED' })
    const count = s.players.length
    s.currentPlayerIndex = calculateNextPlayerIndex(s.currentPlayerIndex, s.direction, count)

    // If coming from Roulette, don't reset the choosing/drawing state
    if (s.turnState !== 'ROULETTE_DRAWING' && s.turnState !== 'CHOOSING_ROULETTE_COLOR') {
        s.turnState = 'WAITING_FOR_ACTION'
    }

    // Skip eliminated players
    let sanity = 0
    while (s.players[s.currentPlayerIndex]?.isEliminated && sanity < 20) {
        s.currentPlayerIndex = calculateNextPlayerIndex(s.currentPlayerIndex, s.direction, count)
        sanity++
    }
}

export interface PlayCardOpts {
    selectedColor?: CardColor
    /** Which card goes on top of a multi-match Discard All — host policy (e.g. bot picks). Absent → picker state. */
    discardAllTopPickId?: string
    rng?: Rng
}

export interface PlayResult {
    ok: boolean
    events: EngineEvent[]
}

export function playCard(s: EngineState, playerId: string, cardId: string, opts: PlayCardOpts = {}): PlayResult {
    const ev: EngineEvent[] = []

    const player = s.players.find(p => p.id === playerId)
    if (!player) return { ok: false, events: ev }
    const top = topCard(s)
    if (!top) return { ok: false, events: ev }

    const cardIndex = player.hand.findIndex(c => c.id === cardId)
    if (cardIndex === -1) return { ok: false, events: ev }
    const card = player.hand[cardIndex]!
    if (!canPlayCard(card, top, s.currentColor, s.drawStack, s.stackingMode)) return { ok: false, events: ev }

    player.hand.splice(cardIndex, 1)
    s.discardPile.push(card)

    // Handle Color Selection (Wilds)
    if (card.type === 'wildColorRoulette') {
        // Roulette: color is chosen by the NEXT player (the victim) — leave as is.
    } else if (card.color === 'wild') {
        s.currentColor = opts.selectedColor ?? 'red'
    } else {
        s.currentColor = card.color
    }

    applyCardEffect(s, card, ev, opts)

    // Going out wins for EVERY card type, roulette included. A missed UNO call
    // is punished only through the catch window opened by AT_ONE_UNCALLED
    // below; once a player is down to one card uncaught, playing it wins.
    if (player.hand.length === 0) {
        endGame(s, player.id, ev)
        return { ok: true, events: ev }
    }

    // Reached 1 card without calling UNO — host decides what happens
    // (bot auto-call odds / catch window are policy, not rules).
    if (player.hand.length === 1 && !s.hasCalledUno[player.id]) {
        ev.push({ t: 'AT_ONE_UNCALLED', playerId: player.id })
    }

    if (card.type === 'wildColorRoulette') {
        // Turn already advanced to the victim in applyCardEffect.
        return { ok: true, events: ev }
    }

    if (card.type !== 'skipEveryone') {
        if (s.turnState === 'WAITING_FOR_ACTION' || s.turnState === 'ROULETTE_DRAWING' || s.turnState === 'CHOOSING_ROULETTE_COLOR') {
            advanceTurn(s, ev)
        }
    } else {
        // Skip Everyone: turn stays with the current player (play again).
        ev.push({ t: 'PLAY_AGAIN' })
    }

    return { ok: true, events: ev }
}

export function applyCardEffect(s: EngineState, card: Card, ev: EngineEvent[], opts: PlayCardOpts = {}): void {
    // Apply draw stack (except roulette)
    const drawVal = getDrawValue(card)
    if (drawVal > 0 && card.type !== 'wildColorRoulette') {
        s.drawStack += drawVal
    }

    // Handle special number cards (0 and 7)
    if (card.type === 'number') {
        if (card.value === 0) {
            // A 0 that empties the hand is a win; rotating first would hand the
            // empty hand to the next seat and the winner a full one.
            if (currentPlayer(s)?.hand.length) rotateActiveHands(s)
            return
        }
        if (card.value === 7) {
            s.turnState = 'CHOOSING_PLAYER_TO_SWAP'
            s.swapInitiatorId = currentPlayer(s)?.id ?? null
            return
        }
        return
    }

    switch (card.type) {
        case 'reverse':
        case 'wildReverseDraw4':
            handleReverse(s, card, ev)
            return
        case 'skip':
            advanceTurn(s, ev)
            return
        case 'skipEveryone':
            // Play again — the caller handles turn retention.
            return
        case 'wildColorRoulette':
            s.turnState = 'CHOOSING_ROULETTE_COLOR'
            advanceTurn(s, ev)
            return
        case 'discardAll':
            handleDiscardAll(s, card, ev, opts)
            return
        default:
            return
    }
}

function handleReverse(s: EngineState, _card: Card, ev: EngineEvent[]): void {
    // "Two players" means two still in the game: a 4-seat table with two
    // knocked out plays exactly like a heads-up game.
    const isTwoPlayer = s.players.filter(p => !p.isEliminated).length === 2
    s.direction = s.direction === 1 ? -1 : 1
    if (isTwoPlayer) {
        // Reverse acts as a Skip. Wild Reverse Draw 4 also skips the other
        // player, so the +4 lands back on whoever played it (they may stack
        // to send it back) — official HVW18 wording.
        advanceTurn(s, ev)
    }
}

/**
 * Official Discard All: every other card in the hand of the Discard All's
 * colour is placed UNDER it. The Discard All stays on top and none of the
 * buried cards' effects fire. playCard then handles win / UNO / advance as
 * for any other card.
 */
function handleDiscardAll(s: EngineState, card: Card, _ev: EngineEvent[], _opts: PlayCardOpts): void {
    const player = currentPlayer(s)
    if (!player) return

    const toDiscard = player.hand.filter(c => c.color === card.color)
    if (toDiscard.length === 0) return

    player.hand = player.hand.filter(c => c.color !== card.color)
    const topIdx = s.discardPile.length - 1
    s.discardPile.splice(Math.max(0, topIdx), 0, ...toDiscard)
}

function executeDiscardAll(s: EngineState, cards: Card[], top: Card): void {
    const player = currentPlayer(s)
    if (!player) return

    // Discard all except the chosen top card first, then top card last
    const others = cards.filter(c => c.id !== top.id)
    for (const c of [...others, top]) {
        const idx = player.hand.findIndex(h => h.id === c.id)
        if (idx > -1) {
            player.hand.splice(idx, 1)
            s.discardPile.push(c)
        }
    }
}

/** Sole resolver for a Discard All — the picker and the auto paths both land here. */
export function resolveDiscardAllTop(s: EngineState, cards: Card[], top: Card, ev: EngineEvent[], rng: Rng = Math.random): void {
    executeDiscardAll(s, cards, top)
    s.pendingDiscardAllCards = []
    s.turnState = 'WAITING_FOR_ACTION'

    const player = currentPlayer(s)

    // Bulk discard emptied the hand → win (no UNO call expected for a dump).
    if (player && player.hand.length === 0) {
        endGame(s, player.id, ev)
        return
    }

    // Apply the chosen TOP card's effect, exactly as if it had just been played.
    applyCardEffect(s, top, ev, { rng })

    if (player && player.hand.length === 1 && !s.hasCalledUno[player.id]) {
        ev.push({ t: 'AT_ONE_UNCALLED', playerId: player.id })
    }

    // Mirror playCard's advance: Skip Everyone plays again; a swap/choosing
    // state waits for input; otherwise pass the turn.
    if (top.type === 'skipEveryone') {
        ev.push({ t: 'PLAY_AGAIN' })
    } else if (s.turnState === 'WAITING_FOR_ACTION') {
        advanceTurn(s, ev)
    }
}

export function selectDiscardAllTop(s: EngineState, topCardId: string, rng: Rng = Math.random): EngineEvent[] {
    const ev: EngineEvent[] = []
    if (s.turnState !== 'CHOOSING_DISCARD_ALL_TOP') return ev
    const cards = s.pendingDiscardAllCards
    const top = cards.find(c => c.id === topCardId)
    if (!top) return ev
    resolveDiscardAllTop(s, cards, top, ev, rng)
    return ev
}

export function rotateActiveHands(s: EngineState): void {
    // Rotate only among players still in the game. Including eliminated seats
    // (whose hands were dumped to empty) would rotate an active hand into a
    // dead seat and strand an active player on 0 cards.
    const active = s.players.filter(p => !p.isEliminated)
    if (active.length < 2) return
    const hands = active.map(p => [...p.hand])
    const rotated = rotateHands(hands, s.direction)
    active.forEach((p, i) => {
        p.hand = rotated[i] || []
    })
}

export function swapHands(s: EngineState, targetPlayerId: string, ev: EngineEvent[]): boolean {
    if (s.turnState !== 'CHOOSING_PLAYER_TO_SWAP') return false
    const initiator = s.players.find(p => p.id === s.swapInitiatorId)
    const target = s.players.find(p => p.id === targetPlayerId)
    // The swap is mandatory, so a bad target (self, unknown, or an eliminated
    // seat holding an empty hand) is rejected and the choice stays open.
    if (!initiator || !target || target.id === initiator.id || target.isEliminated) return false
    const temp = [...initiator.hand]
    initiator.hand = [...target.hand]
    target.hand = temp
    s.turnState = 'WAITING_FOR_ACTION'
    advanceTurn(s, ev)
    return true
}

/** Players the 7-swap initiator may pick. */
export function swapTargets(s: EngineState): Player[] {
    return s.players.filter(p => p.id !== s.swapInitiatorId && !p.isEliminated)
}

/**
 * Official rule: when you play a 7 you MUST swap. Skipping is only accepted
 * when nobody is left to swap with, so a stale client can't dodge it.
 */
export function skipSwap(s: EngineState, ev: EngineEvent[]): boolean {
    if (s.turnState !== 'CHOOSING_PLAYER_TO_SWAP') return false
    if (swapTargets(s).length > 0) return false
    s.turnState = 'WAITING_FOR_ACTION'
    advanceTurn(s, ev)
    return true
}

export function setRouletteColor(s: EngineState, color: CardColor): boolean {
    if (s.turnState !== 'CHOOSING_ROULETTE_COLOR') return false
    s.rouletteTargetColor = color
    s.turnState = 'ROULETTE_DRAWING'
    return true
}

export type RouletteOutcome = 'match' | 'eliminated' | 'continue' | 'exhausted' | 'invalid'

/**
 * One roulette draw. 'match' and 'eliminated' leave the turn open so the host
 * can stall for drama before calling finishRouletteTurn. 'exhausted' (nothing
 * left to draw) ends the turn immediately.
 */
export function rouletteDrawStep(s: EngineState, ev: EngineEvent[], rng: Rng = Math.random): RouletteOutcome {
    if (s.turnState !== 'ROULETTE_DRAWING') return 'invalid'
    const p = currentPlayer(s)
    if (!p) return 'invalid'

    const card = drawCardToHand(s, p.id, ev, rng)

    // Deck + discard ran dry mid-roulette — the roulette can never resolve.
    // Victim keeps their hand, turn passes.
    if (!card) {
        s.turnState = 'WAITING_FOR_ACTION'
        advanceTurn(s, ev)
        return 'exhausted'
    }

    // Wild cards revealed do not count as matching — an actual colored card is needed.
    if (s.rouletteTargetColor && card.color === s.rouletteTargetColor) {
        // The match stays in the victim's hand like every other roulette draw
        // (a first-card match must still cost a card — discarding it made the
        // whole spin read as nothing but a color change). The roulette card
        // keeps the top; play continues in the target color.
        s.currentColor = s.rouletteTargetColor
        return 'match'
    }

    if (p.isEliminated) {
        return 'eliminated'
    }

    return 'continue'
}

export function finishRouletteTurn(s: EngineState, ev: EngineEvent[]): void {
    s.rouletteTargetColor = null
    s.turnState = 'WAITING_FOR_ACTION'
    if (s.gameState !== 'GAME_OVER') advanceTurn(s, ev)
}

/** Draw `count` penalty cards, stopping if the player gets eliminated or the game ends. */
export function penalizeUnoDraws(s: EngineState, playerId: string, count: number, ev: EngineEvent[], rng: Rng = Math.random): void {
    const p = s.players.find(x => x.id === playerId)
    if (!p) return
    for (let i = 0; i < count; i++) {
        if (p.isEliminated || s.gameState === 'GAME_OVER') break
        drawCardToHand(s, p.id, ev, rng)
    }
}

/**
 * Draw the opening discard. Only a number card can open (official setup),
 * so no opening effect ever applies.
 */
export function drawFirstDiscard(s: EngineState, ev: EngineEvent[], rng: Rng = Math.random): Card | undefined {
    // Official setup: "If this card is an Action Card, ignore it and flip over
    // the next card." Wilds are action cards too, so only a number card opens.
    // Ignored cards go to the bottom of the deck, so every card is looked at
    // once at most and this always ends, whatever the shuffle.
    let firstCard = drawCardFromDeck(s, ev, rng)
    let guard = s.deck.length
    while (firstCard && firstCard.type !== 'number' && guard-- > 0) {
        s.deck.unshift(firstCard)
        firstCard = drawCardFromDeck(s, ev, rng)
    }
    if (!firstCard) return undefined

    s.discardPile.push(firstCard)
    s.currentColor = firstCard.color
    return firstCard
}
