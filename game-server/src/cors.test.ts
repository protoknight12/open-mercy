import { describe, expect, it } from 'vitest'
import { allowedOrigin } from './cors'

const LIST = 'https://open-mercy.vercel.app, https://open-mercy-*-protoknight12s-projects.vercel.app'

describe('allowedOrigin', () => {
    it('allows listed origins exactly', () => {
        expect(allowedOrigin('https://open-mercy.vercel.app', LIST)).toBe('https://open-mercy.vercel.app')
    })

    it('allows wildcard preview deployments', () => {
        const preview = 'https://open-mercy-66kxj7ezi-protoknight12s-projects.vercel.app'
        expect(allowedOrigin(preview, LIST)).toBe(preview)
    })

    it('rejects everything else', () => {
        expect(allowedOrigin('https://evil.example', LIST)).toBeNull()
        expect(allowedOrigin('https://open-mercy.vercel.app.evil.example', LIST)).toBeNull()
        expect(allowedOrigin('https://open-mercy-x.y-protoknight12s-projects.vercel.app', LIST)).toBeNull()
        expect(allowedOrigin(null, LIST)).toBeNull()
    })

    it('always allows localhost for development', () => {
        expect(allowedOrigin('http://localhost:5173', undefined)).toBe('http://localhost:5173')
    })
})
