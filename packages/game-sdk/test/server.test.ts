import { describe, expect, it } from 'vitest'
import { buildGame } from '../src/game.js'
import { createServerClient, shareOfPot } from '../src/server.js'
import { memoryStore } from '../src/storage.js'
import { createMockApi, TEST_ADDRESS, TEST_PUBLIC_KEY, TEST_SECRET_KEY, testConnector } from '../src/testing.js'
import { recordingFetch } from './helpers.js'

const NOON = Date.UTC(2026, 0, 1, 12)
const DAY = '2026-01-01'
const TX_HASH = `0x${'ab'.repeat(32)}`

function setup(mock: Parameters<typeof createMockApi>[0] = {}) {
    const api = createMockApi({ now: () => NOON, ...mock })
    const server = createServerClient({
        apiKey: TEST_PUBLIC_KEY,
        secretKey: TEST_SECRET_KEY,
        apiUrl: 'http://localhost',
        fetch: api.fetch,
    })
    const page = (address: string) =>
        buildGame(
            {
                apiKey: TEST_PUBLIC_KEY,
                apiUrl: 'http://localhost',
                fetch: api.fetch,
                connector: testConnector(address),
            },
            { store: memoryStore(), isFramed: false, host: api.host }
        )
    return { api, server, page }
}

describe('createServerClient', () => {
    it('refuses swapped or missing keys and a plain-http API', () => {
        expect(() => createServerClient({ apiKey: TEST_SECRET_KEY, secretKey: TEST_SECRET_KEY })).toThrow(/public key/)
        expect(() => createServerClient({ apiKey: TEST_PUBLIC_KEY, secretKey: TEST_PUBLIC_KEY })).toThrow(/secret key/)
        expect(() =>
            createServerClient({ apiKey: TEST_PUBLIC_KEY, secretKey: TEST_SECRET_KEY, apiUrl: 'http://fobo.fun' })
        ).toThrow(/https/)
    })

    it('sends both keys', async () => {
        const { fetch, requests } = recordingFetch(() => ({ body: { day: DAY, winners: [], unclaimedPct: 100 } }))
        await createServerClient({ apiKey: TEST_PUBLIC_KEY, secretKey: TEST_SECRET_KEY, fetch }).winners(DAY)
        expect(requests[0]?.url).toBe(`https://fobo.fun/api/games/v1/winners?day=${DAY}`)
        expect(requests[0]?.headers).toMatchObject({
            'x-fobo-game-key': TEST_PUBLIC_KEY,
            authorization: `Bearer ${TEST_SECRET_KEY}`,
        })
    })

    it("posts a checked score under the player's wallet, and judges the winners", async () => {
        const { server, page } = setup({ scoreWrites: 'server' })
        const ace = page(TEST_ADDRESS)
        await ace.link()
        const session = ace.wallet.session ?? ''
        expect(await server.player(session)).toMatchObject({ holds: true, holdMin: 100_000 })
        await server.submitScore({ name: 'ACE', score: 50, session })
        await server.submitScore({ name: 'GUEST', score: 90 })
        const { winners, unclaimedPct } = await server.winners(DAY)
        // the unlinked top score cannot win
        expect(winners).toEqual([{ place: 1, name: 'ACE', address: TEST_ADDRESS, sharePct: 60 }])
        expect(unclaimedPct).toBe(40)
    })

    it('reports the pot and records payouts once, times in milliseconds', async () => {
        const { server, page } = setup()
        const pot = await server.setPot({ day: DAY, eth: 0.5, usd: 1500 })
        expect(pot).toEqual({ day: DAY, eth: 0.5, usd: 1500, endsAt: Date.UTC(2026, 0, 2) })
        expect(await page(TEST_ADDRESS).pot()).toEqual(pot)

        const payout = { day: DAY, place: 1, address: TEST_ADDRESS, amountWei: 300000000000000000n, txHash: TX_HASH }
        const first = await server.recordPayout(payout)
        await server.recordPayout(payout)
        expect(first).toMatchObject({ amountWei: '300000000000000000', at: NOON })
        expect((await server.payouts()).payouts).toHaveLength(1)
        expect((await page(TEST_ADDRESS).payouts()).payouts[0]?.at).toBe(NOON)
    })

    it('keeps secret-key calls from the public key', async () => {
        const { api } = setup()
        const headers = { 'X-Fobo-Game-Key': TEST_PUBLIC_KEY }
        expect(
            (await api.handle({ method: 'POST', path: '/pot', headers, body: { day: DAY, eth: 1, usd: 1 } })).status
        ).toBe(401)
        expect((await api.handle({ method: 'POST', path: '/payouts', headers, body: {} })).status).toBe(401)
        expect((await api.handle({ method: 'GET', path: '/config', headers: {} })).status).toBe(401)
    })
})

describe('shareOfPot', () => {
    it('splits to the wei, rounding down', () => {
        expect(shareOfPot(1_000_000_000_000_000_001n, 60)).toBe(600_000_000_000_000_000n)
        expect(shareOfPot(10n, 25) + shareOfPot(10n, 15) + shareOfPot(10n, 60)).toBeLessThanOrEqual(10n)
        expect(() => shareOfPot(1n, 101)).toThrow()
        expect(() => shareOfPot(1n, 12.5)).toThrow()
    })
})
