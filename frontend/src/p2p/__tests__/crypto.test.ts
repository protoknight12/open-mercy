import { describe, expect, it } from 'vitest'
import { fromB64, newKeyPair, open, seal, sharedKey, toB64 } from '../crypto'

describe('peer-room encryption', () => {
    it('both ends derive the same key and round-trip a frame', async () => {
        const host = await newKeyPair()
        const player = await newKeyPair()
        const kHost = await sharedKey(host.privateKey, player.publicRaw)
        const kPlayer = await sharedKey(player.privateKey, host.publicRaw)

        const sealed = await seal(kHost, '{"t":"snapshot","hand":["red-5"]}')
        expect(sealed.ct).not.toContain('red-5')
        expect(await open(kPlayer, sealed)).toBe('{"t":"snapshot","hand":["red-5"]}')
    })

    it('a listener with its own key cannot read or forge frames', async () => {
        const host = await newKeyPair()
        const player = await newKeyPair()
        const eve = await newKeyPair()
        const kPlayer = await sharedKey(player.privateKey, host.publicRaw)
        const kEve = await sharedKey(eve.privateKey, host.publicRaw)

        const sealed = await seal(kPlayer, 'secret hand')
        expect(await open(kEve, sealed)).toBeNull()

        const forged = await seal(kEve, '{"t":"intent"}')
        const kHostForPlayer = await sharedKey(host.privateKey, player.publicRaw)
        expect(await open(kHostForPlayer, forged)).toBeNull()
    })

    it('rejects a tampered frame', async () => {
        const a = await newKeyPair()
        const b = await newKeyPair()
        const k = await sharedKey(a.privateKey, b.publicRaw)
        const sealed = await seal(k, 'hello')
        const bytes = fromB64(sealed.ct)
        bytes[0] = bytes[0]! ^ 0xff
        expect(await open(k, { iv: sealed.iv, ct: toB64(bytes) })).toBeNull()
    })
})
