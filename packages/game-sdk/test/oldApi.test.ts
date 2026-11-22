import { describe, expect, it } from 'vitest'

import { createGame } from '../src/index.js'
import { KEY_HEADER, linkMessage } from '../src/protocol.js'
import { createServerClient } from '../src/serverClient.js'
import { createVerifier } from '../src/verifier.js'
import { ACCOUNT } from './helpers.js'

/*
 * fobo.fun's first Game API v1, as it ran before boards, items and profiles: one daily board per game, and nine
 * routes. A game that moves to this SDK before the site is updated must keep working, so this is that API's
 * answers written out by hand (not the SDK's mock, which speaks the new one).
 */

const PUBLIC_KEY = 'pk_oldgame_0123456789'
const SECRET_KEY = 'sk_oldgame_0123456789'
const API_URL = 'https://fobo.fun'
const VERIFY_URL = 'https://game.example/verify'
const HOST = 'game.example'
const TODAY = '2026-11-22'
const DAY_ENDS_AT = 1_795_478_400
const SESSION = 'sealed.session.token'
const WALLET = ACCOUNT.address.toLowerCase()

interface OldRow {
    name: string
    score: number
    meta: Record<string, unknown> | null
    wallet: string | null
}

/** The old API: its routes, its answers, nothing else (anything newer is a 404, as on the live site). */
function oldApi({ scoreWrites = 'client' }: { scoreWrites?: 'client' | 'server' } = {}) {
    const days = new Map<string, OldRow[]>()
    const pots = new Map<string, { eth: number; usd: number }>()
    const payouts: Record<string, unknown>[] = []
    const seen: { route: string; query: Record<string, string>; body: Record<string, unknown> }[] = []
    let name: string | null = null
    let nonce = 0

    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    const rowsOf = (day: string) => days.get(day) ?? []
    const entry = (row: OldRow, index: number) => ({
        rank: index + 1,
        name: row.name,
        score: row.score,
        meta: row.meta,
        linked: row.wallet !== null,
    })
    const board = (day: string, asked: string | null) => {
        const rows = [...rowsOf(day)].sort((a, b) => b.score - a.score)
        const mine = asked ? rows.findIndex((row) => row.name.toLowerCase() === asked.toLowerCase()) : -1
        return { day, top: rows.map(entry), you: mine < 0 ? null : entry(rows[mine]!, mine) }
    }

    const fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
        const url = new URL(input)
        const headers = new Headers(init.headers)
        const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}
        const route = `${init.method ?? 'GET'} ${url.pathname.replace('/api/games/v1', '')}`
        const query = Object.fromEntries(url.searchParams)
        seen.push({ route, query, body })
        if (headers.get(KEY_HEADER) !== PUBLIC_KEY) return json({ error: 'Unknown game key' }, 401)
        const hasSecret = headers.get('Authorization') === `Bearer ${SECRET_KEY}`
        switch (route) {
            case 'GET /config':
                return json({
                    game: 'old-game',
                    title: 'Old Game',
                    tokenAddress: `0x${'1'.repeat(40)}`,
                    ticker: 'OLD',
                    holdMin: 100_000,
                    shares: [50, 30, 20],
                    scoreWrites,
                    dayEndsAt: DAY_ENDS_AT,
                })
            case 'GET /link/nonce':
                return json({ nonce: `nonce_${String(++nonce).padStart(16, '0')}` })
            case 'POST /link':
                return json({ session: SESSION, address: WALLET, name, holds: true, holdMin: 100_000 })
            case 'POST /player':
                if (body.session !== SESSION) return json({ error: 'Session expired' }, 401)
                if (typeof body.name === 'string') name = body.name
                return json({
                    address: `${WALLET.slice(0, 6)}…${WALLET.slice(-4)}`,
                    name,
                    holds: true,
                    holdMin: 100_000,
                })
            case 'GET /board':
                return json(board(query.day ?? TODAY, query.name ?? null))
            case 'POST /scores': {
                if (scoreWrites === 'server' && !hasSecret)
                    return json({ error: 'Scores are written by the game' }, 403)
                const row = {
                    name: (body.session === SESSION ? name : null) ?? String(body.name),
                    score: Number(body.score),
                    meta: (body.meta as Record<string, unknown> | undefined) ?? null,
                    wallet: body.session === SESSION ? WALLET : null,
                }
                days.set(TODAY, [...rowsOf(TODAY).filter((kept) => kept.name !== row.name), row])
                return json(board(TODAY, row.name))
            }
            case 'GET /pot': {
                const day = query.day ?? TODAY
                return json({ day, ...(pots.get(day) ?? { eth: 0, usd: 0 }), endsAt: DAY_ENDS_AT })
            }
            case 'POST /pot':
                if (!hasSecret) return json({ error: 'Secret key required' }, 401)
                pots.set(String(body.day), { eth: Number(body.eth), usd: Number(body.usd) })
                return json({ day: body.day, eth: body.eth, usd: body.usd, endsAt: DAY_ENDS_AT })
            case 'GET /winners': {
                const linked = board(query.day ?? TODAY, null).top.filter((row) => row.linked)
                return json({
                    day: query.day ?? TODAY,
                    winners: linked.slice(0, 3).map((row, i) => ({
                        place: i + 1,
                        name: row.name,
                        address: WALLET,
                        sharePct: [50, 30, 20][i],
                    })),
                    unclaimedPct: [50, 30, 20].slice(linked.length).reduce((sum, share) => sum + share, 0),
                })
            }
            case 'GET /payouts':
                return json({ payouts: payouts.slice(0, Number(query.limit ?? 10)) })
            case 'POST /payouts': {
                if (!hasSecret) return json({ error: 'Secret key required' }, 401)
                const payout = { ...body, name, at: DAY_ENDS_AT - 60 }
                payouts.unshift(payout)
                return json(payout)
            }
            default:
                return json({ error: 'Not found' }, 404)
        }
    }
    return { fetch, seen, days }
}

