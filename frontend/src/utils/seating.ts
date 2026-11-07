/**
 * Table seating: where each opponent sits around the table.
 *
 * You are always at the bottom. Opponents fill the other three edges in turn
 * order, starting with the player who goes after you, so clockwise play reads
 * bottom → left → top → right, the way a real table does.
 */

export type SeatSlot = 'left' | 'top-left' | 'top' | 'top-right' | 'right'

/** Seat positions for 1..5 opponents (tables seat 2-6 players). */
const LAYOUTS: Record<number, SeatSlot[]> = {
    1: ['top'],
    2: ['left', 'right'],
    3: ['left', 'top', 'right'],
    4: ['left', 'top-left', 'top-right', 'right'],
    5: ['left', 'top-left', 'top', 'top-right', 'right'],
}

export function seatSlots(count: number): SeatSlot[] {
    if (count <= 0) return []
    if (count > 5) {
        // More than the official cap: spread the extras along the top edge.
        return ['left', ...Array.from({ length: count - 2 }, () => 'top' as const), 'right']
    }
    return LAYOUTS[count]!
}

/**
 * Opponents in turn order starting with the player after `myId`. If `myId`
 * is not seated (spectator), the original order is kept.
 */
export function opponentsInSeatOrder<T>(players: T[], myId: string | null | undefined, idOf: (p: T) => string): T[] {
    const me = players.findIndex(p => idOf(p) === myId)
    if (me === -1) return players.filter(p => idOf(p) !== myId)
    return [...players.slice(me + 1), ...players.slice(0, me)]
}

/** CSS class for a slot; the visual order within the top edge goes left to right. */
export function seatClass(slot: SeatSlot): string {
    return `seat-${slot}`
}
