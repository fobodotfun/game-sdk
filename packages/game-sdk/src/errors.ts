/** What went wrong, in broad terms. */
export type GameErrorCode =
    /** The API answered with an error status (see `status`). */
    | 'http'
    /** The request never got an answer (offline, DNS, CORS). */
    | 'network'
    /** The request took too long. */
    | 'timeout'
    /** The answer was not what the API promises. */
    | 'bad_response'
    /** The SDK was set up wrong (a bad key, URL or option). */
    | 'config'
    /** A value you passed breaks the API's rules (a bad key, a value too large): nothing was sent. */
    | 'input'
    /** The wallet could not or would not sign. */
    | 'wallet'

/**
 * The API's own reason for an error (`error.apiCode`), when it gives one. Check it instead of the message:
 *
 *     if (err instanceof GameError && err.apiCode === 'not_enough') showShop()
 */
export type ApiErrorCode =
    /** No board with that key. */
    | 'unknown_board'
    /** The board does not keep that period. */
    | 'unknown_period'
    /** No item with that key. */
    | 'unknown_item'
    /** The player already owns this item and it does not stack. */
    | 'already_owned'
    /** The player would own more than the item's maxQty. */
    | 'over_max'
    /** The player owns fewer than asked (or does not own the item at all). */
    | 'not_enough'
    /** The item does not go in that slot (or in no slot at all). */
    | 'wrong_slot'
    /** No player of this game has that username (a server call that names a `player`). */
    | 'unknown_player'
    /** The value, the upload or the player's saved data is over the size limit. */
    | 'too_large'
    /** Only the game's server may write this (the game's `writes` is 'server'). */
    | 'server_writes_only'
    // any code a newer API adds still comes through
    | (string & {})

/** What a GameError may carry besides its message. */
export interface GameErrorOptions extends ErrorOptions {
    /** The API's own reason, when it gave one. */
    apiCode?: ApiErrorCode | null
}

const BRAND = Symbol.for('fobofun.game-sdk.GameError')

/**
 * Every error the SDK throws. `status` is the HTTP status when the API answered (401 the session ended, 403 not
 * allowed, 409 the name is taken, 429 slow down), else 0. `apiCode` is the API's own reason when it gave one
 * ('unknown_board', 'not_enough'...), else null.
 */
export class GameError extends Error {
    /**
     * A page can hold two copies of this class (the SDK's one-file build next to a connector's): the shared
     * symbol keeps `instanceof GameError` true across them.
     */
    static override [Symbol.hasInstance](value: unknown): boolean {
        return typeof value === 'object' && value !== null && BRAND in value
    }

    readonly [BRAND] = true
    readonly code: GameErrorCode
    readonly status: number
    readonly apiCode: ApiErrorCode | null

    constructor(code: GameErrorCode, message: string, status = 0, options: GameErrorOptions = {}) {
        super(message, options)
        this.name = 'GameError'
        this.code = code
        this.status = status
        this.apiCode = options.apiCode ?? null
    }
}

/** The message of anything thrown. */
export function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
}
