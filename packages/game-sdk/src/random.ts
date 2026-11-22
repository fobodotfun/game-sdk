/**
 * Random numbers that repeat: the same seed always gives the same sequence, in the browser and on your server.
 * That is what lets a verifier replay a run. Use it for everything random in a run instead of Math.random().
 *
 *     const random = seededRandom(ticket.seed)
 *     const roll = Math.floor(random() * 6) + 1
 *
 * Not for secrets: anyone who knows the seed knows every number.
 * @returns a function that gives the next number, from 0 up to (not including) 1
 */
export function seededRandom(seed: string): () => number {
    // FNV-1a folds the seed's text into the 32-bit starting state
    let state = 0x811c9dc5
    for (let i = 0; i < seed.length; i++) {
        state ^= seed.charCodeAt(i)
        state = Math.imul(state, 0x01000193)
    }
    // mulberry32: small, fast, and whole-number maths only, so every JavaScript engine agrees on every digit
    return () => {
        state = (state + 0x6d2b79f5) | 0
        let t = Math.imul(state ^ (state >>> 15), 1 | state)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}
