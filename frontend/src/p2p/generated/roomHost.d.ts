// Types for the generated browser bundle of game-server/src/browserHost.ts.
// Hand-written and committed; the .js beside it is generated at build time.

/** The subset of a Durable Object socket the room code calls. */
export interface DOSocket {
    send(data: string): void
    close(code?: number, reason?: string): void
    serializeAttachment(value: unknown): void
    deserializeAttachment(): unknown
}

export interface DOStorage {
    get<T = unknown>(key: string): Promise<T | undefined>
    put(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<boolean>
    deleteAll(): Promise<void>
    setAlarm(when: number | Date): Promise<void>
    getAlarm(): Promise<number | null>
    deleteAlarm(): Promise<void>
}

export interface DOState {
    storage: DOStorage
    acceptWebSocket(ws: DOSocket): void
    getWebSockets(): DOSocket[]
}

export interface DOStub {
    fetch(input: string, init?: RequestInit): Promise<Response>
}

export interface DONamespace {
    idFromName(name: string): unknown
    get(id: unknown, opts?: unknown): DOStub
}

export interface RoomEnv {
    SUPABASE_URL: string
    SUPABASE_ANON_KEY: string
    ROOM: DONamespace
    ALLOWED_ORIGINS?: string
}

export declare class GameRoomDO {
    constructor(ctx: DOState, env: RoomEnv)
    fetch(req: Request): Promise<Response>
    webSocketMessage(ws: DOSocket, raw: string): Promise<void>
    webSocketClose(ws: DOSocket): Promise<void>
    alarm(): Promise<void>
}

export type RoomPhase = 'lobby' | 'playing' | 'finished'

export interface DirEntry {
    at: number
    updatedAt?: number
    players?: number
    connected?: number
    seatsFree?: number
    inProgress?: boolean
    status?: RoomPhase
    mode?: string
    skins?: string[]
}

export interface PublicTable {
    code: string
    players: number
    seatsFree: number
    inProgress: boolean
    mode: string
    skins: string[]
    status: RoomPhase
}

export declare function dirRegister(dir: Record<string, DirEntry>, code: string, snapshot: unknown, now: number): boolean
export declare function dirCodes(raw: Record<string, DirEntry | number> | undefined): string[]
export declare function liveTables(raw: Record<string, DirEntry | number> | undefined, now: number, limit?: number): PublicTable[]
export declare function normalizeDir(raw: unknown): Record<string, DirEntry>
export declare const MAX_PLAYERS: number
