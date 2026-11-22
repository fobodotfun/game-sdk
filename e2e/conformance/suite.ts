/**
 * The Game API v1 contract (docs/api-v1.md) as assertions, driven through the built SDK: the page's client and the
 * server's. The same suite runs against the SDK's mock API and against a real fobo.fun, so the two are shown to
 * behave the same.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fastestTime, GameError, highScore, rating, total, type BoardDefinition } from '@fobo/game-sdk'
import { linkMessage } from '@fobo/game-sdk/protocol'
import type { ItemInput } from '@fobo/game-sdk/server'
import {
    createPlayer,
    createServer,
    FOREIGN_ORIGIN,
    pngSquare,
    raw,
    type RawAnswer,
    type RawOptions,
    type Target,
} from './target.ts'

const KB = 1024
const SHORT_ADDRESS = /^0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}$/
const FULL_ADDRESS = /^0x[0-9a-f]{40}$/
const IMAGE_TYPE = /^image\/(png|webp|svg\+xml)/
const IMAGE_DATA_URL = /^data:image\/(png|webp|svg\+xml)[;,]/
const PAST_DAY = '2020-01-01'

const today = (): string => new Date().toISOString().slice(0, 10)
const lower = (text: string): string => text.toLowerCase()

/** The call must fail with this HTTP status and this API code (null: an error with no code). */
async function fails(call: Promise<unknown>, status: number, apiCode: string | null = null): Promise<void> {
    let thrown: unknown = null
    try {
        await call
    } catch (err) {
        thrown = err
    }
    if (!(thrown instanceof GameError)) assert.fail(`expected a GameError with status ${status}, got ${String(thrown)}`)
    assert.deepEqual(
        { status: thrown.status, apiCode: thrown.apiCode },
        { status, apiCode },
        `the API said: ${thrown.message}`
    )
}

/** A request the SDK would not send was refused with this status and code (undefined: no code at all). */
function refused(answer: RawAnswer, status: number, code?: string, sent?: unknown): void {
    assert.deepEqual(
        { status: answer.status, code: answer.body.code },
        { status, code },
        `the API said: ${String(answer.body.error)}${sent === undefined ? '' : ` to ${JSON.stringify(sent).slice(0, 200)}`}`
    )
    assert.equal(typeof answer.body.error, 'string')
}

/** The fields of a board that were asked for come back as they were set. */
function sameBoard(actual: BoardDefinition | undefined, expected: BoardDefinition): void {
    assert.ok(actual, `the board "${expected.key}" is missing`)
    const { key, title, sort, mode, format, periods, isPrize } = actual
    assert.deepEqual(
        { key, title, sort, mode, format, periods, isPrize },
        {
            key: expected.key,
            title: expected.title,
            sort: expected.sort,
            mode: expected.mode,
            format: expected.format,
            periods: expected.periods,
            isPrize: expected.isPrize ?? false,
        }
    )
    if (expected.decimals !== undefined) assert.equal(actual.decimals, expected.decimals)
    if (expected.unit !== undefined) assert.equal(actual.unit, expected.unit)
}

/**
 * Registers the whole contract as tests against one target.
 * @param target the mock API, or a Game Center over HTTP
 */
