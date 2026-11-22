import { describe, expect, it } from 'vitest'
import { fastestTime, highScore, rating, total } from '../src/boards.js'
import { GameError } from '../src/errors.js'
import { createGame } from '../src/index.js'
import { SDK_HEADER, SESSION_HEADER } from '../src/protocol.js'
import { TEST_ADDRESS, TEST_PUBLIC_KEY } from '../src/testing.js'
import { SDK_AGENT, SDK_VERSION } from '../src/version.js'
import pkg from '../package.json' with { type: 'json' }
import { recordingFetch } from './helpers.js'
import { DAY, NOON, OTHER_ADDRESS, setup } from './kit.js'

const HOUR = 3_600_000
const ITEMS = [
    { key: 'gold-ship', name: 'Gold ship', kind: 'skin', slot: 'skin' },
    { key: 'red-ship', name: 'Red ship', kind: 'skin', slot: 'skin' },
    { key: 'potion', name: 'Potion', kind: 'item', isStackable: true, maxQty: 3 },
    { key: 'badge', name: 'Badge', kind: 'badge' },
]
/** What a refused call rejects with. */
const refusal = (status: number, apiCode: string | null) => ({ code: 'http', status, apiCode })

describe('every request', () => {
    it('names the SDK and its version, read from package.json', async () => {
        expect(SDK_VERSION).toBe(pkg.version)
        expect(SDK_AGENT).toBe(`${pkg.name}/${pkg.version}`)
        const { fetch, requests } = recordingFetch(() => ({ body: { boards: [], dayEndsAt: 0 } }))
        await createGame({ apiKey: TEST_PUBLIC_KEY, fetch }).config()
        expect(requests[0]?.headers[SDK_HEADER.toLowerCase()]).toBe(SDK_AGENT)
    })

    it('carries the API code of a refusal', async () => {
        const { fetch } = recordingFetch(() => ({ status: 409, body: { error: 'Owned', code: 'already_owned' } }))
        const game = createGame({ apiKey: TEST_PUBLIC_KEY, fetch })
        const failure = await game.items.catalog().then(
            () => null,
            (err: unknown) => err
        )
        expect(failure).toBeInstanceOf(GameError)
        expect(failure).toMatchObject({ ...refusal(409, 'already_owned'), message: 'Owned' })
    })

    it('only speaks API version 1', () => {
        expect(() => createGame({ apiKey: TEST_PUBLIC_KEY, apiVersion: 1 })).not.toThrow()
        expect(() => createGame({ apiKey: TEST_PUBLIC_KEY, apiVersion: 2 as 1 })).toThrow(/version/)
    })
})

