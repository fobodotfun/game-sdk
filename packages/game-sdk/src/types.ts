/** Who writes scores: the game's pages ('client') or only its own server with the secret key ('server'). */
export type ScoreWrites = 'client' | 'server'

/**
 * When a game's day turns over: an hour on a time zone's clock. Its daily board, its weeks and months and its prize
 * rounds all start from it. Midnight UTC until the game sets its own.
 */
export interface GameReset {
    /** An IANA time zone, like 'UTC' or 'America/New_York' (clock changes are followed). */
    timeZone: string
    /** The hour the day starts, 0-23 on that zone's clock (17 = 5pm). */
    hour: number
}

/** How often a game's prize is judged. */
export type PrizePeriod = 'daily' | 'weekly' | 'monthly'

/** A game's settings, as registered on fobo.fun. */
export interface GameConfig {
    /** The game's id. */
    game: string
    title: string
    /** The token the game belongs to. */
    tokenAddress: string
    /** The token's ticker, without the $. */
    ticker: string | null
    /** How many tokens a wallet must hold to win a prize. */
    holdMin: number
    /** The prize split by place, in percent (e.g. [60, 25, 15]). */
    shares: number[]
    /** Who may write scores, items and prizes-related data: the game's pages, or only its server. */
    writes: ScoreWrites
    /** The same as `writes` (its older name). */
    scoreWrites: ScoreWrites
    /** The game's leaderboards. There is always a 'main' board. */
    boards: BoardDefinition[]
    /** The API version that answered (1). */
    apiVersion: number
    /** Whether the game pays prizes (the creator turns this on at fobo.fun). */
    paysRewards: boolean
    /** When the game's day turns over. */
    reset: GameReset
    /** When today's board closes (ms since epoch): the game's next reset. */
    dayEndsAt: number
}

/** A game's settings, as its server reads them (`server.settings()`). */
export interface GameSettings {
    title: string
    /** How many whole tokens a wallet must hold to win a prize. 0 = anyone. */
    holdMin: number
    /** The prize split by place, in whole percent (e.g. [60, 25, 15]). */
    shares: number[]
    writes: ScoreWrites
    /** Whether the game pays prizes. Read-only: the creator sets it on fobo.fun. */
    paysRewards: boolean
    /** Whether players can connect a wallet. Read-only: the creator sets it on fobo.fun. */
    walletLink: boolean
    /** When the game's day turns over. */
    reset: GameReset
    boards: BoardDefinition[]
    items: Item[]
}

/** What `server.configure()` takes. Everything is optional: only what you pass changes. */
export interface GameSetup {
    /** The game's name as players see it (at most 40 characters). */
    title?: string
    /** How many whole tokens a wallet must hold to win a prize. 0 = anyone. */
    holdMin?: number | string
    /** The prize split by place, in whole percent: 1 to 10 places that add up to 100 (e.g. [60, 25, 15]). */
    prizeShares?: number[]
    /** Who may write scores and items: 'client' (the game's pages) or 'server' (only your backend). */
    writes?: ScoreWrites
    /**
     * When the game's day turns over, e.g. { timeZone: 'America/New_York', hour: 17 } for 5pm New York time.
     * Midnight UTC until you set it. Rows already written stay where they are.
     */
    reset?: GameReset
    /** The game's leaderboards: the list replaces the one before. */
    boards?: BoardDefinition[]
    /** Items to add to the catalogue, or to update when their key exists. */
    items?: ItemInput[]
}

/** Which way a board ranks: 'desc' the highest score first, 'asc' the lowest first (times, golf). */
export type BoardSort = 'desc' | 'asc'

/** What a board keeps per player: their 'best' score, the 'sum' of all they post, or the 'latest' one. */
export type BoardMode = 'best' | 'sum' | 'latest'

/** How a board's scores are shown: a plain 'number', a 'time' (the score is milliseconds), or a 'decimal'. */
export type BoardFormat = 'number' | 'time' | 'decimal'

/** How long a board runs before it starts again. 'all' never resets. Periods follow UTC. */
export type BoardPeriod = 'daily' | 'weekly' | 'monthly' | 'all'

/** One leaderboard of a game. */
export interface BoardDefinition {
    /** Its id: lowercase letters, digits and -, at most 32 characters. 'main' always exists. */
    key: string
    /** Its name as players see it (at most 40 characters). */
    title: string
    sort: BoardSort
    mode: BoardMode
    format: BoardFormat
    /** For 'decimal': how many of the score's last digits come after the point (0-6). */
    decimals?: number
    /** A short unit shown after the score, like 'pts' or 'm' (at most 8 characters). */
    unit?: string
    /** The periods it keeps a ranking for (at least one). */
    periods: BoardPeriod[]
    /** Whether the game's prize is judged on this board. At most one board. */
    isPrize?: boolean
    /**
     * For the prize board: how often the prize is judged ('daily' when left out). Must be one of the board's
     * `periods`.
     */
    prizePeriod?: PrizePeriod
}

/** One row of a board. */
export interface BoardEntry {
    rank: number
    name: string
    score: number
    /** Whatever the game stored with the score. */
    meta: Record<string, unknown> | null
    /** Whether the row belongs to a linked wallet (only those can win). */
    linked: boolean
    /** The player's picture (a URL), or null. */
    avatar: string | null
    /** What the player has equipped: slot -> item key. */
    equipped: Record<string, string>
    /** When the score was last changed (ms since epoch; 0 when unknown). */
    updatedAt: number
}

