/**
 * In-game feedback, stored privately in this project's Vercel Blob store
 * (open-mercy-feedback). Each submission is one JSON file under feedback/.
 * Read them in the Vercel dashboard (Storage → open-mercy-feedback) or with
 * `npx vercel blob list --prefix feedback/`. Nothing is public and nothing is
 * sent to any third party.
 */
import { put } from '@vercel/blob'

// Node.js runtime (the default): @vercel/blob depends on Node modules the Edge
// runtime cannot load.

const MAX_BODY = 8_000

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    })
}

const clip = (v: unknown, n: number): string | null =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null

export async function POST(request: Request): Promise<Response> {
    const raw = await request.text()
    if (raw.length > MAX_BODY) return json({ ok: false, error: 'too_large' }, 413)

    let body: Record<string, unknown>
    try {
        body = JSON.parse(raw) as Record<string, unknown>
    } catch {
        return json({ ok: false, error: 'bad_json' }, 400)
    }
    // Honeypot: the form never fills this field; simple bots do.
    if (body.website) return json({ ok: true })

    const message = clip(body.message, 4000)
    if (!message) return json({ ok: false, error: 'empty' }, 400)

    const entry = {
        message,
        email: clip(body.email, 320),
        user_id: clip(body.user_id, 64),
        page: clip(body.page, 500),
        user_agent: clip(request.headers.get('user-agent'), 500),
        country: request.headers.get('x-vercel-ip-country'),
        received_at: new Date().toISOString(),
    }

    try {
        const id = `${entry.received_at.replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`
        await put(`feedback/${id}.json`, JSON.stringify(entry, null, 2), {
            access: 'private',
            contentType: 'application/json',
            addRandomSuffix: false,
        })
        return json({ ok: true })
    } catch {
        return json({ ok: false, error: 'storage' }, 502)
    }
}