describe('leaderboards', () => {
    it('starts with the main board and reads the config', async () => {
        const { page } = setup()
        const game = page()
        expect(await game.boards()).toEqual([expect.objectContaining({ key: 'main', isPrize: true })])
        expect(await game.config()).toMatchObject({
            writes: 'client',
            scoreWrites: 'client',
            apiVersion: 1,
            paysRewards: false,
        })
        expect(await game.board()).toMatchObject({ board: 'main', period: 'daily', key: DAY, day: DAY, top: [] })
    })

    it('keeps the best score, lowest first on an asc board', async () => {
        const { page } = setup({ boards: [fastestTime('lap')] })
        const game = page()
        await game.submitScore({ name: 'ACE', score: 9000, board: 'lap', meta: { car: 'red' } })
        await game.submitScore({ name: 'BEE', score: 8000, board: 'lap' })
        await game.submitScore({ name: 'ACE', score: 9500, board: 'lap' })
        const board = await game.submitScore({ name: 'ACE', score: 7000, board: 'lap' })
        expect(board.top.map((row) => [row.rank, row.name, row.score])).toEqual([
            [1, 'ACE', 7000],
            [2, 'BEE', 8000],
        ])
        expect(board.you).toMatchObject({
            rank: 1,
            name: 'ACE',
            linked: false,
            avatar: expect.stringMatching(/^data:image\/svg\+xml/),
            equipped: {},
            updatedAt: NOON,
        })
        // main was not touched
        expect((await game.board()).top).toEqual([])
    })

    it('adds up on a sum board and keeps the last on a latest board', async () => {
        const { page } = setup({ boards: [total('coins'), rating('elo')] })
        const game = page()
        await game.submitScore({ name: 'ACE', score: 5, board: 'coins' })
        expect((await game.submitScore({ name: 'ACE', score: 7, board: 'coins' })).you?.score).toBe(12)
        await expect(game.submitScore({ name: 'ACE', score: 0, board: 'coins' })).rejects.toMatchObject(
            refusal(400, null)
        )
        await game.submitScore({ name: 'ACE', score: 1500, board: 'elo' })
        expect((await game.submitScore({ name: 'ACE', score: 1400, board: 'elo' })).you?.score).toBe(1400)
    })

    it('ranks the first to reach a score above a later tie', async () => {
        const { page } = setup()
        const game = page()
        await game.submitScore({ name: 'ACE', score: 10 })
        await game.submitScore({ name: 'BEE', score: 10 })
        expect((await game.board()).top.map((row) => row.name)).toEqual(['ACE', 'BEE'])
    })

    it('keeps one ranking per period', async () => {
        const board = highScore('main', { periods: ['daily', 'weekly', 'monthly', 'all'] })
        const { page, clock } = setup({ boards: [board] })
        const game = page()
        await game.submitScore({ name: 'ACE', score: 10 })
        clock.now = NOON + 24 * HOUR
        await game.submitScore({ name: 'ACE', score: 5 })
        expect((await game.board({ period: 'daily' })).you ?? null).toBeNull()
        expect((await game.board({ period: 'daily', name: 'ACE' })).you?.score).toBe(5)
        expect((await game.board({ period: 'daily', at: DAY, name: 'ACE' })).you?.score).toBe(10)
        expect(await game.board({ period: 'weekly', name: 'ACE' })).toMatchObject({
            key: '2026-W01',
            you: { score: 10 },
        })
        expect(await game.board({ period: 'monthly', name: 'ACE' })).toMatchObject({
            key: '2026-01',
            you: { score: 10 },
        })
        expect(await game.board({ period: 'all', name: 'ACE' })).toMatchObject({ key: 'all', you: { score: 10 } })
        clock.now = NOON + 5 * 24 * HOUR
        expect((await game.board({ period: 'weekly', name: 'ACE' })).you).toBeNull()
    })

    it('limits the rows and refuses what the contract refuses', async () => {
        const { page } = setup({ boards: [fastestTime('lap', { periods: ['all'] })] })
        const game = page()
        for (const [index, name] of ['A1', 'A2', 'A3'].entries()) await game.submitScore({ name, score: index + 1 })
        expect((await game.board({ limit: 2 })).top).toHaveLength(2)
        await expect(game.board({ board: 'nope' })).rejects.toMatchObject(refusal(400, 'unknown_board'))
        await expect(game.board({ board: 'lap', period: 'daily' })).rejects.toMatchObject(
            refusal(400, 'unknown_period')
        )
        await expect(game.submitScore({ name: 'ACE', score: 1, board: 'nope' })).rejects.toMatchObject(
            refusal(400, 'unknown_board')
        )
        // a board with no daily ranking answers with its first period
        expect(await game.submitScore({ name: 'ACE', score: 1, board: 'lap' })).toMatchObject({
            period: 'all',
            key: 'all',
        })
    })

    it('checks input before any request', async () => {
        const { fetch, requests } = recordingFetch(() => ({ body: {} }))
        const game = createGame({ apiKey: TEST_PUBLIC_KEY, fetch })
        const input = { code: 'input', status: 0 }
        await expect(game.board({ limit: 101 })).rejects.toMatchObject(input)
        await expect(game.board({ board: 'Bad Key' })).rejects.toMatchObject(input)
        await expect(game.board({ period: 'yearly' as 'all' })).rejects.toMatchObject(input)
        await expect(game.board({ at: 'today' })).rejects.toMatchObject(input)
        await expect(game.submitScore({ name: 'ACE', score: 1.5 })).rejects.toMatchObject(input)
        await expect(game.submitScore({ name: 'ACE', score: 1, meta: { x: 'x'.repeat(600) } })).rejects.toMatchObject(
            input
        )
        await expect(game.players(Array.from({ length: 51 }, (_, i) => `P${i}`))).rejects.toMatchObject(input)
        await expect(game.save.set({ 'bad key': 1 })).rejects.toMatchObject(input)
        await expect(game.items.grant('Bad Key')).rejects.toMatchObject(input)
        await expect(game.items.consume('potion', 0)).rejects.toMatchObject(input)
        expect(requests).toEqual([])
    })
})

