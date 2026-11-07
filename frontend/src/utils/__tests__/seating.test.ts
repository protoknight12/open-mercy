import { describe, expect, it } from 'vitest'
import { opponentsInSeatOrder, seatSlots } from '../seating'

describe('seatSlots', () => {
    it('places opponents around the table for every legal table size', () => {
        expect(seatSlots(1)).toEqual(['top'])
        expect(seatSlots(2)).toEqual(['left', 'right'])
        expect(seatSlots(3)).toEqual(['left', 'top', 'right'])
        expect(seatSlots(4)).toEqual(['left', 'top-left', 'top-right', 'right'])
        expect(seatSlots(5)).toEqual(['left', 'top-left', 'top', 'top-right', 'right'])
    })

    it('always gives one slot per opponent', () => {
        for (let n = 0; n <= 8; n++) expect(seatSlots(n)).toHaveLength(n)
    })
})

describe('opponentsInSeatOrder', () => {
    const ids = ['a', 'b', 'me', 'c', 'd']
    const id = (s: string) => s

    it('starts with the player after me and wraps round', () => {
        expect(opponentsInSeatOrder(ids, 'me', id)).toEqual(['c', 'd', 'a', 'b'])
    })

    it('keeps order when I am first', () => {
        expect(opponentsInSeatOrder(['me', 'x', 'y'], 'me', id)).toEqual(['x', 'y'])
    })

    it('keeps the given order for a spectator', () => {
        expect(opponentsInSeatOrder(['x', 'y'], 'nobody', id)).toEqual(['x', 'y'])
    })
})
