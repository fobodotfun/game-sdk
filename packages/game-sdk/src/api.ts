import { readBoard, readConfig, readOwned, readPayout, readPlayer, readPot, readWinners } from './convert.js'
import { requestJson, type FetchLike, type HttpMethod, type RawBody } from './http.js'
import { API_BASE, KEY_HEADER, SDK_HEADER, SESSION_HEADER } from './protocol.js'
import type {
    Board,
    BoardPeriod,
    GameConfig,
    Item,
    LinkedPlayer,
    OwnedItem,
    Payout,
    Player,
    Pot,
    PublicPlayer,
    SavedData,
    ScoreInput,
    SignedMessage,
    Winners,
} from './types.js'
import { SDK_AGENT } from './version.js'

export interface ApiOptions {
    apiKey: string
    apiUrl: string
    fetch?: FetchLike
    timeoutMs?: number
}

/** A fresh link: the session to keep, and the player behind it. */
export interface LinkedSession {
    session: string
    address: string
    name: string | null
    holds: boolean | null
}

/** Which ranking to read. */
export interface BoardQuery {
    /** The board's key. Default: 'main'. */
    board?: string
    /** Default: 'daily'. */
    period?: BoardPeriod
    /** Any UTC day (YYYY-MM-DD) inside the period you want. Default: today. */
    at?: string
    /** The same as `at`. */
    day?: string
    /** How many rows (1-100, default 20). */
    limit?: number
    /** Also answer with this player's own row (`you`). */
    name?: string | null
}

type QueryValue = string | number | readonly string[] | null | undefined
type Query = Record<string, QueryValue>

function queryString(params: Query): string {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
        const text = Array.isArray(value) ? value.join(',') : value
        if (text !== undefined && text !== null && text !== '') search.set(key, String(text))
    }
    const text = search.toString()
    return text ? `?${text}` : ''
}

export interface CallOptions {
    query?: Query
    body?: unknown
    raw?: RawBody
    /** The linked player's session, for the routes that act for one player. */
    session?: string | null
}

/** One API request: method, path under the API base, and what to send. */
export type Call = <T>(method: HttpMethod, path: string, options?: CallOptions) => Promise<T>

export interface CallerOptions {
    /** The API's site (an origin). */
    apiUrl: string
    /** The key headers every request carries. */
    headers: Record<string, string>
    fetch?: FetchLike
    timeoutMs?: number
}

/** How every API request is made, for a page (public key) and for a server (secret key) alike. */
export function createCaller({ apiUrl, headers, fetch, timeoutMs }: CallerOptions): Call {
    const base = apiUrl.replace(/\/+$/, '') + API_BASE
    return <T>(method: HttpMethod, path: string, { query = {}, body, raw, session }: CallOptions = {}) =>
        requestJson<T>(base + path + queryString(query), {
            method,
            headers: { ...headers, [SDK_HEADER]: SDK_AGENT, ...(session ? { [SESSION_HEADER]: session } : {}) },
            body,
            raw,
            fetch,
            timeoutMs,
        })
}

/** The answers that are the same whoever asks: read once here, for the page's API and the server's. */
export const answers = {
    board: async (answer: Promise<Board>): Promise<Board> => readBoard(await answer),
    player: async (answer: Promise<Player>): Promise<Player> => readPlayer(await answer),
    data: async (answer: Promise<{ data: SavedData }>): Promise<SavedData> => (await answer).data,
    items: async (answer: Promise<{ items: Item[] }>): Promise<Item[]> => (await answer).items,
    owned: async (answer: Promise<{ item: OwnedItem | null }>): Promise<OwnedItem | null> => {
        const { item } = await answer
        return item ? readOwned(item) : null
    },
    payouts: async (answer: Promise<{ payouts: Payout[] }>): Promise<{ payouts: Payout[] }> => ({
        payouts: (await answer).payouts.map(readPayout),
    }),
}

