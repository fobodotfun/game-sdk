import { describe, expect, it } from 'vitest'
import { fastestTime, highScore } from '../src/boards.js'
import { createServerClient, shareOfPot } from '../src/server.js'
import { TEST_ADDRESS, TEST_PUBLIC_KEY, TEST_SECRET_KEY } from '../src/testing.js'
import { recordingFetch } from './helpers.js'
import { DAY, OTHER_ADDRESS, setup } from './kit.js'

const refusal = (status: number, apiCode: string | null) => ({ code: 'http', status, apiCode })
const SKIN = { key: 'gold-ship', name: 'Gold ship', kind: 'skin', slot: 'skin' }
const POTION = { key: 'potion', name: 'Potion', kind: 'item', isStackable: true }

describe('server.configure', () => {
    it('sets the game up in one call, and is safe to repeat', async () => {
        const { server, page } = setup()
        const setup1 = {
            title: 'Moon Lander',
            holdMin: 250_000,
            prizeShares: [70, 30],
            writes: 'server' as const,
            boards: [highScore('main', { isPrize: true }), fastestTime('lap')],
            items: [SKIN],
        }
        const settings = await server.configure(setup1)
        expect(settings).toMatchObject({
            title: 'Moon Lander',
            holdMin: 250_000,
            shares: [70, 30],
            writes: 'server',
            paysRewards: false,
            walletLink: true,
        })
        expect(settings.boards.map((board) => board.key)).toEqual(['main', 'lap'])
        expect(settings.items.map((item) => item.key)).toEqual(['gold-ship'])
        expect(await server.configure(setup1)).toEqual(settings)
        expect(await server.settings()).toEqual(settings)
        expect(await page().config()).toMatchObject({
            title: 'Moon Lander',
            holdMin: 250_000,
            shares: [70, 30],
            writes: 'server',
        })
    })

    it('changes only what is passed', async () => {
        const { server } = setup({ items: [SKIN] })
        const before = await server.settings()
        const after = await server.configure({ holdMin: '0' })
        expect(after).toEqual({ ...before, holdMin: 0 })
        expect(await server.configure()).toEqual(after)
    })

    it('sends nothing when any part is wrong', async () => {
        const { fetch, requests } = recordingFetch(() => ({ body: {} }))
        const server = createServerClient({ apiKey: TEST_PUBLIC_KEY, secretKey: TEST_SECRET_KEY, fetch })
        const input = { code: 'input', status: 0 }
        await expect(server.configure({ title: 'ok', prizeShares: [50, 40] })).rejects.toMatchObject(input)
        await expect(server.configure({ title: 'ok', boards: [highScore('Bad')] })).rejects.toMatchObject(input)
        await expect(server.configure({ title: 'ok', items: [{ ...SKIN, key: 'Bad Key' }] })).rejects.toMatchObject(
            input
        )
        await expect(server.configure({ writes: 'page' as 'client' })).rejects.toMatchObject(input)
        expect(requests).toEqual([])
    })

    it('calls only the routes it needs', async () => {
        const { fetch, requests } = recordingFetch(() => ({ body: { title: 'T', holdMin: '5', shares: [100] } }))
        const server = createServerClient({ apiKey: TEST_PUBLIC_KEY, secretKey: TEST_SECRET_KEY, fetch })
        expect(await server.configure({ title: 'T' })).toMatchObject({
            holdMin: 5,
            boards: [expect.anything()],
            items: [],
        })
        expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
            'PUT /api/games/v1/game',
            'GET /api/games/v1/game',
        ])
        expect(requests[0]?.body).toEqual({ title: 'T' })
    })

    it('is behind the secret key', async () => {
        const { api } = setup()
        const headers = { 'X-Fobo-Game-Key': TEST_PUBLIC_KEY }
        expect((await api.handle({ method: 'GET', path: '/game', headers })).status).toBe(401)
        expect((await api.handle({ method: 'PUT', path: '/game', headers, body: { title: 'x' } })).status).toBe(401)
        expect((await api.handle({ method: 'PUT', path: '/boards', headers, body: { boards: [] } })).status).toBe(401)
        expect((await api.handle({ method: 'PUT', path: '/items', headers, body: { items: [] } })).status).toBe(401)
        expect((await api.handle({ method: 'DELETE', path: '/items/x', headers })).status).toBe(401)
    })
})

