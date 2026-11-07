/**
 * Browser origins allowed to call the HTTP endpoints (WebSockets don't
 * preflight). An allowlist, not '*'.
 *
 * Configured by the ALLOWED_ORIGINS var in wrangler.toml: a comma-separated
 * list of exact origins, where an entry may contain one `*` that matches a
 * run of letters, digits and hyphens. For example
 * `https://open-mercy-*-protoknight12s-projects.vercel.app` covers Vercel
 * preview deployments. Local dev (http://localhost:<port>) is always allowed.
 */
export function allowedOrigin(origin: string | null, allowList: string | undefined): string | null {
    if (!origin) return null
    if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return origin
    for (const raw of (allowList ?? '').split(',')) {
        const entry = raw.trim()
        if (!entry) continue
        if (!entry.includes('*')) {
            if (entry === origin) return origin
            continue
        }
        const star = entry.indexOf('*')
        const head = entry.slice(0, star)
        const tail = entry.slice(star + 1)
        const re = new RegExp(`^${escapeRe(head)}[a-z0-9-]+${escapeRe(tail)}$`)
        if (re.test(origin)) return origin
    }
    return null
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
