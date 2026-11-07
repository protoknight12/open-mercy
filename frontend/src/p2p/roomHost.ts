/**
 * Peer-hosted rooms: the browser that creates a room runs the room.
 *
 * The room logic is the game server's own GameRoomDO, bundled for the
 * browser (scripts/build-room-host.mjs). This file supplies what Cloudflare
 * would: storage, alarms, accepted sockets, and the public-room directory.
 *   - Every room event runs through one queue, like a Durable Object's input
 *     gate, so intents never interleave mid-move.
 *   - Storage clones on read and write (Durable Object semantics) and mirrors
 *     to localStorage, so a host who refreshes keeps the room.
 *   - Remote players reach the room over an encrypted Supabase Realtime
 *     channel (channel.ts, crypto.ts); the host's own player uses an
 *     in-memory loopback socket.
 * The room lives as long as the host's tab. That is the trade-off for needing
 * no server, and it is why VITE_GAME_SERVER_URL can still point at a Worker.
 */
import { GameRoomDO, type DOSocket, type DOState, type DOStorage, type RoomEnv } from './generated/roomHost'
import { joinRoomChannel, type Frame, type RoomChannel } from './channel'
import { newKeyPair, open, seal, sharedKey, type KeyPair } from './crypto'
import { publishPublicRoom, unpublishPublicRoom } from './lobby'

const PERSIST_PREFIX = 'om-p2p-room:'
const HEARTBEAT_MS = 5_000
// Background tabs run timers as rarely as once a minute (Chrome intensive
// throttling), so a player's heartbeat can legitimately go quiet that long.
const CONN_TIMEOUT_MS = 150_000

const hosts = new Map<string, BrowserRoomHost>()

export function isHosting(code: string): boolean {
    return hosts.has(code)
}

/** A room this browser hosted before a refresh, waiting to be resumed. */
export function hasPersistedRoom(code: string): boolean {
    try { return !!localStorage.getItem(PERSIST_PREFIX + code) } catch { return false }
}

/** Rooms whose host tab closed mid-game never reach GC; drop their saved state. */
const PERSIST_MAX_AGE_MS = 12 * 60 * 60 * 1000

export function sweepStaleRooms(now = Date.now()): void {
    try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i)
            if (!key?.startsWith(PERSIST_PREFIX) || hosts.has(key.slice(PERSIST_PREFIX.length))) continue
            let stale = true
            try {
                const parsed = JSON.parse(localStorage.getItem(key) ?? '') as { data: [string, unknown][] }
                const room = new Map(parsed.data).get('room') as { createdAt?: number } | undefined
                stale = !room?.createdAt || now - room.createdAt > PERSIST_MAX_AGE_MS
            } catch { /* unreadable: stale */ }
            if (stale) localStorage.removeItem(key)
        }
    } catch { /* storage blocked */ }
}

export async function hostRoom(opts: { code: string; hostUserId: string; stackingMode: string; isPublic: boolean }): Promise<void> {
    sweepStaleRooms()
    const host = await BrowserRoomHost.start(opts.code)
    await host.activate(opts)
}

/** The running host for `code`, resuming a persisted one after a refresh. */
export async function hostFor(code: string): Promise<BrowserRoomHost | null> {
    const running = hosts.get(code)
    if (running) return running
    if (!hasPersistedRoom(code)) return null
    try {
        return await BrowserRoomHost.start(code)
    } catch {
        return null
    }
}

// ---------------------------------------------------------------- storage

class PersistentStorage implements DOStorage {
    private data = new Map<string, unknown>()
    alarmAt: number | null = null
    private readonly key: string
    private readonly onAlarmChange: () => void

    constructor(key: string, onAlarmChange: () => void) {
        this.key = key
        this.onAlarmChange = onAlarmChange
        try {
            const raw = localStorage.getItem(key)
            if (raw) {
                const parsed = JSON.parse(raw) as { data: [string, unknown][]; alarmAt: number | null }
                this.data = new Map(parsed.data)
                this.alarmAt = parsed.alarmAt
            }
        } catch { /* start empty */ }
    }

