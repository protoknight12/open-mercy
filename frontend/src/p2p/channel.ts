/**
 * Supabase Realtime plumbing for peer-hosted rooms: one broadcast channel per
 * room carries every frame between the host and its players. Frames are tiny
 * JSON objects; game data inside them is sealed (see crypto.ts).
 */
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Sealed } from './crypto'

/** Frames on a room channel. `c` is the connection id a player picked. */
export type Frame =
    | { k: 'open'; c: string; p: string }                       // player → host: my public key
    | { k: 'accept'; c: string; p: string }                     // host → player: host public key
    | { k: 'up'; c: string } & Sealed                            // player → host: sealed ClientMsg
    | { k: 'down'; c: string } & Sealed                          // host → player: sealed ServerMsg
    | { k: 'close'; c: string; code: number; reason: string }   // host → player: socket closed
    | { k: 'bye'; c: string }                                   // player → host: I left
    | { k: 'hb'; c: string; from: 'host' | 'player' }           // keep-alive, both ways

export const roomTopic = (code: string) => `om-room:${code}`
export const LOBBY_TOPIC = 'om-lobby'

export interface RoomChannel {
    send(frame: Frame): void
    leave(): void
}

/** Join a room channel. Resolves once subscribed, or rejects on failure. */
export function joinRoomChannel(code: string, onFrame: (f: Frame) => void, timeoutMs = 10_000): Promise<RoomChannel> {
    return new Promise((resolve, reject) => {
        const ch: RealtimeChannel = supabase.channel(roomTopic(code), {
            config: { broadcast: { self: false, ack: false } },
        })
        let done = false
        const timer = setTimeout(() => {
            if (done) return
            done = true
            void supabase.removeChannel(ch)
            reject(new Error('realtime subscribe timeout'))
        }, timeoutMs)
        ch.on('broadcast', { event: 'f' }, ({ payload }) => onFrame(payload as Frame))
        ch.subscribe((status) => {
            if (done) return
            if (status === 'SUBSCRIBED') {
                done = true
                clearTimeout(timer)
                resolve({
                    send: (frame) => { void ch.send({ type: 'broadcast', event: 'f', payload: frame }) },
                    leave: () => { void supabase.removeChannel(ch) },
                })
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                done = true
                clearTimeout(timer)
                void supabase.removeChannel(ch)
                reject(new Error(`realtime ${status}`))
            }
        })
    })
}

export function randomId(): string {
    const b = crypto.getRandomValues(new Uint8Array(12))
    return Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
}
