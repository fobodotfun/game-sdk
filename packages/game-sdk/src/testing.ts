/**
 * A whole Game Center in memory, for building and testing a game with no key and no network.
 * `createTestGame()` is the real SDK talking to this mock, so what works here works against fobo.fun.
 */
import { MAIN_BOARD, periodKey } from './boards.js'
import { createCaller } from './api.js'
import { errorMessage } from './errors.js'
import { buildGame, type Game, type GameOptions } from './game.js'
import type { FetchLike } from './http.js'
import { isRecord, parseJson } from './json.js'
import { API_BASE, API_VERSION, KEY_HEADER, linkMessage, LINK_NONCE_PATTERN, SESSION_HEADER } from './protocol.js'
import { buildServerApi, type ServerClient } from './serverApi.js'
import { browserStore, hasBrowserStorage, type Store } from './storage.js'
import type {
    BoardDefinition,
    BoardEntry,
    BoardPeriod,
    BoardSort,
    Connector,
    GameConfig,
    Item,
    ItemInput,
    OwnedItem,
    Payout,
    ScoreWrites,
} from './types.js'
import {
    avatarProblem,
    BOARD_PERIODS,
    boardKeyProblem,
    boardsProblem,
    dataKeysProblem,
    dataTotalProblem,
    dataValuesProblem,
    dayProblem,
    itemMetaProblem,
    itemsProblem,
    limitProblem,
    LIMITS,
    metaProblem,
    nameProblem,
    namesProblem,
    periodProblem,
    qtyProblem,
    scoreProblem,
    settingsProblem,
    slotProblem,
    type Problem,
} from './validate.js'
import { createVerifier, type Replay } from './verifier.js'

/** The keys the mock answers to. */
export const TEST_PUBLIC_KEY = 'pk_test_0000000000000000'
export const TEST_SECRET_KEY = 'sk_test_0000000000000000'
/** The wallet the test connector "signs" with. */
export const TEST_ADDRESS = '0x00000000000000000000000000000000000f0b0f'

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/
const HEX_PATTERN = /^0x[0-9a-fA-F]+$/
const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/
const WEI_PATTERN = /^\d{1,60}$/
const PAYOUTS_DEFAULT = 10
const PAYOUTS_MAX = 50
const DAY_SECONDS = 86_400
const TEST_API_URL = 'http://localhost'
const TEST_VERIFY_URL = 'http://localhost/verify'
const TEST_STORAGE_KEY = 'fobogame:test'
const SNAPSHOT_VERSION = 1
/** How image files begin: PNG, JPEG, GIF, WebP (null: any byte). */
const IMAGE_STARTS: readonly (number | null)[][] = [
    [0x89, 0x50, 0x4e, 0x47],
    [0xff, 0xd8, 0xff],
    [0x47, 0x49, 0x46, 0x38],
    [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50],
]
/** The HTTP status each of the API's error codes travels with. */
const CODE_STATUS = {
    unknown_board: 400,
    unknown_period: 400,
    unknown_item: 404,
    already_owned: 409,
    over_max: 409,
    not_enough: 409,
    too_large: 413,
    server_writes_only: 403,
    wrong_slot: 400,
    unknown_player: 404,
} as const

export interface MockRequest {
    method: string
    /** The path under the API base, e.g. '/board'. */
    path: string
    query?: URLSearchParams
    headers?: Record<string, string | undefined>
    /** The parsed JSON body, or the raw bytes of an upload. */
    body?: unknown
    /** The calling page's host (what the signed link text names). */
    host?: string
    /** The game's own server is calling: what the secret key proves over HTTP, said outright (see serverFetch). */
    isServer?: boolean
}

export interface MockResponse {
    status: number
    body: unknown
}

export interface MockApiOptions {
    /** Overrides for the game's settings. */
    config?: Partial<Pick<GameConfig, 'game' | 'title' | 'tokenAddress' | 'ticker' | 'holdMin' | 'shares'>>
    /** Who may write scores and items: the game's pages ('client', the default) or only its server. */
    writes?: ScoreWrites
    /** The same as `writes` (its older name). */
    scoreWrites?: ScoreWrites
    /** The game's boards. Default: the 'main' high-score board every game starts with. */
    boards?: BoardDefinition[]
    /** The game's items. */
    items?: ItemInput[]
    /** Whether the game pays prizes (set by the creator on fobo.fun). Default: false. */
    paysRewards?: boolean
    /** Whether players can connect a wallet (set by the creator on fobo.fun). Default: true. */
    walletLink?: boolean
    /** Whether linked wallets hold enough of the token. */
    holds?: boolean
    /** Checks a link signature. Default: any well-formed signature passes. */
    verify?: (signed: { address: string; signature: string; message: string }) => boolean | Promise<boolean>
    /** The clock, in ms. */
    now?: () => number
    /**
     * Where the mock keeps what players did (scores, names, saved data, items, pots) so it is still there after
     * a page reload. Default: nowhere, it lasts as long as the mock.
     */
    store?: Store<MockSnapshot>
}

/** Everything the mock holds, as JSON (what `store` keeps). */
export interface MockSnapshot {
    version: typeof SNAPSHOT_VERSION
    settings: { title: string; holdMin: number; shares: number[] }
    writes: ScoreWrites
    boards: BoardDefinition[]
    items: Item[]
    scores: [string, [string, Row][]][]
    pots: [string, { eth: number; usd: number }][]
    payouts: Payout[]
    sessions: [string, string][]
    names: [string, string][]
    players: [
        string,
        {
            createdAt: number
            avatar: string | null
            equipped: [string, string][]
            data: [string, unknown][]
            items: [string, OwnedItem][]
        },
    ][]
    order: number
}