    private persist() {
        try {
            if (this.data.size === 0) localStorage.removeItem(this.key)
            else localStorage.setItem(this.key, JSON.stringify({ data: [...this.data], alarmAt: this.alarmAt }))
        } catch { /* quota or private mode: the room still runs in memory */ }
    }

    async get<T = unknown>(key: string): Promise<T | undefined> {
        const v = this.data.get(key)
        return v === undefined ? undefined : structuredClone(v) as T
    }
    async put(key: string, value: unknown): Promise<void> {
        this.data.set(key, structuredClone(value))
        this.persist()
    }
    async delete(key: string): Promise<boolean> {
        const had = this.data.delete(key)
        this.persist()
        return had
    }
    async deleteAll(): Promise<void> {
        this.data.clear()
        this.alarmAt = null
        this.persist()
        this.onAlarmChange()
    }
    async setAlarm(when: number | Date): Promise<void> {
        this.alarmAt = typeof when === 'number' ? when : when.getTime()
        this.persist()
        this.onAlarmChange()
    }
    async getAlarm(): Promise<number | null> {
        return this.alarmAt
    }
    async deleteAlarm(): Promise<void> {
        this.alarmAt = null
        this.persist()
        this.onAlarmChange()
    }
    get isEmpty(): boolean {
        return this.data.size === 0
    }
}

// ---------------------------------------------------------------- sockets

/** The room's end of a connection: what GameRoomDO calls send/close on. */
class HostSocket implements DOSocket {
    private attachment: unknown = null
    open = true
    private readonly deliver: (data: string) => void
    private readonly onServerClose: (code: number, reason: string) => void
    constructor(deliver: (data: string) => void, onServerClose: (code: number, reason: string) => void) {
        this.deliver = deliver
        this.onServerClose = onServerClose
    }
    send(data: string) {
        if (this.open) this.deliver(data)
    }
    close(code = 1000, reason = '') {
        if (!this.open) return
        this.open = false
        this.onServerClose(code, reason)
    }
    serializeAttachment(value: unknown) { this.attachment = structuredClone(value) }
    deserializeAttachment() { return this.attachment }
}

interface RemoteConn {
    sock: HostSocket
    key: CryptoKey
    lastSeen: number
    upChain: Promise<void>
    downChain: Promise<void>
}

/** WebSocket-shaped object the multiplayer store drives (see clientSocket.ts). */
export interface RoomSocketLike {
    readyState: number
    onopen: (() => void) | null
    onmessage: ((e: { data: string }) => void) | null
    onclose: ((e: { code: number; reason: string }) => void) | null
    onerror: ((e: unknown) => void) | null
    send(data: string): void
    close(code?: number, reason?: string): void
}

// ---------------------------------------------------------------- host

export class BrowserRoomHost {
    private room: GameRoomDO
    private storage: PersistentStorage
    private accepted = new Set<HostSocket>()
    private queue: Promise<unknown> = Promise.resolve()
    private alarmTimer: ReturnType<typeof setTimeout> | null = null
    private channel: RoomChannel | null = null
    private keys: KeyPair | null = null
    private conns = new Map<string, RemoteConn>()
    private pending = new Set<string>()
    private heartbeat: ReturnType<typeof setInterval> | null = null
    private disposed = false

    readonly code: string

    private constructor(code: string) {
        this.code = code
        this.storage = new PersistentStorage(PERSIST_PREFIX + code, () => this.armAlarm())
        const ctx: DOState = {
            storage: this.storage,
            acceptWebSocket: (ws) => { this.accepted.add(ws as HostSocket) },
            getWebSockets: () => [...this.accepted].filter(s => s.open),
        }
        const env: RoomEnv = {
            SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL as string,
            SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
            ROOM: {
                idFromName: (name: string) => name,
                get: () => ({ fetch: (url: string, init?: RequestInit) => this.directoryFetch(url, init) }),
            },
        }
        this.room = new GameRoomDO(ctx, env)
    }