describe('players', () => {
    it('reads the profile, renames, and shows on boards', async () => {
        const { page } = setup()
        const game = page()
        await expect(game.player.get()).rejects.toMatchObject({ code: 'wallet' })
        await game.link()
        expect(await game.player.get()).toMatchObject({
            name: null,
            avatarSource: 'generated',
            isHolder: true,
            equipped: {},
            createdAt: NOON,
        })
        expect(await game.player.setName('ACE')).toMatchObject({ name: 'ACE' })
        const board = await game.submitScore({ name: 'ACE', score: 3 })
        expect(board.you).toMatchObject({ linked: true, avatar: expect.stringMatching(/^data:image/) })
    })

    it('uploads and removes a picture', async () => {
        const { linked } = setup()
        const game = await linked('ACE')
        const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })
        expect(await game.player.setAvatar(png)).toMatchObject({
            avatarSource: 'game',
            avatar: expect.stringMatching(/^data:image\/png;base64,/),
        })
        expect(await game.player.removeAvatar()).toMatchObject({ avatarSource: 'generated' })
        const input = { code: 'input', status: 0 }
        await expect(game.player.setAvatar(new Blob(['<svg/>'], { type: 'image/svg+xml' }))).rejects.toMatchObject(
            input
        )
        const huge = new Blob([new Uint8Array(1024 * 1024 + 1)], { type: 'image/png' })
        await expect(game.player.setAvatar(huge)).rejects.toMatchObject({ ...input, apiCode: 'too_large' })
    })

    it('looks players up by name, with a made-up face for a name nobody has', async () => {
        const { linked, page } = setup()
        await linked('ACE')
        await linked('BEE', OTHER_ADDRESS)
        const found = await page().players(['bee', 'NOBODY', 'ACE'])
        expect(found.map((player) => player.name)).toEqual(['BEE', 'NOBODY', 'ACE'])
        expect(found[1]).toMatchObject({ avatar: expect.any(String), equipped: {} })
        expect(found[0]).toMatchObject({ avatar: expect.any(String), equipped: {} })
    })
})

describe('saved data', () => {
    it('sets, reads and removes keys, per player', async () => {
        const { linked } = setup()
        const ace = await linked('ACE')
        const bee = await linked('BEE', OTHER_ADDRESS)
        expect(await ace.save.get()).toEqual({})
        expect(await ace.save.set({ progress: { level: 3 }, sound: false })).toEqual({
            progress: { level: 3 },
            sound: false,
        })
        expect(await ace.save.get(['sound'])).toEqual({ sound: false })
        expect(await ace.save.remove(['sound'])).toEqual({ progress: { level: 3 } })
        expect(await bee.save.get()).toEqual({})
    })

    it('needs a linked wallet', async () => {
        const { page } = setup()
        await expect(page().save.get()).rejects.toMatchObject({ code: 'wallet' })
    })

    it('answers too_large past 64 KB in all, and changes nothing', async () => {
        const { linked } = setup()
        const game = await linked('ACE')
        const chunk = 'x'.repeat(15_000)
        await game.save.set({ a: chunk, b: chunk, c: chunk, d: chunk })
        await expect(game.save.set({ e: chunk })).rejects.toMatchObject(refusal(413, 'too_large'))
        expect(Object.keys(await game.save.get())).toEqual(['a', 'b', 'c', 'd'])
    })
})