interface Row {
    name: string
    score: number
    meta: Record<string, unknown> | null
    address: string | null
    /** The order scores were reached in: of two equal scores, the first one ranks higher. */
    order: number
    updatedAt: number
}

/** What the mock keeps about one linked wallet. */
interface PlayerState {
    createdAt: number
    avatar: string | null
    equipped: Map<string, string>
    data: Map<string, unknown>
    items: Map<string, OwnedItem>
}

type ApiCode = keyof typeof CODE_STATUS

const fail = (status: number, error: string, code?: ApiCode): MockResponse => ({
    status,
    body: code ? { error, code } : { error },
})
const refuse = (code: ApiCode, error: string): MockResponse => fail(CODE_STATUS[code], error, code)
/** A broken rule from the shared checks, as the API answers it. */
const invalid = (problem: NonNullable<Problem>): MockResponse =>
    problem.code ? refuse(problem.code, problem.message) : fail(400, problem.message)
const ok = (body: unknown): MockResponse => ({ status: 200, body })
const isAnswer = (value: unknown): value is MockResponse => isRecord(value) && typeof value.status === 'number'
const shorten = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`
const token = (): string => globalThis.crypto.randomUUID().replaceAll('-', '')
const list = (value: string | null): string[] => (value === null || value === '' ? [] : value.split(','))

/** A made-up picture for a wallet or a name that has none: a disc in a colour of its own. */
function generatedAvatar(seed: string): string {
    let hash = 0
    for (const char of seed.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) % 0x1000000
    const colour = hash.toString(16).padStart(6, '0')
    return `data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="#${colour}"/></svg>`
    )}`
}

/** Whether value `a` ranks above `b` on a board; equal values do not. */
const isBetter = (sort: BoardSort, a: number, b: number): boolean => (sort === 'asc' ? a < b : a > b)

/** A board as the API keeps it: its periods in the API's order, `isPrize` always said, no empty extras. */
function storedBoard({ key, title, sort, mode, format, decimals, unit, periods, isPrize }: BoardDefinition) {
    const board: BoardDefinition = {
        key,
        title: title.trim(),
        sort,
        mode,
        format,
        ...(typeof decimals === 'number' ? { decimals } : {}),
        ...(unit ? { unit } : {}),
        periods: BOARD_PERIODS.filter((period) => periods.includes(period)),
        isPrize: isPrize === true,
    }
    return board
}

/** An uploaded picture as a URL the page can show with no server. */
function dataUrl(type: string, bytes: Uint8Array): string {
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return `data:${type};base64,${btoa(binary)}`
}

/**
 * An in-memory Game Center API with the same routes, rules, limits and error codes as fobo.fun's (docs/api-v1.md).
 */