/** The game's page and its server, both on the old API, the way a prize game wires them. */
function world(options: { scoreWrites?: 'client' | 'server' } = {}) {
    const api = oldApi(options)
    const server = createServerClient({ apiKey: PUBLIC_KEY, secretKey: SECRET_KEY, apiUrl: API_URL, fetch: api.fetch })
    const verifier = createVerifier<number[]>({
        server,
        replay: (_seed, inputs) => inputs.reduce((sum, input) => sum + input, 0),
    })
    const fetch = (input: string, init?: RequestInit) =>
        input === VERIFY_URL ? verifier.handle(new Request(input, init)) : api.fetch(input, init)
    const game = createGame({
        apiKey: PUBLIC_KEY,
        apiUrl: API_URL,
        verifyUrl: VERIFY_URL,
        fetch,
        storageKey: 'old-api-test',
        connector: {
            sign: async (message) => {
                expect(message).toBe(linkMessage(HOST, message.split('Nonce: ')[1]!))
                return { address: ACCOUNT.address, signature: await ACCOUNT.signMessage({ message }) }
            },
        },
    })
    return { api, server, game }
}

describe('against the first Game API v1 (fobo.fun before boards)', () => {
    it('reads a config with no boards, apiVersion or writes: one main board, writes from scoreWrites', async () => {
        const { game } = world({ scoreWrites: 'server' })
        const config = await game.config()
        expect(config).toMatchObject({
            game: 'old-game',
            holdMin: 100_000,
            shares: [50, 30, 20],
            writes: 'server',
            scoreWrites: 'server',
            apiVersion: 1,
            paysRewards: false,
            dayEndsAt: DAY_ENDS_AT * 1000,
        })
        expect(config.boards.map((board) => [board.key, board.sort, board.periods])).toEqual([
            ['main', 'desc', ['daily', 'all']],
        ])
        expect(await game.boards()).toEqual(config.boards)
        expect(game.isTest).toBe(false)
    })

    it('links a wallet, names the player and refreshes', async () => {
        const { game, api } = world()
        Object.defineProperty(globalThis, 'window', { value: { location: { host: HOST } }, configurable: true })
        try {
            expect(await game.link()).toBe(WALLET)
        } finally {
            Reflect.deleteProperty(globalThis, 'window')
        }
        expect(game.wallet.session).toBe(SESSION)
        expect(game.wallet.holds).toBe(true)
        expect(await game.wallet.setName('Ace')).toBe('Ace')
        await game.wallet.refresh()
        expect(game.wallet.name).toBe('Ace')
        expect(api.seen.map((request) => request.route)).toEqual([
            'GET /link/nonce',
            'POST /link',
            'POST /player',
            'POST /player',
        ])
    })

    it('reads the board: rows without pictures, items or times come back whole, and a past day is asked as `day`', async () => {
        const { game, api } = world()
        api.days.set(TODAY, [
            { name: 'Ace', score: 900, meta: { stars: 5 }, wallet: WALLET },
            { name: 'Guest', score: 400, meta: null, wallet: null },
        ])
        api.days.set('2026-11-20', [{ name: 'Old', score: 50, meta: null, wallet: null }])

        const today = await game.board({ name: 'guest' })
        expect(today).toMatchObject({ board: 'main', period: 'daily', key: TODAY, day: TODAY })
        expect(today.top).toEqual([
            {
                rank: 1,
                name: 'Ace',
                score: 900,
                meta: { stars: 5 },
                linked: true,
                avatar: null,
                equipped: {},
                updatedAt: 0,
            },
            { rank: 2, name: 'Guest', score: 400, meta: null, linked: false, avatar: null, equipped: {}, updatedAt: 0 },
        ])
        expect(today.you?.rank).toBe(2)

        for (const query of [{ at: '2026-11-20' }, { day: '2026-11-20' }]) {
            const past = await game.board(query)
            expect(past.day).toBe('2026-11-20')
            expect(past.top.map((row) => row.name)).toEqual(['Old'])
        }
        expect(api.seen.at(-2)?.query).toMatchObject({ day: '2026-11-20' })
    })

    it('posts a score from the page when the game lets its pages write', async () => {
        const { game } = world()
        const board = await game.submitRun({ name: 'Guest', score: 120, meta: { stars: 1 } })
        expect(board.you).toMatchObject({ rank: 1, name: 'Guest', score: 120, linked: false })
    })

    it('posts a run through the verifier when only the server writes: ticket, replay, score with the secret key', async () => {
        const { game, api } = world({ scoreWrites: 'server' })
        Object.defineProperty(globalThis, 'window', { value: { location: { host: HOST } }, configurable: true })
        try {
            await game.link()
        } finally {
            Reflect.deleteProperty(globalThis, 'window')
        }
        await game.wallet.setName('Ace')
        await expect(game.submitScore({ name: 'Ace', score: 5 })).rejects.toMatchObject({ status: 403 })

        const ticket = await game.startRun()
        const board = await game.submitRun<Awaited<ReturnType<typeof game.board>>>({
            name: 'Ace',
            score: 60,
            run: { ticket: ticket.id, inputs: [10, 20, 30] },
        })
        expect(board.you).toMatchObject({ rank: 1, name: 'Ace', score: 60, linked: true })
        expect(game.wallet.name).toBe('Ace')
        const posted = api.seen.filter((request) => request.route === 'POST /scores').at(-1)
        expect(posted?.body).toEqual({ name: 'Ace', score: 60, session: SESSION })
    })

    it('runs the prize side from the server: pot, winners, a payout and the payouts list', async () => {
        const { game, server, api } = world()
        api.days.set(TODAY, [{ name: 'Ace', score: 900, meta: null, wallet: WALLET }])

        expect(await server.setPot({ day: TODAY, eth: 1.5, usd: 4500 })).toEqual({
            day: TODAY,
            eth: 1.5,
            usd: 4500,
            endsAt: DAY_ENDS_AT * 1000,
        })
        expect(await game.pot()).toEqual({ day: TODAY, eth: 1.5, usd: 4500, endsAt: DAY_ENDS_AT * 1000 })
        const watch = game.potWatch()
        expect(typeof watch.start).toBe('function')

        const winners = {
            day: TODAY,
            winners: [{ place: 1, name: 'Ace', address: WALLET, sharePct: 50 }],
            unclaimedPct: 50,
        }
        expect(await server.winners(TODAY)).toEqual(winners)
        expect(await game.winners(TODAY)).toEqual(winners)

        const paid = await server.recordPayout({
            day: TODAY,
            place: 1,
            address: WALLET,
            amountWei: 750_000_000_000_000_000n,
            txHash: `0x${'ab'.repeat(32)}`,
        })
        expect(paid).toMatchObject({ place: 1, amountWei: '750000000000000000', at: (DAY_ENDS_AT - 60) * 1000 })
        expect((await game.payouts(5)).payouts).toEqual([paid])
        expect((await server.payouts()).payouts).toEqual([paid])
    })

    it("says so, with the API's 404, for what the old API does not have", async () => {
        const { game, server } = world()
        await expect(game.items.catalog()).rejects.toMatchObject({ status: 404 })
        await expect(game.players(['Ace'])).rejects.toMatchObject({ status: 404 })
        await expect(server.settings()).rejects.toMatchObject({ status: 404 })
        await expect(server.configure({ title: 'New' })).rejects.toMatchObject({ status: 404 })
    })
})
