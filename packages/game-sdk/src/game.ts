import { createApi, type BoardQuery } from './api.js'
import { injectedConnector } from './connectors.js'
import { GameError } from './errors.js'
import { FrameHost, isFramedByAnotherSite } from './frame.js'
import { requestJson, type FetchLike } from './http.js'
import { PotWatch } from './pot.js'
import { API_VERSION, DEFAULT_API_URL, FOBO_ORIGINS } from './protocol.js'
import { browserStore, type Store } from './storage.js'
import type { TestOptions } from './testing.js'
import type {
    Board,
    BoardDefinition,
    Connector,
    GameConfig,
    Item,
    OwnedItem,
    Payout,
    Player,
    Pot,
    PublicPlayer,
    RunInput,
    RunTicket,
    SavedData,
    ScoreInput,
    Winners,
} from './types.js'
import { secureOrigins, secureUrl } from './urls.js'
import {
    avatarProblem,
    boardKeyProblem,
    check,
    dataKeysProblem,
    dataValuesProblem,
    dayProblem,
    itemKeyProblem,
    itemMetaProblem,
    limitProblem,
    metaProblem,
    nameProblem,
    namesProblem,
    periodProblem,
    qtyProblem,
    scoreProblem,
    slotProblem,
} from './validate.js'
import { WalletLink, type SavedLink, type Wallet } from './wallet.js'

const PUBLIC_KEY_PATTERN = /^pk_[A-Za-z0-9_-]{8,}$/

export interface GameOptions {
    /**
     * The game's public key (pk_...), from the fobo.fun team. Safe to ship in a page. Leave it out and the game
     * runs in test mode: a Game Center inside the page, no account and no network (see `isTest`).
     */
    apiKey?: string
    /** Test mode only (no `apiKey`): the boards, items and rules the test Game Center starts with. */
    test?: TestOptions
    /**
     * How players link a wallet when the game runs on its own site. Default: the wallet in the browser.
     * Framed on fobo.fun the player's fobo.fun wallet is used and this is ignored.
     */
    connector?: Connector
    /** For prize games: your server's endpoint that replays a run and posts the score (see submitRun). */
    verifyUrl?: string
    /** The API version to speak. Only 1 exists; leave it out. */
    apiVersion?: 1
    /** Where the linked wallet is remembered in localStorage. Default: a key derived from apiKey. */
    storageKey?: string
    /** The Game Center API's site. Only change it to test against a local fobo.fun. */
    apiUrl?: string
    /** The sites allowed to frame the game and sign for it. Only change it for a local fobo.fun. */
    frameOrigins?: string[]
    /** Per-request timeout in ms (default 15 000). */
    timeoutMs?: number
    /** A fetch to use instead of the global one. */
    fetch?: FetchLike
}

/** What tests swap out (createTestGame). Not part of the public options. */
export interface GameInternals {
    store?: Store<SavedLink>
    isFramed?: boolean
    /** The game's host as the signed link text names it. Default: the page's. */
    host?: string
}