    static async start(code: string): Promise<BrowserRoomHost> {
        const existing = hosts.get(code)
        if (existing) return existing
        const host = new BrowserRoomHost(code)
        hosts.set(code, host)
        try {
            host.keys = await newKeyPair()
            host.channel = await joinRoomChannel(code, (f) => host.onFrame(f))
        } catch (e) {
            hosts.delete(code)
            throw e
        }
        host.heartbeat = setInterval(() => host.tick(), HEARTBEAT_MS)
        host.armAlarm()
        return host
    }

    /** Serialise every room event, like a Durable Object input gate. */
    private run<T>(fn: () => Promise<T>): Promise<T> {
        const next = this.queue.then(fn, fn)
        this.queue = next.catch(() => undefined)
        return next
    }

    async activate(opts: { code: string; hostUserId: string; stackingMode: string; isPublic: boolean }): Promise<void> {
        await this.run(() => this.room.fetch(new Request('https://do/activate', {
            method: 'POST',
            body: JSON.stringify({ code: opts.code, hostUserId: opts.hostUserId, stackingMode: opts.stackingMode, isPublic: opts.isPublic }),
        })))
    }

    private async roomExists(): Promise<boolean> {
        return !!(await this.storage.get('room'))
    }

    // --- alarms

    private armAlarm() {
        if (this.alarmTimer) clearTimeout(this.alarmTimer)
        this.alarmTimer = null
        const at = this.storage.alarmAt
        if (at == null || this.disposed) return
        this.alarmTimer = setTimeout(() => {
            this.alarmTimer = null
            // Durable Objects clear the alarm before running it; the handler re-arms.
            this.storage.alarmAt = null
            void this.run(() => this.room.alarm()).then(() => this.afterEvent())
        }, Math.max(0, at - Date.now()))
    }

    /** The room deletes itself on GC; once storage is empty, stop hosting. */
    private afterEvent() {
        if (this.storage.isEmpty) this.dispose()
    }

    private dispose() {
        if (this.disposed) return
        this.disposed = true
        if (this.alarmTimer) clearTimeout(this.alarmTimer)
        if (this.heartbeat) clearInterval(this.heartbeat)
        void unpublishPublicRoom(this.code)
        this.channel?.leave()
        hosts.delete(this.code)
    }

    // --- directory (quick match) via Supabase Realtime presence

    private async directoryFetch(url: string, init?: RequestInit): Promise<Response> {
        const path = new URL(url).pathname
        const body = init?.body ? JSON.parse(String(init.body)) : {}
        if (path === '/dir-register') {
            await publishPublicRoom(body.code, body.snapshot)
            return new Response('ok')
        }
        if (path === '/dir-unregister') {
            await unpublishPublicRoom(body.code)
            return new Response('ok')
        }
        if (path === '/create-allow') return Response.json(true)
        return new Response('not found', { status: 404 })
    }

    // --- remote players

    private tick() {
        this.channel?.send({ k: 'hb', c: '*', from: 'host' })
        const now = Date.now()
        for (const [c, conn] of this.conns) {
            if (now - conn.lastSeen > CONN_TIMEOUT_MS) this.dropConn(c)
        }
    }

    private dropConn(c: string) {
        const conn = this.conns.get(c)
        if (!conn) return
        this.conns.delete(c)
        if (conn.sock.open) {
            conn.sock.open = false
            this.accepted.delete(conn.sock)
            void this.run(() => this.room.webSocketClose(conn.sock)).then(() => this.afterEvent())
        }
    }