/** The Game Center API as a game's pages see it (public key only). */
export function createApi({ apiKey, apiUrl, fetch, timeoutMs }: ApiOptions) {
    const call = createCaller({ apiUrl, headers: { [KEY_HEADER]: apiKey }, fetch, timeoutMs })

    return {
        async config(): Promise<GameConfig> {
            return readConfig(await call<GameConfig>('GET', '/config'))
        },
        board({ board, period, at, day, limit, name }: BoardQuery = {}): Promise<Board> {
            // `at` goes out as `day` too: an API from before boards only reads `day`, and would answer with today
            return answers.board(
                call<Board>('GET', '/board', { query: { board, period, at, day: day ?? at, limit, name } })
            )
        },
        submitScore(score: ScoreInput & { session?: string }): Promise<Board> {
            return answers.board(call<Board>('POST', '/scores', { body: score }))
        },
        async pot(): Promise<Pot> {
            return readPot(await call<Pot>('GET', '/pot'))
        },
        async winners(day?: string): Promise<Winners> {
            return readWinners(await call<Winners>('GET', '/winners', { query: { day } }))
        },
        payouts(limit?: number): Promise<{ payouts: Payout[] }> {
            return answers.payouts(call<{ payouts: Payout[] }>('GET', '/payouts', { query: { limit } }))
        },
        async nonce(): Promise<string> {
            const { nonce } = await call<{ nonce: string }>('GET', '/link/nonce')
            return nonce
        },
        link(signed: SignedMessage & { nonce: string }): Promise<LinkedSession> {
            return call<LinkedSession>('POST', '/link', { body: signed })
        },
        /** The wallet behind a session; with `name`, sets its username first. */
        player(body: { session: string; name?: string }): Promise<LinkedPlayer> {
            return call<LinkedPlayer>('POST', '/player', { body })
        },
        profile(session: string): Promise<Player> {
            return answers.player(call<Player>('GET', '/player', { session }))
        },
        setAvatar(session: string, raw: RawBody): Promise<Player> {
            return answers.player(call<Player>('POST', '/player/avatar', { session, raw }))
        },
        removeAvatar(session: string): Promise<Player> {
            return answers.player(call<Player>('DELETE', '/player/avatar', { session }))
        },
        async players(names: readonly string[]): Promise<PublicPlayer[]> {
            const { players } = await call<{ players: PublicPlayer[] }>('GET', '/players', { query: { names } })
            return players
        },
        data(session: string, keys?: readonly string[]): Promise<SavedData> {
            return answers.data(call<{ data: SavedData }>('GET', '/player/data', { session, query: { keys } }))
        },
        writeData(session: string, body: { set?: SavedData; remove?: readonly string[] }): Promise<SavedData> {
            return answers.data(call<{ data: SavedData }>('PUT', '/player/data', { session, body }))
        },
        items(): Promise<Item[]> {
            return answers.items(call<{ items: Item[] }>('GET', '/items'))
        },
        async ownedItems(session: string): Promise<OwnedItem[]> {
            const { items } = await call<{ items: OwnedItem[] }>('GET', '/player/items', { session })
            return items.map(readOwned)
        },
        grantItem(
            session: string,
            body: { item: string; qty?: number; meta?: Record<string, unknown> }
        ): Promise<OwnedItem | null> {
            return answers.owned(call<{ item: OwnedItem | null }>('POST', '/player/items/grant', { session, body }))
        },
        consumeItem(session: string, body: { item: string; qty?: number }): Promise<OwnedItem | null> {
            return answers.owned(call<{ item: OwnedItem | null }>('POST', '/player/items/consume', { session, body }))
        },
        equip(session: string, body: { slot: string; item: string | null }): Promise<Player> {
            return answers.player(call<Player>('POST', '/player/equip', { session, body }))
        },
    }
}

export type Api = ReturnType<typeof createApi>