/** A game on fobo.fun's Game Center. */
export interface Game {
    /** The player's linked wallet. */
    readonly wallet: Wallet
    /** Whether this game runs in test mode (created with no `apiKey`): nothing leaves the page. */
    readonly isTest: boolean
    /** Test mode only: forgets every test score, player, saved value and item. Does nothing on a live game. */
    resetTestData(): void
    /** The game's settings (loaded once, then cached). */
    config(): Promise<GameConfig>
    /** The game's leaderboards ('main' always exists). */
    boards(): Promise<BoardDefinition[]>
    /**
     * A board's ranking. With nothing passed: today's 'main' board, top 20. Pass `name` to also get that player's
     * own row (`you`).
     */
    board(query?: BoardQuery): Promise<Board>
    /** Today's prize pot. */
    pot(): Promise<Pot>
    /** A day's prize places (yesterday's results: pass that day). */
    winners(day?: string): Promise<Winners>
    /** Recent prizes paid, newest first. */
    payouts(limit?: number): Promise<{ payouts: Payout[] }>
    /**
     * Posts a score straight to a board ('main' unless `board` is set). Only for games whose scores are written
     * by their pages.
     */
    submitScore(score: ScoreInput): Promise<Board>
    /**
     * Asks your verifier (`verifyUrl`) for a run ticket: play the run with its seed, then pass
     * `run: { ticket: ticket.id, inputs }` to submitRun.
     */
    startRun(): Promise<RunTicket>
    /**
     * Posts a finished run the right way for this game: straight to the board, or through your verifier
     * (`verifyUrl`) when the game's scores are written by its server.
     */
    submitRun<T = Board>(run: RunInput): Promise<T>
    /** Links the player's wallet (one signature, no transaction). Returns the address. */
    link(): Promise<string>
    /** Sets the wallet connector for when the game runs on its own site. */
    useConnector(connector: Connector): void
    /** A pot countdown to drive a prize banner. */
    potWatch(): PotWatch
    /** The linked player's profile. Every call needs a linked wallet. */
    readonly player: {
        /** Their name, picture, equipped items and whether they hold. */
        get(): Promise<Player>
        /** Sets or changes their username (GameError with status 409 when taken). */
        setName(name: string): Promise<Player>
        /** Uploads their picture: a PNG, JPEG, WebP or GIF File or Blob of at most 1 MB. */
        setAvatar(image: Blob): Promise<Player>
        /** Goes back to their fobo.fun picture (or a made-up one). */
        removeAvatar(): Promise<Player>
    }
    /** Other players' names, pictures and equipped items (up to 50 names). Unknown names are left out. */
    players(names: string[]): Promise<PublicPlayer[]>
    /** The linked player's saved data: your own keys and JSON values, kept on fobo.fun. */
    readonly save: {
        /** Everything saved, or only the keys asked for. */
        get(keys?: string[]): Promise<SavedData>
        /** Writes these keys (others stay). Returns everything saved. */
        set(values: SavedData): Promise<SavedData>
        /** Deletes these keys. Returns what is left. */
        remove(keys: string[]): Promise<SavedData>
    }
    /** The game's items and what the linked player owns. */
    readonly items: {
        /** Every item the game has. */
        catalog(): Promise<Item[]>
        /** What the linked player owns. */
        mine(): Promise<OwnedItem[]>
        /**
         * Gives the linked player an item. From a page this only works while the game's `writes` is 'client':
         * a game with prizes grants from its server instead.
         */
        grant(key: string, options?: { qty?: number; meta?: Record<string, unknown> }): Promise<OwnedItem>
        /** Uses up `qty` of an item (1 by default). Returns what is left, or null when it was the last. */
        consume(key: string, qty?: number): Promise<OwnedItem | null>
        /** Puts an item the player owns into a slot; null empties the slot. */
        equip(slot: string, key: string | null): Promise<Player>
    }
}

function readApiKey(apiKey: unknown): string {
    if (typeof apiKey === 'string' && apiKey.startsWith('sk_')) {
        throw new GameError(
            'config',
            'That is the secret key: never put it in a page. createGame takes the public key (pk_...)'
        )
    }
    if (typeof apiKey !== 'string' || !PUBLIC_KEY_PATTERN.test(apiKey))
        throw new GameError('config', 'apiKey must be the public key (pk_...)')
    return apiKey
}

/** The verifier's URL: absolute, or a path on the game's own site. */
function readVerifyUrl(verifyUrl: string | undefined): string | null {
    if (verifyUrl === undefined) return null
    const base = typeof window === 'undefined' ? undefined : window.location.href
    let absolute: string
    try {
        absolute = new URL(verifyUrl, base).href
    } catch (err) {
        throw new GameError('config', `verifyUrl is not a valid URL: ${verifyUrl}`, 0, { cause: err })
    }
    return secureUrl(absolute, 'verifyUrl').href
}

