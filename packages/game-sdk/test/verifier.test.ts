import { describe, expect, it, vi } from 'vitest'
import { fastestTime } from '../src/boards.js'
import { seededRandom } from '../src/random.js'
import { GameError } from '../src/errors.js'
import {
    createVerifier,
    memoryTicketStore,
    type ServerClient,
    type StoredTicket,
    type TicketStore,
} from '../src/server.js'
import { createTestGame, TEST_ADDRESS } from '../src/testing.js'
import { NOON, OTHER_ADDRESS, setup } from './kit.js'

const VERIFY_URL = 'http://localhost/verify'
/** A tiny deterministic game: the seed deals three numbers, the score is the ones the player picked. */
const replay = (seed: string, inputs: number[]) => {
    const next = seededRandom(seed)
    const deal = [next(), next(), next()].map((value) => Math.floor(value * 100))
    if (!Array.isArray(inputs) || inputs.some((index) => deal[index] === undefined)) throw new Error('bad pick')
    return inputs.reduce((sum, index) => sum + (deal[index] ?? 0), 0)
}
const refusal = (status: number, apiCode: string) => ({ code: 'http', status, apiCode })

function world(
    options: Partial<Parameters<typeof createVerifier<number[]>>[0]> = {},
    wrap: (server: ServerClient) => ServerClient = (server) => server
) {
    const base = setup({ writes: 'server', boards: [fastestTime('lap')] })
    const verifier = createVerifier<number[]>({
        server: wrap(base.server),
        replay,
        now: () => base.clock.now,
        ...options,
    })
    const fetch: typeof base.api.fetch = (url, init) =>
        url === VERIFY_URL ? verifier.handle(new Request(url, init)) : base.api.fetch(url, init)
    const player = async (name: string, address?: string) => {
        const game = base.page(address, { verifyUrl: VERIFY_URL, fetch })
        await game.link()
        await game.player.setName(name)
        return game
    }
    return { ...base, verifier, fetch, player }
}