export function createMockApi({
    config = {},
    writes: writesOption,
    scoreWrites,
    boards: firstBoards,
    items: firstItems = [],
    paysRewards = false,
    walletLink = true,
    holds = true,
    verify,
    now = Date.now,
    store,
}: MockApiOptions = {}) {
    const firstSettings = {
        game: 'test-game',
        title: 'Test Game',
        tokenAddress: '0x0000000000000000000000000000000000000001',
        ticker: 'TEST',
        holdMin: 100_000,
        shares: [60, 25, 15],
        ...config,
    }
    const settings = { ...firstSettings }
    const firstWrites = writesOption ?? scoreWrites ?? 'client'
    let writes = firstWrites
    const startProblem =
        (firstBoards ? boardsProblem(firstBoards) : null) ?? (firstItems.length ? itemsProblem(firstItems) : null)
    if (startProblem) throw new Error(startProblem.message)

    const toItem = (item: ItemInput): Item => ({ ...item, isStackable: item.isStackable ?? false })
    /**
     * A list of boards with 'main' always in it: left out, the one before stays, no longer the prize board when the
     * list names another.
     */
    const withMain = (sent: BoardDefinition[], main: BoardDefinition): BoardDefinition[] => {
        const boards = sent.map(storedBoard)
        if (boards.some((board) => board.key === MAIN_BOARD.key)) return boards
        const hasPrize = boards.some((board) => board.isPrize === true)
        return [storedBoard({ ...main, isPrize: main.isPrize === true && !hasPrize }), ...boards]
    }

    let boardList = withMain(firstBoards ?? [], MAIN_BOARD)
    const catalog = new Map<string, Item>(firstItems.map((item) => [item.key, toItem(item)]))
    /** Rows by board and period key. A board that is taken off the list keeps its rows here. */
    const scores = new Map<string, Map<string, Row>>()
    const pots = new Map<string, { eth: number; usd: number }>()
    const payouts: Payout[] = []
    const nonces = new Set<string>()
    const sessions = new Map<string, string>()
    const names = new Map<string, string>()
    const players = new Map<string, PlayerState>()
    let order = 0

    /** The host the signed link text names: the page's, or 'localhost' outside a browser. */
    const pageHost = typeof window === 'undefined' ? 'localhost' : window.location.host
    const seconds = () => Math.floor(now() / 1000)
    const today = () => new Date(now()).toISOString().slice(0, 10)
    const dayEndsAt = () => (Math.floor(seconds() / DAY_SECONDS) + 1) * DAY_SECONDS
    const nameOwner = (name: string) =>
        [...names].find(([, taken]) => taken.toLowerCase() === name.toLowerCase())?.[0] ?? null
    const findBoard = (key: string) => boardList.find((board) => board.key === key) ?? null
    const prizeBoard = () => boardList.find((board) => board.isPrize === true) ?? null

    const playerOf = (address: string): PlayerState => {
        const known = players.get(address)
        if (known) return known
        const fresh: PlayerState = {
            createdAt: seconds(),
            avatar: null,
            equipped: new Map(),
            data: new Map(),
            items: new Map(),
        }
        players.set(address, fresh)
        return fresh
    }
    const equippedOf = (address: string | null): Record<string, string> =>
        address === null ? {} : Object.fromEntries(playerOf(address).equipped)
    const avatarOf = (address: string): string => playerOf(address).avatar ?? generatedAvatar(address)
    /** The session a request carries, as the wallet it is for; null for one the mock never gave out. */
    const sessionWallet = (session: unknown): string | null =>
        typeof session === 'string' ? (sessions.get(session) ?? null) : null
    const profile = (address: string) => ({
        name: names.get(address) ?? null,
        avatar: avatarOf(address),
        avatarSource: playerOf(address).avatar === null ? 'generated' : 'game',
        isHolder: holds,
        equipped: equippedOf(address),
        createdAt: playerOf(address).createdAt,
    })

    const rowsOf = (board: string, key: string): Map<string, Row> => {
        const id = `${board}|${key}`
        const rows = scores.get(id) ?? new Map<string, Row>()
        scores.set(id, rows)
        return rows
    }
    const ranked = (board: BoardDefinition, key: string): Row[] =>
        [...rowsOf(board.key, key).values()].sort(
            (a, b) => (board.sort === 'asc' ? a.score - b.score : b.score - a.score) || a.order - b.order
        )
    const entry = (row: Row, index: number): BoardEntry => ({
        rank: index + 1,
        name: row.name,
        avatar: row.address === null ? generatedAvatar(row.name) : avatarOf(row.address),
        score: row.score,
        meta: row.meta,
        equipped: equippedOf(row.address),
        updatedAt: row.updatedAt,
        linked: row.address !== null,
    })
    const ranking = (board: BoardDefinition, period: BoardPeriod, day: string, name: string | null, limit: number) => {
        const key = periodKey(period, day)
        const rows = ranked(board, key)
        const mine = name ? rows.findIndex((row) => row.name.toLowerCase() === name.toLowerCase()) : -1
        const own = rows[mine]
        return {
            board: board.key,
            period,
            key,
            day,
            top: rows.slice(0, limit).map(entry),
            you: own ? entry(own, mine) : null,
        }
    }

    /** The period a board is read in when none is asked: 'daily', or its first when it keeps no daily. */
    const shownPeriod = (board: BoardDefinition): BoardPeriod =>
        board.periods.includes('daily') ? 'daily' : (board.periods[0] ?? 'all')

    const readBoard = (query: URLSearchParams): MockResponse => {
        const key = query.get('board') ?? MAIN_BOARD.key
        const asked = query.get('period')
        const day = query.get('at') ?? query.get('day') ?? today()
        const limit = query.has('limit') ? Number(query.get('limit')) : LIMITS.boardRows
        const board = boardKeyProblem(key) ? null : findBoard(key)
        if (!board) return refuse('unknown_board', `This game has no board "${key}"`)
        const period = asked === null || asked === '' ? shownPeriod(board) : (asked as BoardPeriod)
        if (periodProblem(period) || !board.periods.includes(period))
            return refuse('unknown_period', `The board "${key}" keeps no "${period}" ranking`)
        const problem = dayProblem(day) ?? limitProblem(limit)
        if (problem) return invalid(problem)
        return ok(ranking(board, period, day, query.get('name'), limit))
    }

    /**
     * A player's value after a post, by the board's mode; null when the post changes nothing (the row keeps its
     * place: of two equal values, the one reached first ranks higher), 'overflow' for a sum past what a number holds.
     */
    const scored = (board: BoardDefinition, before: number, score: number): number | null | 'overflow' => {
        if (board.mode === 'sum') {
            const sum = before + score
            if (!Number.isSafeInteger(sum)) return 'overflow'
            return sum === before ? null : sum
        }
        if (board.mode === 'latest') return score === before ? null : score
        return isBetter(board.sort, score, before) ? score : null
    }

    const postScore = (body: Record<string, unknown>, isServer: boolean, headerSession?: string): MockResponse => {
        if (writes === 'server' && !isServer)
            return refuse('server_writes_only', 'Scores for this game are written by its server')
        const { name, score, meta } = body
        const session = body.session ?? headerSession
        const key = body.board ?? MAIN_BOARD.key
        const problem = nameProblem(name) ?? scoreProblem(score) ?? metaProblem(meta)
        if (problem) return invalid(problem)
        const hasSession = session !== undefined && session !== null
        const address = hasSession ? sessionWallet(session) : null
        if (hasSession && address === null) return fail(401, 'Session expired')
        const board = typeof key === 'string' && !boardKeyProblem(key) ? findBoard(key) : null
        if (!board) return refuse('unknown_board', `This game has no board "${String(key)}"`)
        const posted = score as number
        if (board.mode === 'sum' && posted < 1) return fail(400, 'A score added to a sum board must be above 0')
        // a wallet plays under its username; until it has one the posted name becomes it
        const username = address === null ? null : (names.get(address) ?? null)
        const played = username ?? (name as string)
        if (username === null && nameOwner(played) !== null) return fail(409, 'That name is taken')
        const day = today()
        const writesTo: { rows: Map<string, Row>; score: number }[] = []
        for (const [index, period] of board.periods.entries()) {
            const rows = rowsOf(board.key, periodKey(period, day))
            const before = rows.get(played.toLowerCase())
            if (before && before.address !== null && before.address !== address) {
                // another wallet's row: a conflict in the board's first period, left alone in its longer ones
                if (index === 0) return fail(409, 'That name is taken')
                continue
            }
            if (before && before.address === null && address !== null) {
                // a row nobody linked is taken over only by a better value
                if (isBetter(board.sort, posted, before.score)) writesTo.push({ rows, score: posted })
                continue
            }
            const next = before ? scored(board, before.score, posted) : posted
            if (next === 'overflow') return fail(400, 'This total is past what a board can hold')
            if (next !== null) writesTo.push({ rows, score: next })
        }
        for (const write of writesTo) {
            write.rows.set(played.toLowerCase(), {
                name: played,
                score: write.score,
                meta: isRecord(meta) ? meta : null,
                address,
                order: order++,
                updatedAt: seconds(),
            })
        }
        if (address !== null && username === null) names.set(address, played)
        return ok(ranking(board, shownPeriod(board), day, played, LIMITS.boardRows))
    }

    const winners = (day: string) => {
        const board = prizeBoard()
        const linked =
            holds && board?.periods.includes('daily')
                ? ranked(board, periodKey('daily', day)).flatMap((row) =>
                      row.address === null ? [] : [{ name: names.get(row.address) ?? row.name, address: row.address }]
                  )
                : []
        const places = settings.shares.slice(0, linked.length).flatMap((sharePct, index) => {
            const row = linked[index]
            return row ? [{ place: index + 1, ...row, sharePct }] : []
        })
        const unclaimedPct = settings.shares.slice(places.length).reduce((sum, share) => sum + share, 0)
        return { day, winners: places, unclaimedPct }
    }

    const link = async (body: Record<string, unknown>, host: string): Promise<MockResponse> => {
        const { address, signature, nonce } = body
        if (typeof address !== 'string' || !ADDRESS_PATTERN.test(address)) return fail(400, 'Bad address')
        if (typeof signature !== 'string' || !HEX_PATTERN.test(signature)) return fail(400, 'Bad signature')
        if (typeof nonce !== 'string' || !LINK_NONCE_PATTERN.test(nonce)) return fail(400, 'Bad nonce')
        let isValid = true
        try {
            // a verifier that cannot read the signature at all says the same as one that reads a wrong one
            if (verify) isValid = await verify({ address, signature, message: linkMessage(host, nonce) })
        } catch {
            isValid = false
        }
        if (!isValid) return fail(401, 'Bad signature')
        // spent only by a valid signature, so a bad try cannot burn a player's nonce
        if (!nonces.delete(nonce)) return fail(401, 'Link expired, try again')
        const wallet = address.toLowerCase()
        const session = token()
        sessions.set(session, wallet)
        playerOf(wallet)
        return ok({ session, address: wallet, name: names.get(wallet) ?? null, holds, holdMin: settings.holdMin })
    }

    /** A wallet's rows in the periods open now take its new username; a period where another row has it is left. */
    const renameRows = (address: string, name: string): void => {
        const day = today()
        for (const board of boardList) {
            for (const period of board.periods) {
                const periodId = periodKey(period, day)
                const rows = rowsOf(board.key, periodId)
                const holder = rows.get(name.toLowerCase())
                if (holder && holder.address !== address) continue
                const [best] = ranked(board, periodId).filter((row) => row.address === address)
                if (!best) continue
                for (const [key, row] of rows) if (row.address === address) rows.delete(key)
                rows.set(name.toLowerCase(), { ...best, name })
            }
        }
    }

    /** Whether a name is on today's rankings under a row that is not this wallet's. */
    const isPlayedToday = (name: string, address: string): boolean =>
        boardList.some((board) => {
            const row = rowsOf(board.key, periodKey('daily', today())).get(name.toLowerCase())
            return row !== undefined && row.address !== address
        })

    const player = (body: Record<string, unknown>, headerSession?: string): MockResponse => {
        const session = typeof body.session === 'string' ? body.session : headerSession
        if (!session) return fail(400, 'session is required')
        const address = sessionWallet(session)
        if (address === null) return fail(401, 'Session expired')
        if (body.name !== undefined && body.name !== null) {
            const problem = nameProblem(body.name)
            if (problem) return invalid(problem)
            const name = body.name as string
            const owner = nameOwner(name)
            if ((owner !== null && owner !== address) || isPlayedToday(name, address))
                return fail(409, 'That name is taken')
            names.set(address, name)
            renameRows(address, name)
        }
        return ok({ address: shorten(address), name: names.get(address) ?? null, holds, holdMin: settings.holdMin })
    }

    /** A paid prize as the API answers it: under the wallet's username now, else the name it played under that day. */
    const payoutName = (day: string, address: string): string | null => {
        const username = names.get(address)
        if (username !== undefined) return username
        for (const board of boardList) {
            for (const row of rowsOf(board.key, periodKey('daily', day)).values())
                if (row.address === address) return row.name
        }
        return null
    }

    const recordPayout = (body: Record<string, unknown>): MockResponse => {
        const { day = today(), place, address, amountWei, txHash } = body
        const problem = dayProblem(day)
        if (problem) return invalid(problem)
        const places = settings.shares.length
        if (typeof place !== 'number' || !Number.isInteger(place) || place < 1 || place > places)
            return fail(400, `place must be 1-${places}`)
        if (typeof address !== 'string' || !ADDRESS_PATTERN.test(address))
            return fail(400, 'address must be a 0x address')
        if (typeof amountWei !== 'string' || !WEI_PATTERN.test(amountWei))
            return fail(400, 'amountWei must be a decimal string')
        if (typeof txHash !== 'string' || !TX_HASH_PATTERN.test(txHash))
            return fail(400, 'txHash must be a transaction hash')
        const hash = txHash.toLowerCase()
        // once per transaction: a repeat changes nothing
        if (!payouts.some((payout) => payout.txHash === hash)) {
            payouts.unshift({
                day: day as string,
                place,
                name: null,
                address: address.toLowerCase(),
                amountWei,
                txHash: hash,
                at: seconds(),
            })
        }
        return ok(listedPayouts().find((payout) => payout.txHash === hash))
    }

    /** The recorded payouts, newest first, each under its wallet's name now. */
    const listedPayouts = (): Payout[] =>
        payouts
            .map((payout) => ({ ...payout, name: payoutName(payout.day, payout.address) }))
            .sort((a, b) => b.at - a.at || a.place - b.place)

    const readPayouts = (query: URLSearchParams): MockResponse => {
        const asked = query.get('limit')
        const limit = asked === null || asked === '' ? PAYOUTS_DEFAULT : Number(asked)
        if (!Number.isInteger(limit) || limit < 1) return fail(400, `limit must be 1-${PAYOUTS_MAX}`)
        return ok({ payouts: listedPayouts().slice(0, Math.min(limit, PAYOUTS_MAX)) })
    }

    const setPot = (body: Record<string, unknown>): MockResponse => {
        const { day = today(), eth, usd } = body
        const amount = (value: unknown): number | null => {
            const read = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
            return typeof read === 'number' && Number.isFinite(read) && read >= 0 ? read : null
        }
        const problem = dayProblem(day)
        if (problem) return invalid(problem)
        const pot = { eth: amount(eth), usd: amount(usd) }
        if (pot.eth === null || pot.usd === null) return fail(400, 'eth and usd must be non-negative numbers')
        pots.set(day as string, { eth: pot.eth, usd: pot.usd })
        return readPot(day as string)
    }

    const readPot = (day: string): MockResponse => {
        const problem = dayProblem(day)
        if (problem) return invalid(problem)
        const endsAt = Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000) + DAY_SECONDS
        return ok({ day, eth: 0, usd: 0, ...pots.get(day), endsAt })
    }

    const gameSettings = () => ({
        title: settings.title,
        holdMin: settings.holdMin,
        shares: settings.shares,
        writes,
        paysRewards,
        walletLink,
        boards: boardList,
        items: [...catalog.values()],
    })

    const configure = (body: Record<string, unknown>): MockResponse => {
        const problem = settingsProblem(body)
        if (problem) return invalid(problem)
        if (typeof body.title === 'string') settings.title = body.title
        if (body.holdMin !== undefined) settings.holdMin = Number(body.holdMin)
        if (Array.isArray(body.shares)) settings.shares = body.shares as number[]
        if (body.writes === 'client' || body.writes === 'server') writes = body.writes
        return ok(gameSettings())
    }

    const defineBoards = (body: Record<string, unknown>): MockResponse => {
        const problem = boardsProblem(body.boards)
        if (problem) return invalid(problem)
        boardList = withMain(body.boards as BoardDefinition[], findBoard(MAIN_BOARD.key) ?? MAIN_BOARD)
        return ok({ boards: boardList })
    }

    const defineItems = (body: Record<string, unknown>): MockResponse => {
        const problem = itemsProblem(body.items)
        if (problem) return invalid(problem)
        const items = body.items as ItemInput[]
        const added = items.filter((item) => !catalog.has(item.key)).length
        if (catalog.size + added > LIMITS.items) return fail(400, `A game has at most ${LIMITS.items} items`)
        for (const item of items) {
            const before = catalog.get(item.key)
            catalog.set(item.key, toItem(item))
            // an item moved to another slot (or to none) leaves the slots players had it in
            if (before?.slot === undefined || before.slot === item.slot) continue
            for (const state of players.values()) {
                for (const [slot, worn] of state.equipped)
                    if (worn === item.key && slot !== item.slot) state.equipped.delete(slot)
            }
        }
        return ok({ items: [...catalog.values()] })
    }

    const removeItem = (key: string): MockResponse => {
        if (!catalog.delete(key)) return refuse('unknown_item', `This game has no item "${key}"`)
        for (const state of players.values()) {
            state.items.delete(key)
            for (const [slot, worn] of state.equipped) if (worn === key) state.equipped.delete(slot)
        }
        return ok({ items: [...catalog.values()] })
    }

    const readData = (address: string, query: URLSearchParams): MockResponse => {
        const keys = list(query.get('keys'))
        const problem = dataKeysProblem(keys)
        if (problem) return invalid(problem)
        const data = playerOf(address).data
        return ok({ data: Object.fromEntries(keys.length ? [...data].filter(([key]) => keys.includes(key)) : data) })
    }

    const writeData = (address: string, body: Record<string, unknown>): MockResponse => {
        const { set, remove } = body
        // nothing to set is fine: the answer is the player's data as it is
        const hasValues = set !== undefined && !(isRecord(set) && Object.keys(set).length === 0)
        const problem =
            (hasValues ? dataValuesProblem(set) : null) ?? (remove === undefined ? null : dataKeysProblem(remove))
        if (problem) return invalid(problem)
        // on a copy first: a write that would break a limit changes nothing
        const next = new Map(playerOf(address).data)
        for (const key of (remove as string[] | undefined) ?? []) next.delete(key)
        for (const [key, value] of Object.entries((set as Record<string, unknown> | undefined) ?? {}))
            next.set(key, value)
        const total = dataTotalProblem(Object.fromEntries(next))
        if (total) return invalid(total)
        playerOf(address).data = next
        return ok({ data: Object.fromEntries(next) })
    }

    const grant = (address: string, body: Record<string, unknown>): MockResponse => {
        const { item: key, qty = 1, meta } = body
        if (typeof key !== 'string' || key === '') return fail(400, 'item is required')
        const problem = qtyProblem(qty) ?? itemMetaProblem(meta)
        if (problem) return invalid(problem)
        const item = catalog.get(key)
        if (!item) return refuse('unknown_item', `This game has no item "${key}"`)
        const owned = playerOf(address).items
        const before = owned.get(item.key)
        if (before && !item.isStackable) return refuse('already_owned', `The player already owns "${item.key}"`)
        const total = (before?.qty ?? 0) + (qty as number)
        const most = item.isStackable ? (item.maxQty ?? Number.MAX_SAFE_INTEGER) : 1
        if (total > most) return refuse('over_max', `A player can own at most ${most} of "${item.key}"`)
        const kept = isRecord(meta) ? meta : before?.meta
        const next: OwnedItem = {
            key: item.key,
            qty: total,
            ...(kept ? { meta: kept } : {}),
            acquiredAt: before?.acquiredAt ?? seconds(),
        }
        owned.set(item.key, next)
        return ok({ item: next })
    }

    const consume = (address: string, body: Record<string, unknown>): MockResponse => {
        const { item: key, qty = 1 } = body
        if (typeof key !== 'string' || key === '') return fail(400, 'item is required')
        const problem = qtyProblem(qty)
        if (problem) return invalid(problem)
        if (!catalog.has(key)) return refuse('unknown_item', `This game has no item "${key}"`)
        const state = playerOf(address)
        const before = state.items.get(key)
        if (!before || before.qty < (qty as number))
            return refuse('not_enough', `The player does not own enough of "${key}"`)
        const left = before.qty - (qty as number)
        if (left > 0) {
            const next = { ...before, qty: left }
            state.items.set(key, next)
            return ok({ item: next })
        }
        state.items.delete(key)
        for (const [slot, worn] of state.equipped) if (worn === key) state.equipped.delete(slot)
        return ok({ item: null })
    }

    const equip = (address: string, body: Record<string, unknown>): MockResponse => {
        const { slot, item: key } = body
        const problem = slotProblem(slot)
        if (problem) return invalid(problem)
        const state = playerOf(address)
        if (key === null) {
            state.equipped.delete(slot as string)
            return ok(profile(address))
        }
        if (typeof key !== 'string') return fail(400, 'item must be an item key, or null to empty the slot')
        const item = catalog.get(key)
        if (!item) return refuse('unknown_item', `This game has no item "${key}"`)
        if (item.slot === undefined || item.slot !== slot)
            return refuse('wrong_slot', `"${item.key}" does not go in the slot "${String(slot)}"`)
        if (!state.items.has(item.key)) return refuse('not_enough', `The player does not own "${item.key}"`)
        state.equipped.set(item.slot, item.key)
        return ok(profile(address))
    }

    /** Whether the bytes start as a PNG, JPEG, GIF or WebP does (the real API decodes the whole image). */
    const isImage = (bytes: Uint8Array): boolean =>
        IMAGE_STARTS.some((start) => start.every((byte, index) => byte === null || bytes[index] === byte))

    const setAvatar = (address: string, type: string | undefined, body: unknown): MockResponse => {
        if (!(body instanceof Uint8Array)) return fail(400, 'Send the image as the request body')
        const problem = avatarProblem(type?.split(';')[0]?.trim(), body.length)
        if (problem) return invalid(problem)
        if (!isImage(body)) return fail(400, 'That file is not an image')
        playerOf(address).avatar = dataUrl(type?.split(';')[0]?.trim() ?? '', body)
        return ok(profile(address))
    }

    /** Answers one API request. */
    const route = async ({
        method,
        path,
        query = new URLSearchParams(),
        headers = {},
        body,
        host = pageHost,
        isServer: isTrusted = false,
    }: MockRequest): Promise<MockResponse> => {
        const header = (name: string) =>
            Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
        if (header(KEY_HEADER) !== TEST_PUBLIC_KEY) return fail(401, 'Unknown game key')
        const [scheme, key] = (header('Authorization') ?? '').split(' ')
        const isServer = isTrusted || (scheme === 'Bearer' && key === TEST_SECRET_KEY)
        const data = isRecord(body) ? body : {}
        const day = query.get('day') ?? today()

        /** The linked player a session speaks for. */
        const bySession = (): string | MockResponse =>
            sessionWallet(header(SESSION_HEADER)) ?? fail(401, 'Session expired')
        /** The player a request acts for: the session's, or with the secret key the player it names. */
        const actor = (): string | MockResponse => {
            const named = data.player ?? query.get('player')
            if (named === null || named === undefined || named === '') {
                if (isServer && !header(SESSION_HEADER)) return fail(400, 'player is required: the username to act for')
                return bySession()
            }
            if (!isServer) return fail(401, 'Acting for a player by name needs the secret key')
            const problem = nameProblem(named)
            if (problem) return invalid(problem)
            return (
                nameOwner(named as string) ??
                refuse('unknown_player', `No player named "${named as string}" in this game`)
            )
        }
        /** Runs a route for a player, or answers why there is none. */
        const forPlayer = (who: string | MockResponse, run: (address: string) => MockResponse): MockResponse =>
            isAnswer(who) ? who : run(who)
        /** Item writes: a page may only make them while the game trusts its pages. */
        const itemWrite = (run: (address: string) => MockResponse): MockResponse =>
            writes === 'server' && !isServer
                ? refuse('server_writes_only', 'Items for this game are changed by its server')
                : forPlayer(actor(), run)
        const secret = (run: () => MockResponse): MockResponse => (isServer ? run() : fail(401, 'Secret key required'))

        if (method === 'DELETE' && path.startsWith('/items/'))
            return secret(() => removeItem(decodeURIComponent(path.slice('/items/'.length))))

        switch (`${method} ${path}`) {
            case 'GET /config':
                return ok({
                    ...settings,
                    writes,
                    scoreWrites: writes,
                    boards: boardList,
                    apiVersion: API_VERSION,
                    paysRewards,
                    dayEndsAt: dayEndsAt(),
                })
            case 'GET /game':
                return secret(() => ok(gameSettings()))
            case 'PUT /game':
                return secret(() => configure(data))
            case 'PUT /boards':
                return secret(() => defineBoards(data))
            case 'GET /board':
                return readBoard(query)
            case 'POST /scores':
                return postScore(data, isServer, header(SESSION_HEADER))
            case 'GET /pot':
                return readPot(day)
            case 'POST /pot':
                return secret(() => setPot(data))
            case 'GET /winners': {
                const problem = dayProblem(day)
                return problem ? invalid(problem) : ok(winners(day))
            }
            case 'GET /payouts':
                return readPayouts(query)
            case 'POST /payouts':
                return secret(() => recordPayout(data))
            case 'GET /link/nonce': {
                const nonce = token()
                nonces.add(nonce)
                return ok({ nonce })
            }
            case 'POST /link':
                return link(data, host)
            case 'POST /player':
                return player(data, header(SESSION_HEADER))
            case 'GET /player':
                return forPlayer(bySession(), (address) => ok(profile(address)))
            case 'POST /player/avatar':
                return forPlayer(bySession(), (address) => setAvatar(address, header('Content-Type'), body))
            case 'DELETE /player/avatar':
                return forPlayer(bySession(), (address) => {
                    playerOf(address).avatar = null
                    return ok(profile(address))
                })
            case 'GET /players': {
                // each name once, whatever its case
                const asked = [...new Map(list(query.get('names')).map((name) => [name.toLowerCase(), name])).values()]
                const problem = namesProblem(asked)
                if (problem) return invalid(problem)
                // every name gets an answer: one no wallet has gets the face made from the name
                const found = asked.map((name) => {
                    const address = nameOwner(name)
                    return address === null
                        ? { name, avatar: generatedAvatar(name), equipped: {} }
                        : { name: names.get(address) ?? name, avatar: avatarOf(address), equipped: equippedOf(address) }
                })
                return ok({ players: found })
            }
            case 'GET /player/data':
                return forPlayer(actor(), (address) => readData(address, query))
            case 'PUT /player/data':
                return forPlayer(actor(), (address) => writeData(address, data))
            case 'GET /items':
                return ok({ items: [...catalog.values()] })
            case 'PUT /items':
                return secret(() => defineItems(data))
            case 'GET /player/items':
                return forPlayer(actor(), (address) => ok({ items: [...playerOf(address).items.values()] }))
            case 'POST /player/items/grant':
                return itemWrite((address) => grant(address, data))
            case 'POST /player/items/consume':
                return itemWrite((address) => consume(address, data))
            case 'POST /player/equip':
                return forPlayer(bySession(), (address) => equip(address, data))
            default:
                return fail(404, 'Not found')
        }
    }

    /** What a fetch body is to the mock: parsed JSON, or an upload's bytes. */
    const readBody = async (body: BodyInit | null | undefined): Promise<unknown> => {
        if (typeof body === 'string') return parseJson(body)
        if (body instanceof Uint8Array) return body
        if (body instanceof ArrayBuffer) return new Uint8Array(body)
        if (typeof Blob !== 'undefined' && body instanceof Blob) return new Uint8Array(await body.arrayBuffer())
        return undefined
    }

    const snapshot = (): MockSnapshot => ({
        version: SNAPSHOT_VERSION,
        settings: { title: settings.title, holdMin: settings.holdMin, shares: settings.shares },
        writes,
        boards: boardList,
        items: [...catalog.values()],
        scores: [...scores].map(([id, rows]) => [id, [...rows]]),
        pots: [...pots],
        payouts,
        sessions: [...sessions],
        names: [...names],
        players: [...players].map(([address, player]) => [
            address,
            {
                createdAt: player.createdAt,
                avatar: player.avatar,
                equipped: [...player.equipped],
                data: [...player.data],
                items: [...player.items],
            },
        ]),
        order,
    })

    /**
     * Takes up where a kept snapshot left off. What players did always comes back; the game's own setup (boards,
     * items, settings, who writes) only where this mock was not given one, so a change in your code wins.
     */
    const restore = (kept: MockSnapshot): void => {
        if (config.title === undefined) settings.title = kept.settings.title
        if (config.holdMin === undefined) settings.holdMin = kept.settings.holdMin
        if (config.shares === undefined) settings.shares = kept.settings.shares
        if (writesOption === undefined && scoreWrites === undefined) writes = kept.writes
        if (!firstBoards) boardList = withMain(kept.boards, MAIN_BOARD)
        if (!firstItems.length) for (const item of kept.items) catalog.set(item.key, item)
        for (const [id, rows] of kept.scores) scores.set(id, new Map(rows))
        for (const [day, pot] of kept.pots) pots.set(day, pot)
        payouts.push(...kept.payouts)
        for (const [session, address] of kept.sessions) sessions.set(session, address)
        for (const [address, name] of kept.names) names.set(address, name)
        for (const [address, player] of kept.players) {
            players.set(address, {
                createdAt: player.createdAt,
                avatar: player.avatar,
                equipped: new Map(player.equipped),
                data: new Map(player.data),
                items: new Map(player.items),
            })
        }
        order = kept.order
    }

    /** Back to how the mock started: every score, player, item and pot forgotten (and its store emptied). */
    const reset = (): void => {
        Object.assign(settings, firstSettings)
        writes = firstWrites
        boardList = withMain(firstBoards ?? [], MAIN_BOARD)
        catalog.clear()
        for (const item of firstItems) catalog.set(item.key, toItem(item))
        for (const kept of [scores, pots, nonces, sessions, names, players]) kept.clear()
        payouts.length = 0
        order = 0
        store?.set(null)
    }

    const kept = store?.get() ?? null
    if (kept) {
        try {
            if (kept.version !== SNAPSHOT_VERSION) throw new Error(`version ${String(kept.version)}`)
            restore(kept)
        } catch (err) {
            // test data from another version of the SDK, or edited by hand: start clean instead of half-restored
            console.error('[fobo-game] reading test data', errorMessage(err))
            reset()
        }
    }

    /** Answers one API request, and keeps what it changed. */
    const handle = async (request: MockRequest): Promise<MockResponse> => {
        const answer = await route(request)
        if (store && request.method !== 'GET' && answer.status < 400) store.set(snapshot())
        return answer
    }

    /** A fetch that never leaves the page: pass it to createGame or createServerClient. */
    const answerFetch = async (isServer: boolean, input: string, init: Parameters<FetchLike>[1] = {}) => {
        const url = new URL(input)
        const path = url.pathname.startsWith(API_BASE) ? url.pathname.slice(API_BASE.length) : url.pathname
        const headers = Object.fromEntries(new Headers(init.headers).entries())
        const body = await readBody(init.body)
        const request = { method: init.method ?? 'GET', path, query: url.searchParams, headers, body, isServer }
        const answer = await handle(request)
        return new Response(JSON.stringify(answer.body), {
            status: answer.status,
            headers: { 'Content-Type': 'application/json' },
        })
    }

    const fetch: FetchLike = (input, init) => answerFetch(false, input, init)
    /**
     * The same fetch, speaking as the game's own server with no secret key. The test game's verifier uses it, so
     * nothing that can send a secret key is ever part of a page.
     */
    const serverFetch: FetchLike = (input, init) => answerFetch(true, input, init)

    return { handle, fetch, serverFetch, reset, host: pageHost }
}

