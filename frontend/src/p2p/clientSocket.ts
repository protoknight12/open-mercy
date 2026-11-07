/**
 * The player's end of a peer-hosted room: a WebSocket-shaped object, so the
 * multiplayer store drives it exactly like a socket to the Worker.
 *
 *   - Hosting this room (or resuming it after a refresh)? Use the in-memory
 *     loopback into the local host.
 *   - Otherwise: join the room's Realtime channel, exchange keys with the
 *     host, and carry sealed frames both ways.
 * If no host answers, the socket reports `room-not-found`, the same verdict
 * the Worker gives for a dead room code.
 */
import { joinRoomChannel, randomId, type Frame, type RoomChannel } from './channel'
import { newKeyPair, open, seal, sharedKey } from './crypto'
import { hostFor, type RoomSocketLike } from './roomHost'

const OPEN_RETRY_MS = 1_500
const NO_HOST_AFTER_MS = 9_000
const HEARTBEAT_MS = 5_000
// Long enough to ride out background-tab timer throttling on either side.
const HOST_SILENT_MS = 90_000

export async function openRoomSocket(code: string): Promise<RoomSocketLike> {
    const host = await hostFor(code)
    if (host) return host.connectLocal()
    return new RemoteRoomSocket(code)
}

class RemoteRoomSocket implements RoomSocketLike {
    readyState = 0
    onopen: (() => void) | null = null
    onmessage: ((e: { data: string }) => void) | null = null
    onclose: ((e: { code: number; reason: string }) => void) | null = null
    onerror: ((e: unknown) => void) | null = null

    private readonly conn = randomId()
    private channel: RoomChannel | null = null
    private key: CryptoKey | null = null
    private upChain: Promise<void> = Promise.resolve()
    private downChain: Promise<void> = Promise.resolve()
    private timers: ReturnType<typeof setInterval>[] = []
    private lastHost = Date.now()

    private readonly code: string

    private readonly onPageHide = () => this.close(1001, 'page closed')

    constructor(code: string) {
        this.code = code
        // Say goodbye when the tab closes, so the host frees the seat at once
        // instead of waiting out the heartbeat timeout.
        window.addEventListener('pagehide', this.onPageHide)
        void this.start()
    }

    private async start() {
        try {
            const keys = await newKeyPair()
            this.channel = await joinRoomChannel(this.code, (f) => this.onFrame(f, keys.privateKey))
            if (this.readyState >= 2) { this.channel.leave(); return }
            const sendOpen = () => this.channel?.send({ k: 'open', c: this.conn, p: keys.publicRaw })
            sendOpen()
            const startedAt = Date.now()
            const retry = setInterval(() => {
                if (this.key || this.readyState >= 2) { clearInterval(retry); return }
                if (Date.now() - startedAt > NO_HOST_AFTER_MS) {
                    clearInterval(retry)
                    this.noHost()
                    return
                }
                sendOpen()
            }, OPEN_RETRY_MS)
            this.timers.push(retry)
        } catch (e) {
            this.onerror?.(e)
            this.finish(1006, 'realtime unavailable')
        }
    }

    /** Nobody is hosting this code: answer like the Worker does for a dead room. */
    private noHost() {
        if (this.readyState >= 2) return
        this.readyState = 1
        this.onopen?.()
        this.onmessage?.({ data: JSON.stringify({ t: 'error', code: 'room-not-found' }) })
        this.finish(1011, 'room gone')
    }

    private async onFrame(f: Frame, privateKey: CryptoKey) {
        if (this.readyState >= 2) return
        if (f.k === 'hb' && f.from === 'host') { this.lastHost = Date.now(); return }
        if (!('c' in f) || f.c !== this.conn) return
        switch (f.k) {
            case 'accept': {
                if (this.key) return
                this.key = await sharedKey(privateKey, f.p)
                this.lastHost = Date.now()
                this.readyState = 1
                this.timers.push(setInterval(() => this.tick(), HEARTBEAT_MS))
                this.onopen?.()
                return
            }
            case 'down': {
                const key = this.key
                if (!key) return
                this.lastHost = Date.now()
                this.downChain = this.downChain.then(async () => {
                    const text = await open(key, f)
                    if (text != null && this.readyState === 1) this.onmessage?.({ data: text })
                })
                return
            }
            case 'close':
                // Let queued frames (e.g. the error that explains the close) land first.
                this.downChain = this.downChain.then(() => this.finish(f.code, f.reason))
                return
            default:
                return
        }
    }

    private tick() {
        this.channel?.send({ k: 'hb', c: this.conn, from: 'player' })
        if (Date.now() - this.lastHost > HOST_SILENT_MS) this.finish(1006, 'host gone')
    }

    send(data: string) {
        const key = this.key
        if (this.readyState !== 1 || !key) return
        this.upChain = this.upChain.then(async () => {
            const sealed = await seal(key, data)
            this.channel?.send({ k: 'up', c: this.conn, ...sealed })
        })
    }

    close(code = 1000, reason = '') {
        if (this.readyState >= 2) return
        this.channel?.send({ k: 'bye', c: this.conn })
        this.finish(code, reason)
    }

    private finish(code: number, reason: string) {
        if (this.readyState === 3) return
        this.readyState = 3
        window.removeEventListener('pagehide', this.onPageHide)
        for (const t of this.timers) clearInterval(t)
        this.timers = []
        const ch = this.channel
        this.channel = null
        // Give a final 'bye' a moment to leave before dropping the channel.
        setTimeout(() => ch?.leave(), 300)
        setTimeout(() => this.onclose?.({ code, reason }), 0)
    }
}