describe('createVerifier', () => {
    it('hands out a ticket, replays the run and posts the score', async () => {
        const { player, clock } = world()
        const game = await player('ACE')
        const ticket = await game.startRun()
        expect(ticket).toEqual({
            id: expect.stringMatching(/^[0-9a-f]{32}$/),
            seed: expect.stringMatching(/^[0-9a-f]{32}$/),
            expiresAt: clock.now + 30 * 60 * 1000,
        })
        const score = replay(ticket.seed, [0, 2])
        const board = await game.submitRun({ name: 'ACE', score, run: { ticket: ticket.id, inputs: [0, 2] } })
        expect(board).toMatchObject({ board: 'main', you: { name: 'ACE', score, linked: true } })
    })

    it('spends a ticket on first use', async () => {
        const { player } = world()
        const game = await player('ACE')
        const ticket = await game.startRun()
        const run = { name: 'ACE', score: replay(ticket.seed, [1]), run: { ticket: ticket.id, inputs: [1] } }
        await game.submitRun(run)
        await expect(game.submitRun(run)).rejects.toMatchObject(refusal(409, 'ticket_spent'))
    })

    it('refuses a late run, an unknown ticket and a run with no ticket', async () => {
        const { player, clock } = world({ ticketSeconds: 60 })
        const game = await player('ACE')
        const ticket = await game.startRun()
        clock.now += 61_000
        await expect(
            game.submitRun({ name: 'ACE', score: 1, run: { ticket: ticket.id, inputs: [1] } })
        ).rejects.toMatchObject(refusal(409, 'ticket_spent'))
        await expect(
            game.submitRun({ name: 'ACE', score: 1, run: { ticket: 'f'.repeat(32), inputs: [1] } })
        ).rejects.toMatchObject(refusal(409, 'ticket_spent'))
        await expect(game.submitRun({ name: 'ACE', score: 1, run: { inputs: [1] } })).rejects.toMatchObject(
            refusal(400, 'bad_ticket')
        )
    })

    it("refuses another player's ticket, and spends it", async () => {
        const { player } = world()
        const ace = await player('ACE')
        const bee = await player('BEE', OTHER_ADDRESS)
        const ticket = await ace.startRun()
        const run = { score: replay(ticket.seed, [0]), run: { ticket: ticket.id, inputs: [0] } }
        await expect(bee.submitRun({ name: 'BEE', ...run })).rejects.toMatchObject(refusal(403, 'ticket_owner'))
        await expect(ace.submitRun({ name: 'ACE', ...run })).rejects.toMatchObject(refusal(409, 'ticket_spent'))
    })

    it('refuses a score the replay does not give, and inputs the game rejects', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const { player } = world()
        const game = await player('ACE')
        const first = await game.startRun()
        await expect(
            game.submitRun({ name: 'ACE', score: 999_999, run: { ticket: first.id, inputs: [0] } })
        ).rejects.toMatchObject(refusal(400, 'score_mismatch'))
        const second = await game.startRun()
        await expect(
            game.submitRun({ name: 'ACE', score: 1, run: { ticket: second.id, inputs: [7] } })
        ).rejects.toMatchObject(refusal(400, 'run_rejected'))
        expect(errors).toHaveBeenCalled()
        errors.mockRestore()
    })

    it('needs a linked wallet unless told otherwise, and can ask for a holder', async () => {
        const open = world()
        const guest = open.page(TEST_ADDRESS, { verifyUrl: VERIFY_URL, fetch: open.fetch })
        await expect(guest.startRun()).rejects.toMatchObject(refusal(401, 'link_required'))

        const anyone = world({ requireLink: false })
        const visitor = anyone.page(TEST_ADDRESS, { verifyUrl: VERIFY_URL, fetch: anyone.fetch })
        const ticket = await visitor.startRun()
        const score = replay(ticket.seed, [2])
        expect(
            await visitor.submitRun({ name: 'GUEST', score, run: { ticket: ticket.id, inputs: [2] } })
        ).toMatchObject({ you: { name: 'GUEST', linked: false } })

        const base = setup({ writes: 'server', holds: false })
        const strict = createVerifier<number[]>({ server: base.server, replay, requireHolder: true })
        const game = base.page()
        await game.link()
        await expect(strict.issue(game.wallet.session)).rejects.toMatchObject(refusal(403, 'holder_required'))
        await expect(strict.issue('not-a-session')).rejects.toMatchObject({ code: 'http', status: 401 })
    })

    it('posts to the board the server chose, whatever the page says', async () => {
        const { player } = world({ board: 'lap' })
        const game = await player('ACE')
        const ticket = await game.startRun()
        const score = replay(ticket.seed, [0])
        const board = await game.submitRun({
            name: 'ACE',
            score,
            board: 'main',
            run: { ticket: ticket.id, inputs: [0] },
        })
        expect(board).toMatchObject({ board: 'lap' })
    })

    it('gives the ticket back when only the score write failed', async () => {
        let isDown = true
        const { player, verifier } = world({}, (server) => ({
            ...server,
            submitScore: async (score) => {
                if (!isDown) return server.submitScore(score)
                isDown = false
                throw new GameError('http', 'The API is down', 503)
            },
        }))
        const ace = await player('ACE')
        const bee = await player('BEE', OTHER_ADDRESS)
        const ticket = await bee.startRun()
        const run = {
            ticket: ticket.id,
            inputs: [0],
            session: bee.wallet.session,
            claimed: { score: replay(ticket.seed, [0]) },
        }
        // the API is down for the first write
        await expect(verifier.verify({ ...run, name: 'BEE' })).rejects.toMatchObject({ status: 503 })
        expect(await verifier.verify({ ...run, name: 'BEE' })).toMatchObject({ you: { name: 'BEE' } })
        expect(ace.wallet.session).not.toBe(bee.wallet.session)
    })

    it('stores a hash of the session, never the session', async () => {
        const kept: StoredTicket[] = []
        const inner = memoryTicketStore()
        const store: TicketStore = {
            put: (ticket) => {
                kept.push(ticket)
                return inner.put(ticket)
            },
            take: (id) => inner.take(id),
        }
        const { player } = world({ store })
        const game = await player('ACE')
        await game.startRun()
        expect(kept[0]?.owner).toMatch(/^[0-9a-f]{64}$/)
        expect(JSON.stringify(kept)).not.toContain(game.wallet.session ?? 'none')
    })

    it('answers plain web requests: methods, bad bodies, size and CORS', async () => {
        const { verifier } = world({ origins: ['https://game.example'] })
        const post = (body: string, headers: Record<string, string> = {}) =>
            verifier.handle(new Request(VERIFY_URL, { method: 'POST', body, headers }))
        expect((await verifier.handle(new Request(VERIFY_URL))).status).toBe(405)
        expect((await post('not json')).status).toBe(400)
        expect((await post('[1]')).status).toBe(400)
        expect((await post(JSON.stringify({ type: 'ticket', session: 5 }))).status).toBe(400)
        expect((await post(JSON.stringify({ pad: 'x'.repeat(70_000) }))).status).toBe(413)
        const refused = await post(JSON.stringify({ type: 'ticket' }), { Origin: 'https://game.example' })
        expect(refused.status).toBe(401)
        expect(await refused.json()).toMatchObject({ code: 'link_required' })
        expect(refused.headers.get('Access-Control-Allow-Origin')).toBe('https://game.example')
        const stranger = await post(JSON.stringify({ type: 'ticket' }), { Origin: 'https://evil.example' })
        expect(stranger.headers.get('Access-Control-Allow-Origin')).toBeNull()
        const preflight = await verifier.handle(
            new Request(VERIFY_URL, { method: 'OPTIONS', headers: { Origin: 'https://game.example' } })
        )
        expect(preflight.status).toBe(204)
        expect(preflight.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
    })

    it('refuses bad options', () => {
        const { server } = setup()
        expect(() => createVerifier({ server, replay: undefined as never })).toThrow(/replay/)
        expect(() => createVerifier({ server, replay, ticketSeconds: 0 })).toThrow(/ticketSeconds/)
        expect(() => createVerifier({ server, replay, board: 'Bad Key' })).toThrow()
        expect(() => createVerifier({ server, replay, requireLink: false, requireHolder: true })).toThrow(/requireLink/)
        expect(() => createVerifier({ server, replay, origins: ['http://game.example'] })).toThrow(/https/)
    })
})

describe('memoryTicketStore', () => {
    it('hands a ticket out once', async () => {
        const store = memoryTicketStore(() => NOON)
        await store.put({ id: 'a', seed: 's', owner: null, expiresAt: NOON + 1000 })
        expect(await store.take('a')).toMatchObject({ seed: 's' })
        expect(await store.take('a')).toBeNull()
    })
})

describe('createTestGame with a replay function', () => {
    it('runs the whole anti-cheat flow offline', async () => {
        const game = createTestGame<number[]>({ replay })
        expect((await game.config()).writes).toBe('server')
        await game.link()
        const ticket = await game.startRun()
        const score = replay(ticket.seed, [0, 1])
        const board = await game.submitRun({ name: 'ACE', score, run: { ticket: ticket.id, inputs: [0, 1] } })
        expect(board.you).toMatchObject({ name: 'ACE', score })
        await expect(game.submitScore({ name: 'ACE', score: 1 })).rejects.toMatchObject(
            refusal(403, 'server_writes_only')
        )
    })
})