export type MockApi = ReturnType<typeof createMockApi>

/** A connector that "signs" as TEST_ADDRESS with no wallet at all. Only the mock API accepts it. */
export function testConnector(address: string = TEST_ADDRESS): Connector {
    return {
        sign: (message) => {
            if (!LINK_NONCE_PATTERN.test(message.split('Nonce: ')[1] ?? ''))
                return Promise.reject(new Error('Not a link message'))
            return Promise.resolve({ address, signature: `0x${'00'.repeat(65)}` })
        },
    }
}

/** What a test game's Game Center starts with (createGame's `test`, and createTestGame). */
export interface TestOptions<I = unknown> extends MockApiOptions {
    /**
     * Your replay function, to try the anti-cheat flow offline: the test game then gets a verifier of its own
     * (game.startRun() and game.submitRun() go through it) and its `writes` is 'server' unless you say otherwise.
     */
    replay?: Replay<I>
    /**
     * Keep the test data in the browser's localStorage, so it survives a page reload. createGame() with no key
     * does; createTestGame does not unless asked (a test wants a clean start). Outside a browser nothing is kept.
     */
    persist?: boolean
}

export interface TestGameOptions<I = unknown> extends TestOptions<I> {
    /** Anything createGame takes (a connector...). */
    game?: Partial<Omit<GameOptions, 'apiKey' | 'apiUrl' | 'fetch' | 'test'>>
}