export function conformance(target: Target): void {
    describe(`Game API v1: ${target.name}`, () => {
        // a run of its own: the game on a real site keeps what earlier runs wrote
        const run = Math.random().toString(36).slice(2, 7).padEnd(5, '0')
        const server = createServer(target)
        const page = createPlayer(target, 'page').game
        const ace = createPlayer(target, 'ace')
        const bob = createPlayer(target, 'bob')
        const cat = createPlayer(target, 'cat')
        const names = {
            ace: `Ace-${run}`,
            aceNext: `Ace2-${run}`,
            bob: `bob-${run}`,
            cat: `cat-${run}`,
            guest: `gst-${run}`,
            nobody: `nob-${run}`,
        }
        const keys = {
            prize: `prize-${run}`,
            lap: `lap-${run}`,
            coins: `coins-${run}`,
            elo: `elo-${run}`,
            far: `far-${run}`,
            rows: `rows-${run}`,
        }
        const item = { sword: `sword-${run}`, hat: `hat-${run}`, coin: `coin-${run}`, cape: `cape-${run}` }
        const boards: BoardDefinition[] = [
            highScore(keys.prize, { title: 'Prize run', isPrize: true }),
            fastestTime(keys.lap, { periods: ['all', 'monthly', 'weekly', 'daily'] }),
            total(keys.coins, { periods: ['weekly', 'all'], unit: 'c' }),
            rating(keys.elo, { periods: ['all'] }),
            {
                key: keys.far,
                title: 'Distance',
                sort: 'desc',
                mode: 'best',
                format: 'decimal',
                decimals: 2,
                unit: 'm',
                periods: ['daily'],
            },
            highScore(keys.rows),
        ]
        const items: ItemInput[] = [
            { key: item.sword, name: 'Sword', kind: 'item' },
            {
                key: item.hat,
                name: 'Red hat',
                kind: 'clothing',
                slot: 'head',
                rarity: 'rare',
                image: 'https://example.com/hat.png',
                meta: { colour: 'red' },
            },
            { key: item.coin, name: 'Coin', kind: 'currency', isStackable: true, maxQty: 10 },
            { key: item.cape, name: 'Cape', kind: 'clothing', slot: 'back' },
        ]
        const fromPage = (method: string, path: string, options: RawOptions = {}) => raw(target, method, path, options)
        const fromServer = (method: string, path: string, options: RawOptions = {}) =>
            raw(target, method, path, { ...options, isServer: true })
        const sessionOf = (player: { game: { wallet: { session: string | null } } }): string => {
            const session = player.game.wallet.session
            assert.ok(session, 'the player is not linked')
            return session
        }

        /** A picture URL is an image a page of any site can load. */
        const loadsImage = async (url: string): Promise<void> => {
            if (!target.isHttp) return assert.match(url, IMAGE_DATA_URL)
            assert.match(url, /^https?:\/\//)
            const answer = await fetch(url, { headers: { Origin: FOREIGN_ORIGIN } })
            assert.equal(answer.status, 200, url)
            assert.match(answer.headers.get('content-type') ?? '', IMAGE_TYPE)
            assert.equal(answer.headers.get('access-control-allow-origin'), '*')
            assert.ok((await answer.arrayBuffer()).byteLength > 0)
        }

        describe('settings', () => {
            it('configure sets the title, the hold, the split, the mode, boards and items', async () => {
                const settings = await server.configure({
                    title: `Conformance ${run}`,
                    holdMin: 0,
                    prizeShares: [50, 30, 20],
                    writes: 'client',
                    boards,
                    items,
                })
                assert.equal(settings.title, `Conformance ${run}`)
                assert.equal(settings.holdMin, 0)
                assert.deepEqual(settings.shares, [50, 30, 20])
                assert.equal(settings.writes, 'client')
                assert.equal(settings.walletLink, true)
                assert.equal(settings.paysRewards, false)
                assert.deepEqual(await server.settings(), settings)
            })

            it('boards come back whole: main kept, periods in order, one prize board', async () => {
                const { boards: set } = await server.settings()
                assert.deepEqual(set.map((board) => board.key).sort(), ['main', ...Object.values(keys)].sort())
                const find = (key: string) => set.find((board) => board.key === key)
                sameBoard(find(keys.prize), { ...boards[0]!, periods: ['daily', 'all'] })
                sameBoard(find(keys.lap), { ...boards[1]!, periods: ['daily', 'weekly', 'monthly', 'all'] })
                sameBoard(find(keys.coins), boards[2]!)
                sameBoard(find(keys.elo), boards[3]!)
                sameBoard(find(keys.far), boards[4]!)
                // the prize moved to another board: main, which was not sent, gave it up
                assert.deepEqual(
                    set.filter((board) => board.isPrize === true).map((board) => board.key),
                    [keys.prize]
                )
                assert.ok(set.every((board) => typeof board.isPrize === 'boolean'))
            })

            it('items come back whole', async () => {
                const { items: set } = await server.settings()
                const find = (key: string) => set.find((entry) => entry.key === key)
                assert.deepEqual(find(item.hat), { ...items[1]!, isStackable: false })
                assert.deepEqual(find(item.coin), items[2])
                assert.equal(find(item.sword)?.isStackable, false)
                assert.deepEqual(
                    (await page.items.catalog()).filter((entry) => entry.key.endsWith(run)),
                    set.filter((entry) => entry.key.endsWith(run))
                )
            })

            it('a page reads the config', async () => {
                const config = await page.config()
                const settings = await server.settings()
                assert.equal(config.apiVersion, 1)
                assert.equal(config.title, settings.title)
                assert.equal(config.holdMin, 0)
                assert.deepEqual(config.shares, [50, 30, 20])
                assert.equal(config.writes, 'client')
                assert.equal(config.scoreWrites, 'client')
                assert.equal(config.paysRewards, false)
                assert.deepEqual(config.boards, settings.boards)
                assert.deepEqual(await page.boards(), settings.boards)
                assert.equal(typeof config.game, 'string')
                assert.match(config.tokenAddress, /^0x[0-9a-fA-F]{40}$/)
                assert.equal(typeof config.ticker, 'string')
                assert.ok(config.dayEndsAt > Date.now())
                assert.equal(config.dayEndsAt % 86_400_000, 0)
            })

            it('only what is sent changes', async () => {
                const before = await server.settings()
                const after = await server.configure({ holdMin: '0' })
                assert.deepEqual(after, before)
            })

            it('PUT /game refuses bad settings', async () => {
                const bad: Record<string, unknown>[] = [
                    { shares: [50, 30] },
                    { shares: [60, 30, 20] },
                    { shares: [100, 0] },
                    { shares: [50.5, 49.5] },
                    { shares: [] },
                    { shares: [10, 10, 10, 10, 10, 10, 10, 10, 10, 5, 5] },
                    { title: 'x'.repeat(41) },
                    { title: '' },
                    { writes: 'anyone' },
                    { holdMin: -1 },
                    { holdMin: 1.5 },
                ]
                for (const body of bad) refused(await fromServer('PUT', '/game', { body }), 400, undefined, body)
                assert.deepEqual((await server.settings()).shares, [50, 30, 20])
            })

            it('the secret key is needed where the contract says so', async () => {
                const routes: [string, string, unknown?][] = [
                    ['GET', '/game'],
                    ['PUT', '/game', { title: 'Hacked' }],
                    ['PUT', '/boards', { boards: [] }],
                    ['PUT', '/items', { items: [items[0]] }],
                    ['DELETE', `/items/${item.sword}`],
                    ['POST', '/pot', { day: today(), eth: 1, usd: 1 }],
                    ['POST', '/payouts', {}],
                ]
                for (const [method, path, body] of routes) refused(await fromPage(method, path, { body }), 401)
            })

            it('an unknown key is refused', async () => {
                refused(await fromPage('GET', '/config', { publicKey: 'pk_live_nosuchkey0000000000' }), 401)
            })
        })

        describe('boards', () => {
            it('PUT /boards refuses bad lists', async () => {
                const board = highScore('extra')
                const many = Array.from({ length: 100 }, (_, index) => highScore(`b${index}`))
                const bad: unknown[][] = [
                    // with main that makes 101
                    many,
                    [highScore('one', { isPrize: true }), highScore('two', { isPrize: true })],
                    [highScore('no-day', { isPrize: true, periods: ['all'] })],
                    [{ ...board, key: 'Bad Key' }],
                    [{ ...board, periods: [] }],
                    [{ ...board, periods: ['yearly'] }],
                    [{ ...board, sort: 'up' }],
                    [{ ...board, mode: 'first' }],
                    [{ ...board, format: 'money' }],
                    [{ ...board, format: 'decimal', decimals: 7 }],
                    [{ ...board, unit: 'x'.repeat(9) }],
                    [{ ...board, title: 'x'.repeat(41) }],
                    [board, board],
                ]
                for (const list of bad) refused(await fromServer('PUT', '/boards', { body: { boards: list } }), 400)
                refused(await fromServer('PUT', '/boards', { body: {} }), 400)
                assert.equal((await server.settings()).boards.length, boards.length + 1)
            })

            it('best: the highest score stays, with its meta and the row shape', async () => {
                const first = await page.submitScore({
                    name: names.guest,
                    score: 100,
                    board: keys.far,
                    meta: { lvl: 2 },
                })
                assert.equal(first.board, keys.far)
                assert.equal(first.period, 'daily')
                assert.equal(first.key, today())
                assert.equal(first.day, today())
                await page.submitScore({ name: names.guest, score: 50, board: keys.far, meta: { lvl: 1 } })
                assert.equal((await page.board({ board: keys.far, name: names.guest })).you?.score, 100)
                const best = await page.submitScore({
                    name: names.guest,
                    score: 150,
                    board: keys.far,
                    meta: { lvl: 3 },
                })
                const you = best.you
                assert.ok(you)
                assert.deepEqual(
                    { rank: you.rank, name: you.name, score: you.score, meta: you.meta, linked: you.linked },
                    { rank: 1, name: names.guest, score: 150, meta: { lvl: 3 }, linked: false }
                )
                assert.deepEqual(you.equipped, {})
                assert.ok(Math.abs(you.updatedAt - Date.now()) < 120_000)
                assert.ok(typeof you.avatar === 'string')
                await loadsImage(you.avatar)
                assert.deepEqual(best.top, [you])
                // the name's row is found whatever its case
                assert.deepEqual((await page.board({ board: keys.far, name: names.guest.toUpperCase() })).you, you)
            })

            it('asc: the lowest wins, and of two equal scores the first', async () => {
                await page.submitScore({ name: names.guest, score: 5000, board: keys.lap })
                await page.submitScore({ name: names.guest, score: 4000, board: keys.lap })
                await page.submitScore({ name: names.guest, score: 6000, board: keys.lap })
                await page.submitScore({ name: names.nobody, score: 4000, board: keys.lap })
                const third = await page.submitScore({ name: `z-${run}`, score: 3000, board: keys.lap })
                assert.deepEqual(
                    third.top.map((row) => [row.rank, row.name, row.score]),
                    [
                        [1, `z-${run}`, 3000],
                        [2, names.guest, 4000],
                        [3, names.nobody, 4000],
                    ]
                )
            })

            it('every period of a board has its own key', async () => {
                const day = today()
                const daily = await page.board({ board: keys.lap, period: 'daily' })
                const weekly = await page.board({ board: keys.lap, period: 'weekly' })
                const monthly = await page.board({ board: keys.lap, period: 'monthly' })
                const all = await page.board({ board: keys.lap, period: 'all' })
                assert.deepEqual([daily.period, daily.key], ['daily', day])
                assert.equal(weekly.period, 'weekly')
                assert.match(weekly.key, /^\d{4}-W\d{2}$/)
                assert.deepEqual([monthly.period, monthly.key], ['monthly', day.slice(0, 7)])
                assert.deepEqual([all.period, all.key], ['all', 'all'])
                for (const board of [daily, weekly, monthly, all]) {
                    assert.equal(board.board, keys.lap)
                    assert.equal(board.day, day)
                    assert.equal(board.top.length, 3)
                }
            })

            it('at and day pick another period', async () => {
                const past = await page.board({ board: keys.lap, at: PAST_DAY, name: names.guest })
                assert.deepEqual(
                    { key: past.key, day: past.day, top: past.top, you: past.you },
                    { key: PAST_DAY, day: PAST_DAY, top: [], you: null }
                )
                const week = await page.board({ board: keys.lap, period: 'weekly', day: PAST_DAY })
                assert.deepEqual([week.key, week.top.length], ['2020-W01', 0])
                const month = await page.board({ board: keys.lap, period: 'monthly', at: PAST_DAY })
                assert.equal(month.key, '2020-01')
                assert.equal((await page.board({ board: keys.lap, period: 'all', at: PAST_DAY })).top.length, 3)
            })

            it('sum: posts add up, and a board with no daily shows its first period', async () => {
                const first = await page.submitScore({ name: names.guest, score: 5, board: keys.coins })
                assert.equal(first.period, 'weekly')
                assert.match(first.key, /^\d{4}-W\d{2}$/)
                const second = await page.submitScore({ name: names.guest, score: 7, board: keys.coins })
                assert.equal(second.you?.score, 12)
                const shown = await page.board({ board: keys.coins, name: names.guest })
                assert.equal(shown.period, 'weekly')
                assert.equal(shown.you?.score, 12)
                assert.equal((await page.board({ board: keys.coins, period: 'all', name: names.guest })).you?.score, 12)
                await fails(page.board({ board: keys.coins, period: 'daily' }), 400, 'unknown_period')
                await fails(page.submitScore({ name: names.guest, score: 0, board: keys.coins }), 400)
                await fails(
                    page.submitScore({ name: names.guest, score: Number.MAX_SAFE_INTEGER, board: keys.coins }),
                    400
                )
                assert.equal((await page.board({ board: keys.coins, name: names.guest })).you?.score, 12)
            })

            it('latest: the last post replaces the value', async () => {
                await page.submitScore({ name: names.guest, score: 10, board: keys.elo })
                const down = await page.submitScore({ name: names.guest, score: 3, board: keys.elo, meta: { d: 1 } })
                assert.deepEqual([down.period, down.key, down.you?.score], ['all', 'all', 3])
                assert.deepEqual(down.you?.meta, { d: 1 })
                const up = await page.submitScore({ name: names.guest, score: 8, board: keys.elo })
                assert.equal(up.you?.score, 8)
                assert.equal((await page.board({ board: keys.elo })).period, 'all')
            })

            it('limit: 20 rows by default, 1 to 100, and the asked name outside the page', async () => {
                for (let index = 0; index < 22; index++)
                    await page.submitScore({ name: `r${index}-${run}`, score: 1000 - index, board: keys.rows })
                const whole = await page.board({ board: keys.rows })
                assert.equal(whole.top.length, 20)
                assert.deepEqual(
                    whole.top.map((row) => row.rank),
                    Array.from({ length: 20 }, (_, index) => index + 1)
                )
                assert.equal((await page.submitScore({ name: `r0-${run}`, score: 1, board: keys.rows })).top.length, 20)
                const short = await page.board({ board: keys.rows, limit: 2, name: `r21-${run}` })
                assert.deepEqual(
                    short.top.map((row) => row.name),
                    [`r0-${run}`, `r1-${run}`]
                )
                assert.deepEqual([short.you?.rank, short.you?.score], [22, 979])
                assert.equal((await page.board({ board: keys.rows, limit: 100 })).top.length, 22)
                for (const limit of ['0', '101', '1.5', 'many'])
                    refused(await fromPage('GET', '/board', { query: { board: keys.rows, limit } }), 400)
            })

            it('unknown boards, periods and bad scores are refused', async () => {
                await fails(page.board({ board: `none-${run}` }), 400, 'unknown_board')
                await fails(
                    page.submitScore({ name: names.guest, score: 1, board: `none-${run}` }),
                    400,
                    'unknown_board'
                )
                refused(await fromPage('GET', '/board', { query: { board: 'Bad Key' } }), 400, 'unknown_board')
                refused(await fromPage('GET', '/board', { query: { period: 'yearly' } }), 400, 'unknown_period')
                refused(await fromPage('GET', '/board', { query: { at: 'yesterday' } }), 400)
                refused(await fromPage('GET', '/board', { query: { at: '2026-13-45' } }), 400)
                const bad: Record<string, unknown>[] = [
                    { name: names.guest, score: -1 },
                    { name: names.guest, score: 1.5 },
                    { name: names.guest, score: '12' },
                    { name: names.guest, score: 2 ** 53 },
                    { name: names.guest },
                    { name: 'not a valid name!', score: 1 },
                    { name: '', score: 1 },
                    { score: 1 },
                    { name: names.guest, score: 1, meta: { text: 'x'.repeat(600) } },
                    { name: names.guest, score: 1, meta: 'text' },
                ]
                for (const body of bad) refused(await fromPage('POST', '/scores', { body }), 400)
            })

            it('a board taken off the list is hidden, and its rows come back with it', async () => {
                const kept = boards.filter((board) => board.key !== keys.far)
                const list = await server.defineBoards(kept)
                assert.ok(!list.some((board) => board.key === keys.far))
                assert.ok(list.some((board) => board.key === 'main'))
                await fails(page.board({ board: keys.far }), 400, 'unknown_board')
                await fails(page.submitScore({ name: names.guest, score: 1, board: keys.far }), 400, 'unknown_board')
                await server.defineBoards(boards)
                assert.equal((await page.board({ board: keys.far, name: names.guest })).you?.score, 150)
            })
        })

        describe('wallets and players', () => {
            it('a wallet links with one signed message', async () => {
                const address = await ace.game.link()
                assert.equal(lower(address), lower(ace.address))
                assert.equal(lower(ace.game.wallet.address ?? ''), lower(ace.address))
                assert.ok(ace.game.wallet.session)
                assert.equal(ace.game.wallet.name, null)
                assert.equal(ace.game.wallet.holds, true)
                await bob.game.link()
                await cat.game.link()
            })

            it('a bad signature, a used nonce and a made-up session are refused', async () => {
                const stranger = createPlayer(target, 'stranger')
                const liar = createPlayer(target, 'liar')
                liar.game.useConnector({
                    sign: async () => ({ address: stranger.address, signature: `0x${'11'.repeat(65)}` }),
                })
                await fails(liar.game.link(), 401)
                const { nonce } = (await fromPage('GET', '/link/nonce')).body
                assert.equal(typeof nonce, 'string')
                const host = new URL(target.origin).host
                const signed = async (withNonce: string) => ({
                    address: stranger.address,
                    signature: await stranger.sign(linkMessage(host, withNonce)),
                    nonce: withNonce,
                })
                const forged = { address: stranger.address, signature: `0x${'11'.repeat(65)}`, nonce }
                // a bad signature does not use the nonce up
                refused(await fromPage('POST', '/link', { body: forged }), 401)
                const body = await signed(nonce as string)
                assert.equal((await fromPage('POST', '/link', { body })).status, 200)
                refused(await fromPage('POST', '/link', { body }), 401)
                refused(await fromPage('POST', '/link', { body: await signed('never-issued-nonce-0000') }), 401)
                refused(await fromPage('POST', '/link', { body: { ...body, nonce: 'bad nonce!' } }), 400)
                refused(await fromPage('POST', '/link', { body: { ...body, signature: 'nope' } }), 400)
                refused(await fromPage('POST', '/link', { body: { ...body, address: '0x1234' } }), 400)
                refused(await fromPage('GET', '/player', { session: 'made-up' }), 401)
                refused(await fromPage('GET', '/player'), 401)
                refused(await fromPage('POST', '/player', { body: { session: 'made-up' } }), 401)
            })

            it('a fresh player has no name, a made-up picture and nothing equipped', async () => {
                const player = await ace.game.player.get()
                assert.deepEqual(
                    {
                        name: player.name,
                        source: player.avatarSource,
                        isHolder: player.isHolder,
                        equipped: player.equipped,
                    },
                    { name: null, source: 'generated', isHolder: true, equipped: {} }
                )
                assert.ok(Math.abs(player.createdAt - Date.now()) < 120_000)
                await loadsImage(player.avatar)
                assert.ok(!JSON.stringify(player).toLowerCase().includes(lower(ace.address).slice(2)))
            })

            it('a username is set once per game, and a taken one is refused', async () => {
                const player = await ace.game.player.setName(names.ace)
                assert.equal(player.name, names.ace)
                assert.equal(ace.game.wallet.name, names.ace)
                await fails(bob.game.player.setName(names.ace), 409)
                await fails(bob.game.player.setName(names.ace.toUpperCase()), 409)
                assert.equal((await bob.game.player.setName(names.bob)).name, names.bob)
                assert.equal((await ace.game.player.setName(names.ace)).name, names.ace)
                refused(await fromPage('POST', '/player', { body: { session: sessionOf(bob), name: 'no!' } }), 400)
            })

            it('the server reads the wallet behind a session', async () => {
                const player = await server.player(sessionOf(ace))
                assert.match(player.address, SHORT_ADDRESS)
                assert.equal(lower(player.address.slice(0, 6)), lower(ace.address.slice(0, 6)))
                assert.deepEqual(
                    { name: player.name, holds: player.holds, holdMin: player.holdMin },
                    { name: names.ace, holds: true, holdMin: 0 }
                )
                await fails(server.player('made-up'), 401)
            })

            it('a linked score belongs to the wallet, and its name is protected', async () => {
                const board = await ace.game.submitScore({ name: names.ace, score: 300, board: keys.prize })
                assert.deepEqual([board.you?.name, board.you?.score, board.you?.linked], [names.ace, 300, true])
                assert.equal(board.you?.avatar, (await ace.game.player.get()).avatar)
                await fails(page.submitScore({ name: names.ace, score: 999, board: keys.prize }), 409)
                // a linked wallet plays under its username, whatever name the page sends
                const other = await bob.game.submitScore({ name: `x-${run}`, score: 200, board: keys.prize })
                assert.deepEqual([other.you?.name, other.you?.score], [names.bob, 200])
                // a wallet with no username takes the name of its first score
                const fresh = await cat.game.submitScore({ name: names.cat, score: 100, board: keys.prize })
                assert.equal(fresh.you?.linked, true)
                assert.equal((await cat.game.player.get()).name, names.cat)
                await page.submitScore({ name: names.guest, score: 999, board: keys.prize })
                refused(
                    await fromPage('POST', '/scores', {
                        body: { name: names.guest, score: 1, board: keys.prize, session: 'made-up' },
                    }),
                    401
                )
            })

            it('a new username moves the wallet rows, and a name on the board is not free', async () => {
                await fails(cat.game.player.setName(names.guest), 409)
                const player = await ace.game.player.setName(names.aceNext)
                assert.equal(player.name, names.aceNext)
                const board = await page.board({ board: keys.prize, name: names.aceNext })
                assert.deepEqual([board.you?.score, board.you?.linked], [300, true])
                assert.equal((await page.board({ board: keys.prize, name: names.ace })).you, null)
                assert.equal(
                    (await page.board({ board: keys.prize, period: 'all', name: names.aceNext })).you?.score,
                    300
                )
            })

            it('players are looked up by name', async () => {
                const found = await page.players([lower(names.aceNext), names.bob, names.nobody])
                assert.deepEqual(
                    found.map((player) => player.name),
                    [names.aceNext, names.bob, names.nobody]
                )
                assert.equal(found[0]?.avatar, (await ace.game.player.get()).avatar)
                for (const player of found) {
                    assert.deepEqual(player.equipped, {})
                    assert.deepEqual(Object.keys(player).sort(), ['avatar', 'equipped', 'name'])
                }
                await loadsImage(found[2]!.avatar)
                assert.equal((await page.players([names.bob, lower(names.bob)])).length, 1)
                const many = Array.from({ length: 51 }, (_, index) => `n${index}`).join(',')
                refused(await fromPage('GET', '/players', { query: { names: many } }), 400)
                refused(await fromPage('GET', '/players'), 400)
                refused(await fromPage('GET', '/players', { query: { names: 'bad name!' } }), 400)
            })

            it('a picture is uploaded, shown on the board, and taken away again', async () => {
                const before = await ace.game.player.get()
                const image = new Blob([pngSquare(48, [240, 60, 120])], { type: 'image/png' })
                const player = await ace.game.player.setAvatar(image)
                assert.equal(player.avatarSource, 'game')
                assert.notEqual(player.avatar, before.avatar)
                await loadsImage(player.avatar)
                assert.deepEqual(await ace.game.player.get(), player)
                const board = await page.board({ board: keys.prize, name: names.aceNext })
                assert.equal(board.you?.avatar, player.avatar)
                assert.equal((await page.players([names.aceNext]))[0]?.avatar, player.avatar)
                const after = await ace.game.player.removeAvatar()
                assert.deepEqual([after.avatarSource, after.avatar], ['generated', before.avatar])
            })

            it('a picture that is too big, not an image or not for a session is refused', async () => {
                const session = sessionOf(bob)
                const png = pngSquare(8, [1, 2, 3])
                const big = new Uint8Array(KB * KB + 1)
                big.set(png)
                const upload = (type: string, bytes: Uint8Array<ArrayBuffer>, as: string | undefined = session) =>
                    fromPage('POST', '/player/avatar', { session: as, upload: { type, bytes } })
                refused(await upload('image/png', big), 413, 'too_large')
                refused(await upload('text/plain', png), 400)
                refused(await upload('image/svg+xml', png), 400)
                refused(await upload('image/png', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), 400)
                refused(await upload('image/png', new Uint8Array(0)), 400)
                refused(await upload('image/png', png, 'made-up'), 401)
                refused(await fromPage('DELETE', '/player/avatar'), 401)
                assert.equal((await bob.game.player.get()).avatarSource, 'generated')
            })
        })

        describe('saved data', () => {
            it('keys are set, read and removed', async () => {
                const saved = await ace.game.save.set({ level: 3, opts: { sound: false, keys: ['a', 'b'] }, tag: 'x' })
                assert.deepEqual(saved, { level: 3, opts: { sound: false, keys: ['a', 'b'] }, tag: 'x' })
                assert.deepEqual(await ace.game.save.get(), saved)
                assert.deepEqual(await ace.game.save.get(['level', 'missing']), { level: 3 })
                assert.deepEqual(await ace.game.save.set({ level: 4, nothing: null }), {
                    ...saved,
                    level: 4,
                    nothing: null,
                })
                assert.deepEqual(await ace.game.save.remove(['tag', 'nothing', 'missing']), {
                    level: 4,
                    opts: saved.opts,
                })
                assert.deepEqual(await bob.game.save.get(), {})
            })

            it('the server reads and writes any player by name', async () => {
                assert.deepEqual(await server.getPlayerData(names.aceNext, ['level']), { level: 4 })
                assert.deepEqual(await server.setPlayerData(lower(names.aceNext), { xp: 10 }), {
                    level: 4,
                    opts: { sound: false, keys: ['a', 'b'] },
                    xp: 10,
                })
                assert.deepEqual(await server.removePlayerData(names.aceNext, ['xp', 'opts']), { level: 4 })
                assert.deepEqual(await ace.game.save.get(), { level: 4 })
                await fails(server.getPlayerData(names.nobody), 404, 'unknown_player')
                await fails(server.setPlayerData(names.nobody, { a: 1 }), 404, 'unknown_player')
                // a name on the board with no wallet behind it is no player
                await fails(server.getPlayerData(names.guest), 404, 'unknown_player')
            })

            it('one write takes set and remove together, and an empty one changes nothing', async () => {
                const session = sessionOf(bob)
                const both = await fromPage('PUT', '/player/data', {
                    session,
                    body: { set: { a: 1, b: 2 }, remove: ['b', 'c'] },
                })
                assert.deepEqual([both.status, both.body.data], [200, { a: 1, b: 2 }])
                const none = await fromPage('PUT', '/player/data', { session, body: {} })
                assert.deepEqual([none.status, none.body.data], [200, { a: 1, b: 2 }])
            })

            it('the limits hold: keys, 64 keys, 16 KB a value, 64 KB a player', async () => {
                const session = sessionOf(bob)
                const put = (body: unknown) => fromPage('PUT', '/player/data', { session, body })
                refused(await put({ set: { 'bad key!': 1 } }), 400)
                refused(await put({ set: { ['k'.repeat(49)]: 1 } }), 400)
                refused(await put({ set: [1, 2] }), 400)
                refused(await put({ remove: 'a' }), 400)
                refused(await put({ remove: ['bad key!'] }), 400)
                refused(await put({ set: { big: 'x'.repeat(16 * KB) } }), 413, 'too_large')
                const filler = (count: number, size: number) =>
                    Object.fromEntries(Array.from({ length: count }, (_, index) => [`f${index}`, 'x'.repeat(size)]))
                refused(await put({ set: filler(5, 15 * KB) }), 413, 'too_large')
                refused(await put({ set: filler(65, 1) }), 413, 'too_large')
                assert.equal((await put({ set: filler(62, 1) })).status, 200)
                refused(await put({ set: { one: 1 } }), 413, 'too_large')
                assert.equal(Object.keys(await bob.game.save.get()).length, 64)
                assert.equal((await put({ set: { one: 1 }, remove: ['a'] })).status, 200)
                refused(await fromPage('GET', '/player/data', { session, query: { keys: 'bad key!' } }), 400)
                refused(await fromPage('GET', '/player/data'), 401)
                refused(await fromPage('PUT', '/player/data', { body: { set: { a: 1 } } }), 401)
                refused(await fromPage('PUT', '/player/data', { session: 'made-up', body: { set: { a: 1 } } }), 401)
                // a page cannot name another player: only the secret key can
                refused(await fromPage('GET', '/player/data', { session, query: { player: names.aceNext } }), 401)
            })
        })

        describe('items', () => {
            it('an item is granted once, or stacked up to its most', async () => {
                assert.deepEqual(await ace.game.items.mine(), [])
                const sword = await ace.game.items.grant(item.sword)
                assert.deepEqual([sword.key, sword.qty, sword.meta], [item.sword, 1, undefined])
                assert.ok(Math.abs(sword.acquiredAt - Date.now()) < 120_000)
                await fails(ace.game.items.grant(item.sword), 409, 'already_owned')
                refused(
                    await fromPage('POST', '/player/items/grant', {
                        session: sessionOf(ace),
                        body: { item: item.cape, qty: 2 },
                    }),
                    409,
                    'over_max'
                )
                assert.equal((await ace.game.items.grant(item.coin, { qty: 4 })).qty, 4)
                const more = await ace.game.items.grant(item.coin, { qty: 3 })
                assert.deepEqual([more.qty, more.acquiredAt >= sword.acquiredAt], [7, true])
                await fails(ace.game.items.grant(item.coin, { qty: 4 }), 409, 'over_max')
                assert.equal((await ace.game.items.grant(item.coin, { qty: 3 })).qty, 10)
                const hat = await ace.game.items.grant(item.hat, { meta: { signed: 'yes' } })
                assert.deepEqual(hat.meta, { signed: 'yes' })
                const mine = await ace.game.items.mine()
                assert.deepEqual(
                    mine.map((owned) => [owned.key, owned.qty]).sort(),
                    [
                        [item.coin, 10],
                        [item.hat, 1],
                        [item.sword, 1],
                    ].sort()
                )
                assert.deepEqual(mine.find((owned) => owned.key === item.hat)?.meta, { signed: 'yes' })
            })

            it('an item is used up, and the last one is gone', async () => {
                await fails(ace.game.items.consume(item.coin, 11), 409, 'not_enough')
                await fails(ace.game.items.consume(item.cape), 409, 'not_enough')
                assert.equal((await ace.game.items.consume(item.coin, 9))?.qty, 1)
                assert.equal(await ace.game.items.consume(item.coin), null)
                await fails(ace.game.items.consume(item.coin), 409, 'not_enough')
                assert.ok(!(await ace.game.items.mine()).some((owned) => owned.key === item.coin))
            })

            it('unknown items and bad amounts are refused', async () => {
                const session = sessionOf(ace)
                await fails(ace.game.items.grant(`none-${run}`), 404, 'unknown_item')
                await fails(ace.game.items.consume(`none-${run}`), 404, 'unknown_item')
                await fails(ace.game.items.equip('head', `none-${run}`), 404, 'unknown_item')
                const grant = (body: unknown, as: string | null = session) =>
                    fromPage('POST', '/player/items/grant', { session: as ?? undefined, body })
                refused(await grant({ item: item.coin, qty: 0 }), 400)
                refused(await grant({ item: item.coin, qty: 1.5 }), 400)
                refused(await grant({ item: item.coin, qty: '2' }), 400)
                refused(await grant({ item: item.coin, meta: { text: 'x'.repeat(3 * KB) } }), 413, 'too_large')
                refused(await grant({}), 400)
                refused(await grant({ item: item.coin }, 'made-up'), 401)
                refused(await grant({ item: item.coin }, null), 401)
                refused(
                    await fromPage('POST', '/player/items/consume', { session, body: { item: item.sword, qty: 0 } }),
                    400
                )
                refused(await fromPage('GET', '/player/items'), 401)
            })

            it('an owned item is worn in its own slot, and shows on the board', async () => {
                const worn = await ace.game.items.equip('head', item.hat)
                assert.deepEqual(worn.equipped, { head: item.hat })
                assert.deepEqual((await ace.game.player.get()).equipped, { head: item.hat })
                await fails(ace.game.items.equip('back', item.hat), 400, 'wrong_slot')
                await fails(ace.game.items.equip('head', item.sword), 400, 'wrong_slot')
                await fails(ace.game.items.equip('back', item.cape), 409, 'not_enough')
                // not owned and not its slot: the slot is said first
                await fails(ace.game.items.equip('head', item.cape), 400, 'wrong_slot')
                const board = await page.board({ board: keys.prize, name: names.aceNext })
                assert.deepEqual(board.you?.equipped, { head: item.hat })
                assert.deepEqual((await page.players([names.aceNext]))[0]?.equipped, { head: item.hat })
                assert.deepEqual((await ace.game.items.equip('head', null)).equipped, {})
                assert.deepEqual((await ace.game.items.equip('back', null)).equipped, {})
                await ace.game.items.equip('head', item.hat)
                assert.equal(await ace.game.items.consume(item.hat), null)
                assert.deepEqual((await ace.game.player.get()).equipped, {})
                const session = sessionOf(ace)
                refused(await fromPage('POST', '/player/equip', { session, body: { item: item.sword } }), 400)
                refused(await fromPage('POST', '/player/equip', { session, body: { slot: '', item: null } }), 400)
                refused(await fromPage('POST', '/player/equip', { body: { slot: 'head', item: null } }), 401)
            })

            it('the server grants, reads and uses up items for any player', async () => {
                assert.equal((await server.grantItem(names.bob, item.coin, { qty: 2 })).qty, 2)
                assert.equal((await server.grantItem(lower(names.bob), item.cape)).qty, 1)
                assert.deepEqual(
                    (await server.playerItems(names.bob)).map((owned) => [owned.key, owned.qty]).sort(),
                    [
                        [item.cape, 1],
                        [item.coin, 2],
                    ].sort()
                )
                assert.deepEqual(
                    (await bob.game.items.mine()).map((owned) => owned.key).sort(),
                    [item.cape, item.coin].sort()
                )
                assert.equal((await server.consumeItem(names.bob, item.coin))?.qty, 1)
                await fails(server.grantItem(names.bob, item.cape), 409, 'already_owned')
                await fails(server.consumeItem(names.bob, item.coin, 5), 409, 'not_enough')
                await fails(server.grantItem(names.bob, `none-${run}`), 404, 'unknown_item')
                await fails(server.grantItem(names.nobody, item.coin), 404, 'unknown_player')
                await fails(server.consumeItem(names.nobody, item.coin), 404, 'unknown_player')
                await fails(server.playerItems(names.nobody), 404, 'unknown_player')
                // the secret key with no player named has nobody to act for
                refused(await fromServer('POST', '/player/items/grant', { body: { item: item.coin } }), 400)
            })

            it('PUT /items adds or updates by key and leaves the rest', async () => {
                const before = await page.items.catalog()
                const after = await server.defineItems([{ key: item.sword, name: 'Long sword', kind: 'item' }])
                assert.equal(after.length, before.length)
                assert.equal(after.find((entry) => entry.key === item.sword)?.name, 'Long sword')
                assert.deepEqual(
                    after.find((entry) => entry.key === item.hat),
                    before.find((entry) => entry.key === item.hat)
                )
                // what players own stays
                assert.ok((await ace.game.items.mine()).some((owned) => owned.key === item.sword))
            })

            it('PUT /items refuses bad items', async () => {
                const good = { key: `good-${run}`, name: 'Good', kind: 'item' }
                const bad: unknown[][] = [
                    [],
                    [{ ...good, key: 'Bad Key' }],
                    [{ ...good, name: 'x'.repeat(41) }],
                    [{ ...good, name: '' }],
                    [{ ...good, kind: 'x'.repeat(25) }],
                    [{ ...good, rarity: 'x'.repeat(17) }],
                    [{ ...good, slot: 'x'.repeat(25) }],
                    [{ ...good, image: 'http://example.com/a.png' }],
                    [{ ...good, image: 'not a url' }],
                    [{ ...good, maxQty: 5 }],
                    [{ ...good, isStackable: true, maxQty: 0 }],
                    [{ ...good, isStackable: 'yes' }],
                    [good, good],
                    Array.from({ length: 501 }, (_, index) => ({ ...good, key: `many-${index}` })),
                ]
                for (const list of bad)
                    refused(await fromServer('PUT', '/items', { body: { items: list } }), 400, undefined, list)
                refused(await fromServer('PUT', '/items', { body: {} }), 400)
                refused(
                    await fromServer('PUT', '/items', {
                        body: { items: [{ ...good, meta: { text: 'x'.repeat(3 * KB) } }] },
                    }),
                    413,
                    'too_large'
                )
                assert.ok(!(await page.items.catalog()).some((entry) => entry.key === good.key))
            })

            it('a removed item leaves the catalogue and every player', async () => {
                await bob.game.items.equip('back', item.cape)
                const left = await server.removeItem(item.cape)
                assert.ok(!left.some((entry) => entry.key === item.cape))
                assert.deepEqual(left, await page.items.catalog())
                assert.ok(!(await bob.game.items.mine()).some((owned) => owned.key === item.cape))
                assert.deepEqual((await bob.game.player.get()).equipped, {})
                await fails(server.removeItem(item.cape), 404, 'unknown_item')
                await fails(bob.game.items.grant(item.cape), 404, 'unknown_item')
            })
        })

        describe("writes: 'server'", () => {
            it('pages may no longer post scores or change items, the server may', async () => {
                assert.equal((await server.configure({ writes: 'server' })).writes, 'server')
                const config = await createPlayer(target, 'late').game.config()
                assert.deepEqual([config.writes, config.scoreWrites], ['server', 'server'])
                const score = { name: names.guest, score: 5, board: keys.rows }
                await fails(page.submitScore(score), 403, 'server_writes_only')
                await fails(ace.game.submitScore({ ...score, name: names.aceNext }), 403, 'server_writes_only')
                await fails(ace.game.items.grant(item.coin), 403, 'server_writes_only')
                await fails(ace.game.items.consume(item.sword), 403, 'server_writes_only')
                // the session is still the player's own: reads, saved data, pictures and what is worn
                assert.ok((await ace.game.items.mine()).some((owned) => owned.key === item.sword))
                assert.deepEqual(await ace.game.save.set({ level: 5 }), { level: 5 })
                assert.deepEqual((await ace.game.items.equip('head', null)).equipped, {})
                assert.equal((await ace.game.player.setName(names.aceNext)).name, names.aceNext)
            })

            it('the server posts checked scores, for a name or for a session', async () => {
                const unlinked = await server.submitScore({ name: names.guest, score: 2000, board: keys.rows })
                assert.deepEqual([unlinked.you?.score, unlinked.you?.linked, unlinked.you?.rank], [2000, false, 1])
                const linked = await server.submitScore({
                    name: names.aceNext,
                    score: 3000,
                    board: keys.rows,
                    session: sessionOf(ace),
                })
                assert.deepEqual([linked.you?.name, linked.you?.linked, linked.you?.rank], [names.aceNext, true, 1])
                await fails(server.submitScore({ name: names.aceNext, score: 1, board: keys.rows }), 409)
                assert.equal((await server.grantItem(names.aceNext, item.coin, { qty: 2 })).qty, 2)
                assert.equal((await server.consumeItem(names.aceNext, item.coin))?.qty, 1)
                assert.equal((await server.configure({ writes: 'client' })).writes, 'client')
                assert.equal(await ace.game.items.consume(item.coin), null)
            })
        })

        describe('prizes', () => {
            const tx = (digit: string): string => `0x${digit.repeat(64)}`
            const hashes = [generateHash(), generateHash()]

            it('the pot is 0 until the server reports it', async () => {
                const day = today()
                const pot = await server.setPot({ day, eth: 1.25, usd: 4321.5 })
                assert.deepEqual({ day: pot.day, eth: pot.eth, usd: pot.usd }, { day, eth: 1.25, usd: 4321.5 })
                assert.ok(pot.endsAt > Date.now())
                assert.equal(pot.endsAt % 86_400_000, 0)
                assert.deepEqual(await page.pot(), pot)
                const bad: unknown[] = [
                    { day: 'today', eth: 1, usd: 1 },
                    { day, eth: -1, usd: 1 },
                    { day, eth: 1 },
                ]
                for (const body of bad) refused(await fromServer('POST', '/pot', { body }), 400, undefined, body)
                assert.deepEqual(await page.pot(), pot)
                // no day: today's pot
                const now = await fromServer('POST', '/pot', { body: { eth: '1.25', usd: 4321.5 } })
                assert.deepEqual([now.status, now.body.day, now.body.eth, now.body.usd], [200, day, 1.25, 4321.5])
            })

            it('winners are the best linked wallets on the prize board, by the split', async () => {
                const day = today()
                const { winners, unclaimedPct } = await page.winners(day)
                assert.deepEqual(
                    winners.map((winner) => [winner.place, winner.name, lower(winner.address), winner.sharePct]),
                    [
                        [1, names.aceNext, lower(ace.address), 50],
                        [2, names.bob, lower(bob.address), 30],
                        [3, names.cat, lower(cat.address), 20],
                    ]
                )
                for (const winner of winners) assert.match(winner.address, FULL_ADDRESS)
                assert.equal(unclaimedPct, 0)
                assert.deepEqual(await server.winners(day), { day, winners, unclaimedPct })
                assert.deepEqual(await page.winners(), { day, winners, unclaimedPct })
                assert.deepEqual(await page.winners(PAST_DAY), { day: PAST_DAY, winners: [], unclaimedPct: 100 })
                refused(await fromPage('GET', '/winners', { query: { day: 'never' } }), 400)
            })

            it('a split with more places than winners leaves the rest unclaimed', async () => {
                await server.configure({ prizeShares: [40, 30, 20, 10] })
                try {
                    const { winners, unclaimedPct } = await page.winners(today())
                    assert.deepEqual(
                        winners.map((winner) => winner.sharePct),
                        [40, 30, 20]
                    )
                    assert.equal(unclaimedPct, 10)
                } finally {
                    await server.configure({ prizeShares: [50, 30, 20] })
                }
            })

            it('a paid prize is recorded once, and listed newest first', async () => {
                const day = today()
                const first = await server.recordPayout({
                    day,
                    place: 1,
                    address: ace.address,
                    amountWei: 625_000_000_000_000_000n,
                    txHash: hashes[0]!.toUpperCase().replace('0X', '0x'),
                })
                assert.deepEqual(
                    {
                        day: first.day,
                        place: first.place,
                        name: first.name,
                        address: first.address,
                        amountWei: first.amountWei,
                        txHash: first.txHash,
                    },
                    {
                        day,
                        place: 1,
                        name: names.aceNext,
                        address: lower(ace.address),
                        amountWei: '625000000000000000',
                        txHash: hashes[0],
                    }
                )
                assert.ok(Math.abs(first.at - Date.now()) < 120_000)
                const again = await server.recordPayout({
                    day,
                    place: 2,
                    address: bob.address,
                    amountWei: '1',
                    txHash: hashes[0]!,
                })
                assert.deepEqual(again, first)
                const second = await server.recordPayout({
                    day,
                    place: 2,
                    address: bob.address,
                    amountWei: '375000000000000000',
                    txHash: hashes[1]!,
                })
                assert.equal(second.name, names.bob)
                const mine = (list: { txHash: string }[]) => list.filter((payout) => hashes.includes(payout.txHash))
                assert.deepEqual(
                    mine((await page.payouts(50)).payouts),
                    [second, first].sort((a, b) => b.at - a.at || a.place - b.place)
                )
                assert.deepEqual(mine((await server.payouts(50)).payouts).length, 2)
                assert.equal((await page.payouts(1)).payouts.length, 1)
            })

            it('bad payouts and bad limits are refused', async () => {
                const good = { day: today(), place: 1, address: ace.address, amountWei: '1', txHash: tx('a') }
                const bad: unknown[] = [
                    { ...good, day: 'today' },
                    { ...good, place: 0 },
                    { ...good, place: 4 },
                    { ...good, place: 1.5 },
                    { ...good, address: '0x1234' },
                    { ...good, amountWei: 1 },
                    { ...good, amountWei: '1.5' },
                    { ...good, amountWei: '-1' },
                    { ...good, txHash: '0x1234' },
                    {},
                ]
                for (const body of bad) refused(await fromServer('POST', '/payouts', { body }), 400, undefined, body)
                refused(await fromPage('GET', '/payouts', { query: { limit: '0' } }), 400)
                refused(await fromPage('GET', '/payouts', { query: { limit: 'many' } }), 400)
                const most = await fromPage('GET', '/payouts', { query: { limit: '500' } })
                assert.equal(most.status, 200)
                assert.ok((most.body.payouts as unknown[]).length <= 50)
            })
        })

        describe('over HTTP', { skip: !target.isHttp }, () => {
            const url = (path: string): string => `${target.apiUrl}/api/games/v1${path}`
            const preflight = (path: string, method: string, origin: string) =>
                fetch(url(path), {
                    method: 'OPTIONS',
                    headers: {
                        Origin: origin,
                        'Access-Control-Request-Method': method,
                        'Access-Control-Request-Headers':
                            'content-type,x-fobo-game-key,x-fobo-game-sdk,x-fobo-game-session',
                    },
                })

            it('a preflight from the game site allows PUT and DELETE with the session and SDK headers', async () => {
                const routes: [string, string][] = [
                    ['/player/data', 'PUT'],
                    ['/player/avatar', 'DELETE'],
                    ['/player/avatar', 'POST'],
                    ['/player/equip', 'POST'],
                    ['/player/items/grant', 'POST'],
                    [`/items/${item.sword}`, 'DELETE'],
                    ['/boards', 'PUT'],
                    ['/game', 'PUT'],
                    ['/board', 'GET'],
                ]
                for (const [path, method] of routes) {
                    const answer = await preflight(path, method, target.origin)
                    assert.ok(answer.status === 204 || answer.status === 200, `${method} ${path}: ${answer.status}`)
                    assert.equal(answer.headers.get('access-control-allow-origin'), target.origin, path)
                    const methods = (answer.headers.get('access-control-allow-methods') ?? '').split(/,\s*/)
                    for (const allowed of ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'])
                        assert.ok(methods.includes(allowed))
                    const headers = lower(answer.headers.get('access-control-allow-headers') ?? '').split(/,\s*/)
                    for (const allowed of ['content-type', 'x-fobo-game-key', 'x-fobo-game-session', 'x-fobo-game-sdk'])
                        assert.ok(headers.includes(allowed), `${path}: ${allowed} is not allowed`)
                }
            })

            it('another site gets no CORS and no answer', async () => {
                const answer = await preflight('/player/data', 'PUT', FOREIGN_ORIGIN)
                assert.equal(answer.headers.get('access-control-allow-origin'), null)
                const read = await fetch(url('/config'), {
                    headers: { Origin: FOREIGN_ORIGIN, 'X-Fobo-Game-Key': target.publicKey },
                })
                assert.equal(read.status, 403)
                assert.equal(read.headers.get('access-control-allow-origin'), null)
            })

            it('answers and errors carry CORS for the game site', async () => {
                const good = await fromPage('GET', '/config')
                assert.equal(good.headers.get('access-control-allow-origin'), target.origin)
                assert.match(good.headers.get('vary') ?? '', /origin/i)
                const bad = await fromPage('GET', '/board', { query: { board: `none-${run}` } })
                assert.deepEqual([bad.status, bad.headers.get('access-control-allow-origin')], [400, target.origin])
                const write = await fromPage('PUT', '/player/data', { session: sessionOf(bob), body: {} })
                assert.deepEqual([write.status, write.headers.get('access-control-allow-origin')], [200, target.origin])
            })

            it('a write with no Origin needs the secret key', async () => {
                const send = (headers: Record<string, string>) =>
                    fetch(url('/scores'), {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Fobo-Game-Key': target.publicKey,
                            ...headers,
                        },
                        body: JSON.stringify({ name: names.guest, score: 1, board: keys.rows }),
                    })
                assert.equal((await send({})).status, 401)
                assert.equal((await send({ Authorization: 'Bearer sk_live_wrongwrongwrongwrong' })).status, 401)
                assert.equal((await send({ Authorization: `Bearer ${target.secretKey}` })).status, 200)
            })
        })

        describe('cleanup', () => {
            it('the run takes its items and boards away', async () => {
                for (const key of [item.sword, item.hat, item.coin]) await server.removeItem(key)
                assert.ok(!(await page.items.catalog()).some((entry) => entry.key.endsWith(run)))
                assert.deepEqual(await ace.game.items.mine(), [])
                const list = await server.defineBoards([highScore('main', { isPrize: true })])
                assert.deepEqual(
                    list.map((board) => [board.key, board.isPrize]),
                    [['main', true]]
                )
                assert.deepEqual(await server.defineBoards([]), list)
            })
        })
    })
}

/** A transaction hash nobody has used. */
function generateHash(): string {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32))
    return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
