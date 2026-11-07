import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

// This fork ships no ads and no analytics. The original project's Google
// Analytics, Google Ads and AdSense IDs sent visitor data and ad revenue to
// that project's accounts, so they were removed. These guards keep them (or
// any other third-party tag) from coming back by accident.
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8')

function htmlFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) return htmlFiles(p)
        return name.endsWith('.html') ? [p] : []
    })
}

const FORBIDDEN = [
    /G-HF9GCTVQ7J/,                       // original GA4 property
    /AW-\d{6,}/,                          // Google Ads conversion ids
    /ca-pub-\d+|pub-\d{10,}/,             // AdSense publisher ids
    /googletagmanager\.com/,
    /pagead2\.googlesyndication\.com/,
    /fundingchoicesmessages\.google\.com/,
    /formsubmit\.co/,
]

describe('no third-party tracking or ads', () => {
    it('index.html carries none', () => {
        for (const re of FORBIDDEN) expect(indexHtml).not.toMatch(re)
    })

    it('no static page carries any', () => {
        for (const file of htmlFiles(join(root, 'public'))) {
            const html = readFileSync(file, 'utf8')
            for (const re of FORBIDDEN) expect(html, `${file} matches ${re}`).not.toMatch(re)
        }
    })

    it('ads.txt authorises no ad network', () => {
        const ads = readFileSync(join(root, 'public', 'ads.txt'), 'utf8')
        expect(ads).not.toMatch(/^[^#\s]/m)
    })

    it('keeps an inert gtag so track() calls stay harmless', () => {
        const scripts = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!)
        const win: Record<string, any> = {}
        win.window = win
        const ctx = createContext(win)
        for (const s of scripts.filter((s) => s.includes('function gtag'))) runInContext(s, ctx)
        expect(typeof win.gtag).toBe('function')
        win.gtag('event', 'x')
        expect(win.dataLayer).toHaveLength(1)
    })
})
