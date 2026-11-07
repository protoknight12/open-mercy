/**
 * End-to-end encryption for peer-hosted rooms.
 *
 * Rooms talk over a public Supabase Realtime broadcast channel, so anyone who
 * knows the room code can listen. Each player and the host agree on a key with
 * ECDH (P-256) and seal every frame with AES-GCM. A listener can't read
 * another player's hand, and can't forge frames for a connection, because
 * AES-GCM rejects anything not sealed with that connection's key.
 */

const ECDH: EcKeyImportParams = { name: 'ECDH', namedCurve: 'P-256' }

export interface KeyPair {
    privateKey: CryptoKey
    publicRaw: string // base64 of the raw public point
}

export async function newKeyPair(): Promise<KeyPair> {
    const kp = await crypto.subtle.generateKey(ECDH, false, ['deriveKey'])
    const raw = await crypto.subtle.exportKey('raw', kp.publicKey)
    return { privateKey: kp.privateKey, publicRaw: toB64(new Uint8Array(raw)) }
}

/** The AES-GCM key shared by my private key and their public key. */
export async function sharedKey(myPrivate: CryptoKey, theirPublicRaw: string): Promise<CryptoKey> {
    const theirs = await crypto.subtle.importKey('raw', fromB64(theirPublicRaw), ECDH, false, [])
    return crypto.subtle.deriveKey(
        { name: 'ECDH', public: theirs },
        myPrivate,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    )
}

export interface Sealed {
    iv: string
    ct: string
}

export async function seal(key: CryptoKey, text: string): Promise<Sealed> {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text))
    return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) }
}

/** The plaintext, or null when the frame was not sealed with this key. */
export async function open(key: CryptoKey, sealed: Sealed): Promise<string | null> {
    try {
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv) }, key, fromB64(sealed.ct))
        return new TextDecoder().decode(pt)
    } catch {
        return null
    }
}

export function toB64(bytes: Uint8Array): string {
    let s = ''
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!)
    return btoa(s)
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
    const s = atob(b64)
    const out = new Uint8Array(new ArrayBuffer(s.length))
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
    return out
}
