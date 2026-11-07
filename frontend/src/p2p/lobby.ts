/**
 * Public-room directory for peer-hosted rooms, on Supabase Realtime presence.
 * Each host tracks one presence entry per public room it runs; quick match and
 * the live-tables strip read the presence state and rank it with the game
 * server's own directory functions, so ordering matches the Worker exactly.
 */
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { LOBBY_TOPIC } from './channel'
import { dirCodes, dirRegister, liveTables, type DirEntry, type PublicTable } from './generated/roomHost'

interface PresenceRoom {
    code: string
    snapshot: unknown
    at: number
}

let hostChannel: RealtimeChannel | null = null
let hostReady: Promise<RealtimeChannel> | null = null
const published = new Map<string, PresenceRoom>()

function subscribe(ch: RealtimeChannel, timeoutMs = 8_000): Promise<RealtimeChannel> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('lobby subscribe timeout')), timeoutMs)
        ch.subscribe((status) => {
            if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(ch) }
            else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); reject(new Error(status)) }
        })
    })
}

async function lobbyForHosting(): Promise<RealtimeChannel> {
    if (!hostReady) {
        hostChannel = supabase.channel(LOBBY_TOPIC, { config: { presence: { key: crypto.randomUUID() } } })
        hostReady = subscribe(hostChannel).catch((e) => { hostReady = null; throw e })
    }
    return hostReady
}

/** Presence holds one payload per key, so all of this tab's rooms go in it. */
async function retrack() {
    const ch = await lobbyForHosting()
    await ch.track({ rooms: [...published.values()] })
}

export async function publishPublicRoom(code: string, snapshot: unknown): Promise<void> {
    const prev = published.get(code)
    published.set(code, { code, snapshot, at: prev?.at ?? Date.now() })
    try { await retrack() } catch { /* directory unreachable: the room plays on */ }
}

export async function unpublishPublicRoom(code: string): Promise<void> {
    if (!published.delete(code)) return
    try { await retrack() } catch { /* ignore */ }
}

/** Snapshot of every public room currently announced, as a directory map. */
async function readDirectory(): Promise<Record<string, DirEntry>> {
    // Reuse this tab's hosting channel when it exists; otherwise join briefly.
    const own = hostChannel && hostReady ? await hostReady.catch(() => null) : null
    const ch = own ?? supabase.channel(LOBBY_TOPIC, { config: { presence: { key: crypto.randomUUID() } } })
    try {
        if (!own) {
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => resolve(), 2_500) // an empty lobby never syncs late
                ch.on('presence', { event: 'sync' }, () => { clearTimeout(timer); resolve() })
                subscribe(ch).catch((e) => { clearTimeout(timer); reject(e) })
            })
        }
        const dir: Record<string, DirEntry> = {}
        const state = ch.presenceState<{ rooms?: PresenceRoom[] }>()
        const now = Date.now()
        for (const metas of Object.values(state)) {
            for (const meta of metas) {
                for (const room of meta.rooms ?? []) {
                    if (dirRegister(dir, room.code, room.snapshot, room.at)) dir[room.code]!.updatedAt = now
                }
            }
        }
        return dir
    } catch {
        return {}
    } finally {
        if (!own) void supabase.removeChannel(ch)
    }
}

/** Public room codes in quick-match order (same rules as the Worker). */
export async function publicRoomCodes(): Promise<string[]> {
    return dirCodes(await readDirectory())
}

export async function publicLiveTables(): Promise<PublicTable[]> {
    return liveTables(await readDirectory(), Date.now())
}