/** The server's calls on a mock, with no secret key at all: this one may live in a page. */
const mockServer = (api: MockApi): ServerClient =>
    buildServerApi(
        createCaller({ apiUrl: TEST_API_URL, headers: { [KEY_HEADER]: TEST_PUBLIC_KEY }, fetch: api.serverFetch })
    )

/**
 * The game's server client for tests, wired to a mock Game Center instead of fobo.fun: no secret key, no network.
 * This is the only test mode a server has, and it is never chosen for you: createServerClient with no secretKey
 * throws.
 * @param api the mock to talk to (share one with a test game's `fetch` to see both sides); a fresh one by default
 */
export function createTestServer(api: MockApi = createMockApi()): ServerClient {
    return mockServer(api)
}

/**
 * A test game: the real client on a Game Center that lives in the page.
 * @param game what createGame was given (its connector, storageKey...)
 * @param test what the test Game Center starts with
 */
export function buildTestGame<I = unknown>(
    game: Partial<Omit<GameOptions, 'apiKey' | 'apiUrl' | 'fetch' | 'test'>>,
    { replay, persist = false, ...mock }: TestOptions<I> = {}
): Game {
    const hasOwnWrites = mock.writes !== undefined || mock.scoreWrites !== undefined
    const store =
        mock.store ??
        (persist && hasBrowserStorage()
            ? browserStore<MockSnapshot>(`${game.storageKey ?? TEST_STORAGE_KEY}:data`)
            : undefined)
    const api = createMockApi({ ...mock, ...(replay && !hasOwnWrites ? { writes: 'server' } : {}), store })
    const options = { connector: testConnector(), ...game, apiKey: TEST_PUBLIC_KEY, apiUrl: TEST_API_URL }
    let fetch = api.fetch
    if (replay) {
        const verifier = createVerifier<I>({ server: mockServer(api), replay, now: mock.now })
        fetch = (input, init) =>
            input === TEST_VERIFY_URL ? verifier.handle(new Request(input, init)) : api.fetch(input, init)
    }
    const built = buildGame(
        { ...options, ...(replay ? { verifyUrl: TEST_VERIFY_URL } : {}), fetch },
        { host: api.host }
    )
    return {
        ...built,
        isTest: true,
        resetTestData: () => {
            api.reset()
            built.wallet.unlink()
        },
    }
}

/**
 * A game wired to an in-memory Game Center: no key, no network, no wallet. Boards, scores, linking, names, saved
 * data, items, pots and winners all work. It is what `createGame()` with no `apiKey` gives you, with a clean
 * start every time (nothing kept between page loads unless you pass `persist: true`).
 */
export function createTestGame<I = unknown>({ game = {}, ...test }: TestGameOptions<I> = {}): Game {
    return buildTestGame(game, test)
}