describe('the server client: boards, items and saved data', () => {
    it('defines boards: main always stays, a hidden board keeps its rows', async () => {
        const { server, page } = setup()
        const game = page()
        expect((await server.defineBoards([fastestTime('lap')])).map((board) => board.key)).toEqual(['main', 'lap'])
        await game.submitScore({ name: 'ACE', score: 900, board: 'lap' })
        expect((await server.defineBoards([highScore('main')])).map((board) => board.key)).toEqual(['main'])
        await expect(game.board({ board: 'lap' })).rejects.toMatchObject(refusal(400, 'unknown_board'))
        await server.defineBoards([fastestTime('lap')])
        expect((await game.board({ board: 'lap' })).top.map((row) => row.name)).toEqual(['ACE'])
    })

    it('posts a checked score to a board', async () => {
        const { server } = setup({ writes: 'server', boards: [fastestTime('lap')] })
        const board = await server.submitScore({ name: 'ACE', score: 1234, board: 'lap' })
        expect(board).toMatchObject({ board: 'lap', you: { rank: 1, score: 1234 } })
    })

    it('judges winners on the prize board', async () => {
        const { server, linked } = setup({
            boards: [highScore('main', { isPrize: false }), fastestTime('lap', { isPrize: true })],
        })
        const ace = await linked('ACE')
        const bee = await linked('BEE', OTHER_ADDRESS)
        await ace.submitScore({ name: 'ACE', score: 900, board: 'lap' })
        await bee.submitScore({ name: 'BEE', score: 800, board: 'lap' })
        await ace.submitScore({ name: 'ACE', score: 5 })
        const { winners } = await server.winners(DAY)
        expect(winners.map((winner) => [winner.place, winner.name])).toEqual([
            [1, 'BEE'],
            [2, 'ACE'],
        ])
        expect(winners[1]?.address).toBe(TEST_ADDRESS)
        expect(shareOfPot(1000n, winners[0]?.sharePct ?? 0)).toBe(600n)
    })

    it('defines, updates and removes items', async () => {
        const { server, linked } = setup()
        const game = await linked('ACE')
        expect((await server.defineItems([SKIN, POTION])).map((item) => item.key)).toEqual(['gold-ship', 'potion'])
        expect((await server.defineItems([{ ...SKIN, name: 'Golden ship' }]))[0]).toMatchObject({ name: 'Golden ship' })
        await server.grantItem('ACE', 'gold-ship')
        await game.items.equip('skin', 'gold-ship')
        expect((await server.removeItem('gold-ship')).map((item) => item.key)).toEqual(['potion'])
        expect(await server.playerItems('ACE')).toEqual([])
        expect((await game.player.get()).equipped).toEqual({})
        await expect(server.removeItem('gold-ship')).rejects.toMatchObject(refusal(404, 'unknown_item'))
    })

    it('grants and consumes for a player by name', async () => {
        const { server, linked } = setup({ items: [POTION], writes: 'server' })
        await linked('ACE')
        expect(await server.grantItem('ACE', 'potion', { qty: 3 })).toMatchObject({ key: 'potion', qty: 3 })
        expect(await server.consumeItem('ACE', 'potion', 2)).toMatchObject({ qty: 1 })
        expect(await server.consumeItem('ACE', 'potion')).toBeNull()
        await expect(server.consumeItem('ACE', 'potion')).rejects.toMatchObject(refusal(409, 'not_enough'))
        await expect(server.grantItem('NOBODY', 'potion')).rejects.toMatchObject(refusal(404, 'unknown_player'))
    })

    it('reads and writes saved data by name', async () => {
        const { server, linked } = setup()
        const game = await linked('ACE')
        await game.save.set({ sound: false })
        expect(await server.setPlayerData('ACE', { coins: 40 })).toEqual({ sound: false, coins: 40 })
        expect(await server.getPlayerData('ACE', ['coins'])).toEqual({ coins: 40 })
        expect(await server.removePlayerData('ACE', ['sound'])).toEqual({ coins: 40 })
        expect(await game.save.get()).toEqual({ coins: 40 })
    })
})