/** A board's ranking for one period. */
export interface Board {
    /** The board's key ('main' unless you asked for another). */
    board: string
    /** The period shown. */
    period: BoardPeriod
    /** The period's key: '2026-01-31', '2026-W05', '2026-01' or 'all'. */
    key: string
    /** The game day asked for, YYYY-MM-DD (days turn over at the game's reset). */
    day: string
    top: BoardEntry[]
    /** The asked name's own row, when it has one. */
    you: BoardEntry | null
}

/** A prize round's pot. A round is one of the game's prize periods: a day, a week or a month. */
export interface Pot {
    /** The game day asked for (today when none was), YYYY-MM-DD. */
    day: string
    /** How often the game's prize is judged. */
    period: PrizePeriod
    /** The round's key: '2026-01-31', '2026-W05' or '2026-01'. */
    key: string
    eth: number
    usd: number
    /** When the round closes (ms since epoch). */
    endsAt: number
}

/** A prize place in a prize round. */
export interface Winner {
    place: number
    name: string
    address: string
    sharePct: number
}

export interface Winners {
    /** The game day asked for, YYYY-MM-DD. */
    day: string
    /** How often the game's prize is judged. */
    period: PrizePeriod
    /** The round's key: '2026-01-31', '2026-W05' or '2026-01'. */
    key: string
    winners: Winner[]
    /** The share nobody qualified for. */
    unclaimedPct: number
}

/** A prize that was paid. */
export interface Payout {
    day: string
    place: number
    name: string | null
    address: string
    /** The amount in wei, as a decimal string. */
    amountWei: string
    txHash: string
    /** When it was recorded (ms since epoch). */
    at: number
}

/** Where a player's picture comes from: set in this game, their fobo.fun profile, or made up for them. */
export type AvatarSource = 'game' | 'fobo' | 'generated'

/** The linked player's profile in this game. Wallet addresses are never part of it. */
export interface Player {
    /** Their username in this game, null until they have one. */
    name: string | null
    /** Their picture (a URL). */
    avatar: string
    avatarSource: AvatarSource
    /** Whether their wallet holds enough of the game's token right now. */
    isHolder: boolean
    /** What they have equipped: slot -> item key. */
    equipped: Record<string, string>
    /** When they first linked to this game (ms since epoch). */
    createdAt: number
}

/** Another player, as anyone may see them. */
export interface PublicPlayer {
    name: string
    avatar: string
    equipped: Record<string, string>
}

/** Something a game's players can own: a skin, a power-up, a badge, coins. */
export interface Item {
    /** Its id: lowercase letters, digits and -, at most 48 characters. */
    key: string
    /** Its name as players see it (at most 40 characters). */
    name: string
    /** Your own grouping, like 'skin' or 'powerup' (at most 24 characters). */
    kind: string
    /** A picture (an https URL). */
    image?: string
    /** Like 'common' or 'legendary' (at most 16 characters). */
    rarity?: string
    /** Where it is worn, like 'hat'. Only items with a slot can be equipped (at most 24 characters). */
    slot?: string
    /** Whether a player can own more than one. */
    isStackable: boolean
    /** The most a player can own. */
    maxQty?: number
    /** Small extra data of your own (at most 2 KB as JSON). */
    meta?: Record<string, unknown>
}

/** An item as you define it: `isStackable` may be left out (then a player owns at most one). */
export type ItemInput = Omit<Item, 'isStackable'> & { isStackable?: boolean }

/** An item a player owns. */
export interface OwnedItem {
    key: string
    qty: number
    /** What was stored when it was granted. */
    meta?: Record<string, unknown>
    /** When they first got it (ms since epoch). */
    acquiredAt: number
}

/** A player's saved data: your own keys and JSON values. */
export type SavedData = Record<string, unknown>

/** A run ticket from your verifier: play the run with its seed, then send the ticket's id back with the inputs. */
export interface RunTicket {
    id: string
    /** Feeds the run's random numbers (see seededRandom), so your server can replay the exact same run. */
    seed: string
    /** When it stops being accepted (ms since epoch). */
    expiresAt: number
}

/** The linked wallet behind a session (the answer to a session check). */
export interface LinkedPlayer {
    /** The wallet, shortened (0x1234…abcd). */
    address: string
    /** Its username in this game, null until it has one. */
    name: string | null
    /** Whether it holds enough of the token right now. */
    holds: boolean
    holdMin: number
}

/** A score to post. */
export interface ScoreInput {
    /** 1-16 characters: letters, digits, space, _ . - */
    name: string
    /** A whole number, zero or more. A time is in milliseconds. */
    score: number
    /** Small extra data to keep with the score (at most 512 bytes as JSON). */
    meta?: Record<string, unknown>
    /** The board to post to. Default: 'main'. */
    board?: string
}

/** A finished run to send to the game's own verifier. */
export interface RunInput extends ScoreInput {
    /** What the verifier needs to replay the run: `{ ticket: ticket.id, inputs }` for the SDK's createVerifier. */
    run?: Record<string, unknown>
}

/** A signed message and who signed it. */
export interface SignedMessage {
    address: string
    signature: string
}

/**
 * A wallet connector: anything that can show the player a message and return their signature of it
 * (EIP-191 personal_sign). Connectors never see keys and never send transactions.
 */
export interface Connector {
    sign(message: string): Promise<SignedMessage>
}