describe('items', () => {
    it('grants, stacks, consumes and equips', async () => {
        const { linked } = setup({ items: ITEMS })
        const game = await linked('ACE')
        expect((await game.items.catalog()).map((item) => [item.key, item.isStackable])).toEqual([
            ['gold-ship', false],
            ['red-ship', false],
            ['potion', true],
            ['badge', false],
        ])
        expect(await game.items.grant('gold-ship', { meta: { paint: 'matte' } })).toEqual({
            key: 'gold-ship',
            qty: 1,
            meta: { paint: 'matte' },
            acquiredAt: NOON,
        })
        await expect(game.items.grant('gold-ship')).rejects.toMatchObject(refusal(409, 'already_owned'))
        await expect(game.items.grant('nope')).rejects.toMatchObject(refusal(404, 'unknown_item'))
        expect(await game.items.grant('potion', { qty: 2 })).toMatchObject({ qty: 2 })
        await expect(game.items.grant('potion', { qty: 2 })).rejects.toMatchObject(refusal(409, 'over_max'))
        expect(await game.items.consume('potion')).toMatchObject({ qty: 1 })
        await expect(game.items.consume('potion', 2)).rejects.toMatchObject(refusal(409, 'not_enough'))
        expect(await game.items.consume('potion')).toBeNull()
        expect((await game.items.mine()).map((item) => item.key)).toEqual(['gold-ship'])

        expect(await game.items.equip('skin', 'gold-ship')).toMatchObject({ equipped: { skin: 'gold-ship' } })
        await expect(game.items.equip('skin', 'red-ship')).rejects.toMatchObject(refusal(409, 'not_enough'))
        await expect(game.items.equip('hat', 'gold-ship')).rejects.toMatchObject(refusal(400, 'wrong_slot'))
        expect((await game.submitScore({ name: 'ACE', score: 1 })).you?.equipped).toEqual({ skin: 'gold-ship' })
        // the last one used up comes off too
        expect(await game.items.consume('gold-ship')).toBeNull()
        expect((await game.player.get()).equipped).toEqual({})
    })

    it('unequips with null', async () => {
        const { linked } = setup({ items: ITEMS })
        const game = await linked('ACE')
        await game.items.grant('gold-ship')
        await game.items.equip('skin', 'gold-ship')
        expect(await game.items.equip('skin', null)).toMatchObject({ equipped: {} })
    })

    it('are written only by the server when the game says so', async () => {
        const { linked, server } = setup({ items: ITEMS, writes: 'server' })
        const game = await linked('ACE')
        await expect(game.items.grant('badge')).rejects.toMatchObject(refusal(403, 'server_writes_only'))
        await expect(game.items.consume('badge')).rejects.toMatchObject(refusal(403, 'server_writes_only'))
        await expect(game.submitScore({ name: 'ACE', score: 1 })).rejects.toMatchObject(
            refusal(403, 'server_writes_only')
        )
        await server.grantItem('ACE', 'gold-ship')
        // reading and equipping stay with the player
        expect((await game.items.mine()).map((item) => item.key)).toEqual(['gold-ship'])
        expect(await game.items.equip('skin', 'gold-ship')).toMatchObject({ equipped: { skin: 'gold-ship' } })
    })

    it('send the session in a header, never in the URL', async () => {
        const { api, page } = setup({ items: ITEMS })
        const seen: { url: string; session: string | null }[] = []
        const game = page(TEST_ADDRESS, {
            fetch: (url, init) => {
                seen.push({ url, session: new Headers(init?.headers).get(SESSION_HEADER) })
                return api.fetch(url, init)
            },
        })
        await game.link()
        await game.items.mine()
        const last = seen.at(-1)
        expect(last?.session).toBe(game.wallet.session)
        expect(last?.url).not.toContain(game.wallet.session ?? 'none')
    })
})
