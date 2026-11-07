/**
 * Browser entry for peer-hosted rooms. The frontend bundles this file with
 * esbuild (frontend/scripts/build-room-host.mjs) so the room's player runs
 * the exact same GameRoomDO code the Worker runs, on top of small shims for
 * Durable Object storage, alarms and sockets (frontend/src/p2p/roomHost.ts).
 * Nothing here may touch Cloudflare-only globals at import time.
 */
export { GameRoomDO } from './index'
export { dirRegister, dirCodes, liveTables, normalizeDir } from './directory'
export { MAX_PLAYERS } from './seats'