/** createGame with the parts tests replace. */
export function buildGame(options: GameOptions, internals: GameInternals = {}): Game {
    const apiKey = readApiKey(options.apiKey)
    const apiUrl = secureUrl(options.apiUrl ?? DEFAULT_API_URL, 'apiUrl').origin
    const frameOrigins = secureOrigins(options.frameOrigins ?? FOBO_ORIGINS, 'frameOrigins')
    const verifyUrl = readVerifyUrl(options.verifyUrl)
    if (options.apiVersion !== undefined && options.apiVersion !== API_VERSION)
        throw new GameError('config', `apiVersion must be ${API_VERSION}: this SDK speaks no other version`)
    const { fetch, timeoutMs } = options

    const api = createApi({ apiKey, apiUrl, fetch, timeoutMs })
    const isFramed = internals.isFramed ?? isFramedByAnotherSite()
    const store =
        internals.store ?? browserStore<SavedLink>(options.storageKey ?? `fobogame:${apiKey.slice(-12)}:wallet`)

    let wallet: WalletLink | null = null
    const frame = isFramed ? new FrameHost(frameOrigins, () => wallet?.emit()) : null
    const hasBrowser = typeof window !== 'undefined'
    wallet = new WalletLink({
        api,
        store,
        frame,
        connector: options.connector ?? (hasBrowser && !isFramed ? injectedConnector() : null),
        host: () => internals.host ?? window.location.host,
    })
    frame?.start()
    const link = wallet
    if (link.session) void link.refresh()

    let configOnce: Promise<GameConfig> | null = null
    const loadConfig = async (): Promise<GameConfig> => {
        try {
            return await api.config()
        } catch (err) {
            // a failed load is not cached: the next call tries again
            configOnce = null
            throw err
        }
    }
    const config = (): Promise<GameConfig> => (configOnce ??= loadConfig())

    /** Runs a call that carries the session; a session the API no longer knows is forgotten. */
    const withSession = async <T>(session: string | null, call: () => Promise<T>): Promise<T> => {
        try {
            return await call()
        } catch (err) {
            if (session && err instanceof GameError && err.status === 401 && link.session === session) link.unlink()
            throw err
        }
    }

    /** Runs a call for the linked player. */
    const asPlayer = <T>(call: (session: string) => Promise<T>): Promise<T> => {
        const session = link.session
        if (!session) return Promise.reject(new GameError('wallet', 'Link a wallet first: await game.link()'))
        return withSession(session, () => call(session))
    }

    // the name is left to the API: it also knows which names are taken, and answers both the same way
    const checkScore = ({ score, meta, board }: ScoreInput): void => {
        check(scoreProblem(score))
        check(metaProblem(meta))
        if (board !== undefined) check(boardKeyProblem(board))
    }

    const readBoard = (query: BoardQuery = {}): Promise<Board> => {
        const { board, period, at, day, limit } = query
        if (board !== undefined) check(boardKeyProblem(board))
        if (period !== undefined) check(periodProblem(period))
        if (at !== undefined) check(dayProblem(at, 'at'))
        if (day !== undefined) check(dayProblem(day, 'day'))
        if (limit !== undefined) check(limitProblem(limit))
        return api.board(query)
    }

    /** Every async method checks its input inside the promise, so a bad value rejects instead of throwing. */
    const submitScore = async (score: ScoreInput): Promise<Board> => {
        checkScore(score)
        const session = link.session
        const board = await withSession(session, () => api.submitScore(session ? { ...score, session } : score))
        link.rememberName(board.you?.name)
        return board
    }

    const NO_VERIFIER = "This game's scores are written by its server: pass verifyUrl to createGame"

    const startRun = async (): Promise<RunTicket> => {
        if (!verifyUrl) throw new GameError('config', `startRun needs your verifier: pass verifyUrl to createGame`)
        const session = link.session
        const body = { type: 'ticket', ...(session ? { session } : {}) }
        const { ticket } = await withSession(session, () =>
            requestJson<{ ticket?: RunTicket }>(verifyUrl, { method: 'POST', body, fetch, timeoutMs })
        )
        if (typeof ticket?.id !== 'string' || typeof ticket.seed !== 'string')
            throw new GameError('bad_response', 'The verifier did not answer with a ticket')
        return ticket
    }

    const submitRun = async <T = Board>({ name, score, meta = {}, run = {}, board }: RunInput): Promise<T> => {
        const scored = board === undefined ? { name, score, meta } : { name, score, meta, board }
        checkScore(scored)
        if ((await config()).writes !== 'server') return (await submitScore(scored)) as T
        if (!verifyUrl) throw new GameError('config', NO_VERIFIER)
        const session = link.session
        const body = {
            ...run,
            name,
            claimed: { score, ...meta },
            ...(board === undefined ? {} : { board }),
            ...(session ? { session } : {}),
        }
        const result = await withSession(session, () =>
            requestJson<T>(verifyUrl, { method: 'POST', body, fetch, timeoutMs, allowEmpty: true })
        )
        const you = (result as { you?: { name?: unknown } | null } | null)?.you
        if (typeof you?.name === 'string') link.rememberName(you.name)
        return result
    }

    return {
        wallet: link,
        isTest: false,
        resetTestData: () => undefined,
        config,
        boards: async () => (await config()).boards,
        board: async (query) => readBoard(query),
        pot: () => api.pot(),
        winners: (day) => api.winners(day),
        payouts: (limit) => api.payouts(limit),
        submitScore,
        startRun,
        submitRun,
        link: () => link.link(),
        useConnector: (connector) => link.useConnector(connector),
        potWatch: () => new PotWatch(() => api.pot()),
        player: {
            get: () => asPlayer((session) => api.profile(session)),
            setName: async (name) => {
                check(nameProblem(name))
                await link.setName(name)
                return asPlayer((session) => api.profile(session))
            },
            setAvatar: async (image) => {
                const isBlob = typeof Blob !== 'undefined' && image instanceof Blob
                if (!isBlob) throw new GameError('input', 'setAvatar takes a File or Blob (from a file input)')
                check(avatarProblem(image.type, image.size))
                return asPlayer((session) => api.setAvatar(session, { data: image, type: image.type }))
            },
            removeAvatar: () => asPlayer((session) => api.removeAvatar(session)),
        },
        players: async (names) => {
            check(namesProblem(names))
            return api.players(names)
        },
        save: {
            get: async (keys) => {
                if (keys !== undefined) check(dataKeysProblem(keys))
                return asPlayer((session) => api.data(session, keys))
            },
            set: async (values) => {
                check(dataValuesProblem(values))
                return asPlayer((session) => api.writeData(session, { set: values }))
            },
            remove: async (keys) => {
                check(dataKeysProblem(keys))
                return asPlayer((session) => api.writeData(session, { remove: keys }))
            },
        },
        items: {
            catalog: () => api.items(),
            mine: () => asPlayer((session) => api.ownedItems(session)),
            grant: async (key, { qty, meta } = {}) => {
                check(itemKeyProblem(key))
                if (qty !== undefined) check(qtyProblem(qty))
                check(itemMetaProblem(meta))
                const item = await asPlayer((session) => api.grantItem(session, { item: key, qty, meta }))
                if (!item) throw new GameError('bad_response', 'The API granted the item but did not return it')
                return item
            },
            consume: async (key, qty) => {
                check(itemKeyProblem(key))
                if (qty !== undefined) check(qtyProblem(qty))
                return asPlayer((session) => api.consumeItem(session, { item: key, qty }))
            },
            equip: async (slot, key) => {
                check(slotProblem(slot))
                if (key !== null) check(itemKeyProblem(key))
                return asPlayer((session) => api.equip(session, { slot, item: key }))
            },
        },
    }
}
