/**
 * Vercel port of functions/api/geo.js. Country lookup for the client:
 * Vercel stamps every request with its edge-detected country, so this is a
 * zero-dependency mirror. Consumed by frontend/src/utils/country.ts.
 */
export const config = { runtime: 'edge' }

export default function handler(request: Request): Response {
    const country = request.headers.get('x-vercel-ip-country') || null
    return new Response(JSON.stringify({ country }), {
        headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store',
        },
    })
}
