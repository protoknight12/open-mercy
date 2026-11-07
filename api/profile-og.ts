/**
 * Vercel port of functions/p/[code].js. Server-side OG tags for shared
 * profile links: link-preview bots don't run JavaScript, so /p/<code> is
 * rewritten here (see vercel.json) and the app shell's meta tags are filled
 * with the player's record. Any failure (bad code, SQL not installed, fetch
 * error) falls back to the untouched shell: the page always works, previews
 * are a bonus.
 */
export const config = { runtime: 'edge' }

type Profile = {
    username: string
    wins: number
    games: number
    max_stack_survived: number
    best_win_streak: number
}

const env = (k: string): string | undefined =>
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[k]

async function fetchProfile(code: string): Promise<Profile | null> {
    const url = env('VITE_SUPABASE_URL')
    const key = env('VITE_SUPABASE_ANON_KEY')
    if (!url || !key) return null
    const res = await fetch(`${url}/rest/v1/rpc/public_profile`, {
        method: 'POST',
        headers: {
            apikey: key,
            authorization: `Bearer ${key}`,
            'content-type': 'application/json',
        },
        body: JSON.stringify({ p_share_code: code }),
    })
    if (!res.ok) return null
    const rows = await res.json()
    return Array.isArray(rows) && rows.length ? (rows[0] as Profile) : null
}

const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function setMeta(html: string, attr: 'property' | 'name', key: string, value: string): string {
    const re = new RegExp(`(<meta\\s+${attr}="${key}"\\s+content=")[^"]*(")`, 'i')
    return html.replace(re, `$1${escapeHtml(value)}$2`)
}

function htmlResponse(html: string): Response {
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
}

export default async function handler(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const shellRes = await fetch(`${url.origin}/index.html`)
    const shell = await shellRes.text()

    const code = url.searchParams.get('code') || ''
    if (!/^[A-Za-z0-9]{4,32}$/.test(code)) return htmlResponse(shell)

    let profile: Profile | null = null
    try {
        profile = await fetchProfile(code)
    } catch {
        return htmlResponse(shell)
    }
    if (!profile) return htmlResponse(shell)

    // Mirrors the thresholds in frontend/src/utils/ranks.ts.
    const rankTitle =
        profile.wins >= 200 ? 'No Mercy King' :
        profile.wins >= 100 ? 'Overlord' :
        profile.wins >= 50 ? 'Warlord' :
        profile.wins >= 30 ? 'Savage' :
        profile.wins >= 15 ? 'Enforcer' :
        profile.wins >= 5 ? 'Rookie' : 'Recruit'

    const title = `${profile.username} - ${rankTitle} · ${profile.wins} wins | Open Mercy`
    const brags: string[] = []
    if (profile.max_stack_survived > 0) brags.push(`Survived a +${profile.max_stack_survived} stack`)
    if (profile.best_win_streak > 1) brags.push(`${profile.best_win_streak}-win streak`)
    brags.push(`${profile.games} games played`)
    const description = `${brags.join(' · ')}. Think you can beat ${profile.username}? Play free — no download.`
    const pageUrl = `${url.origin}/p/${code}`

    let html = shell.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`)
    html = setMeta(html, 'property', 'og:title', title)
    html = setMeta(html, 'property', 'og:description', description)
    html = setMeta(html, 'property', 'og:url', pageUrl)
    html = setMeta(html, 'name', 'twitter:title', title)
    html = setMeta(html, 'name', 'twitter:description', description)
    html = setMeta(html, 'name', 'twitter:url', pageUrl)
    return htmlResponse(html)
}