    private async onFrame(f: Frame) {
        if (this.disposed || !this.channel || !this.keys) return
        switch (f.k) {
            case 'open': {
                const existing = this.conns.get(f.c)
                if (existing) {
                    existing.lastSeen = Date.now()
                    this.channel.send({ k: 'accept', c: f.c, p: this.keys.publicRaw })
                    return
                }
                // Players resend 'open' until answered; handle each connection once.
                if (this.pending.has(f.c)) return
                this.pending.add(f.c)
                let key: CryptoKey
                try {
                    if (!(await this.roomExists())) {
                        this.channel.send({ k: 'close', c: f.c, code: 1011, reason: 'room gone' })
                        return
                    }
                    key = await sharedKey(this.keys.privateKey, f.p)
                } catch {
                    return // malformed public key
                } finally {
                    this.pending.delete(f.c)
                }
                if (this.conns.has(f.c) || !this.channel) return
                const c = f.c
                const conn: RemoteConn = {
                    key,
                    lastSeen: Date.now(),
                    upChain: Promise.resolve(),
                    downChain: Promise.resolve(),
                    sock: new HostSocket(
                        (data) => {
                            // Seal in order: AES-GCM is async, and frames must not reorder.
                            conn.downChain = conn.downChain.then(async () => {
                                const sealed = await seal(key, data)
                                this.channel?.send({ k: 'down', c, ...sealed })
                            })
                        },
                        (code, reason) => {
                            this.accepted.delete(conn.sock)
                            conn.downChain = conn.downChain.then(() => {
                                this.channel?.send({ k: 'close', c, code, reason })
                            })
                            this.conns.delete(c)
                        },
                    ),
                }
                this.conns.set(c, conn)
                this.accepted.add(conn.sock)
                this.channel.send({ k: 'accept', c, p: this.keys.publicRaw })
                return
            }
            case 'up': {
                const conn = this.conns.get(f.c)
                if (!conn) {
                    // A player from before a host refresh: tell them to reconnect.
                    this.channel.send({ k: 'close', c: f.c, code: 4000, reason: 'reconnect' })
                    return
                }
                conn.lastSeen = Date.now()
                conn.upChain = conn.upChain.then(async () => {
                    const text = await open(conn.key, f)
                    if (text == null || !conn.sock.open) return // not sealed with this key: forged or stale
                    await this.run(() => this.room.webSocketMessage(conn.sock, text))
                    this.afterEvent()
                })
                return
            }
            case 'hb': {
                if (f.from !== 'player') return
                const conn = this.conns.get(f.c)
                if (conn) {
                    conn.lastSeen = Date.now()
                    // Answer on the event, not a timer: a backgrounded host tab
                    // still receives messages promptly even when timers stall.
                    this.channel.send({ k: 'hb', c: f.c, from: 'host' })
                } else {
                    this.channel.send({ k: 'close', c: f.c, code: 4000, reason: 'reconnect' })
                }
                return
            }
            case 'bye':
                this.dropConn(f.c)
                return
            default:
                return
        }
    }

    // --- the host's own player

    /** An in-memory socket into this room for the host's own client. */
    connectLocal(): RoomSocketLike {
        const host = this
        let serverSock: HostSocket | null = null
        const client: RoomSocketLike = {
            readyState: 0,
            onopen: null,
            onmessage: null,
            onclose: null,
            onerror: null,
            send(data: string) {
                if (client.readyState !== 1 || !serverSock) return
                const sock = serverSock
                void host.run(() => host.room.webSocketMessage(sock, data)).then(() => host.afterEvent())
            },
            close(code = 1000, reason = '') {
                if (client.readyState >= 2) return
                client.readyState = 3
                const sock = serverSock
                if (sock?.open) {
                    sock.open = false
                    host.accepted.delete(sock)
                    void host.run(() => host.room.webSocketClose(sock)).then(() => host.afterEvent())
                }
                setTimeout(() => client.onclose?.({ code, reason }), 0)
            },
        }
        void (async () => {
            if (!(await host.roomExists())) {
                client.readyState = 1
                client.onopen?.()
                client.onmessage?.({ data: JSON.stringify({ t: 'error', code: 'room-not-found' }) })
                client.readyState = 3
                client.onclose?.({ code: 1011, reason: 'room gone' })
                return
            }
            serverSock = new HostSocket(
                (data) => { setTimeout(() => client.onmessage?.({ data }), 0) },
                (code, reason) => {
                    host.accepted.delete(serverSock!)
                    client.readyState = 3
                    setTimeout(() => client.onclose?.({ code, reason }), 0)
                },
            )
            host.accepted.add(serverSock)
            client.readyState = 1
            client.onopen?.()
        })()
        return client
    }
}
