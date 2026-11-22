/**
 * The wire contract between a game, fobo.fun's Game Center API and the fobo.fun page that frames the game.
 * Zero dependencies: fobo.fun imports this same module, so both sides can never disagree.
 */

/** Where the Game Center API lives. */
export const DEFAULT_API_URL = 'https://fobo.fun'

/** The API's path under the site. */
export const API_BASE = '/api/games/v1'

/** The header a game's public key (pk_...) travels in. */
export const KEY_HEADER = 'X-Fobo-Game-Key'

/** The header a linked player's session travels in, on the routes that act for one player. */
export const SESSION_HEADER = 'X-Fobo-Game-Session'

/** The header that names the SDK and its version (`<package>/<version>`), on every API request. */
export const SDK_HEADER = 'X-Fobo-Game-Sdk'

/** The API version this SDK speaks. */
export const API_VERSION = 1

/** The origins allowed to frame a game and sign for it. */
export const FOBO_ORIGINS: readonly string[] = ['https://fobo.fun']

/** postMessage types, game <-> the page framing it. */
export const MSG = {
    /** game -> parent: "I use the SDK, are you fobo.fun?" */
    READY: 'fobogame:ready',
    /** parent -> game: "yes", with the features it offers */
    HOST: 'fobogame:host',
    /** game -> parent: "ask the player's wallet to sign the link text" */
    LINK_REQUEST: 'fobogame:link-request',
    /** parent -> game: the signature, or why there is none */
    LINK_RESULT: 'fobogame:link-result',
} as const

/** The feature name for wallet linking in a HOST message. */
export const FEATURE_LINK = 'link'

/** A link request's nonce: letters, digits, _ and - only. */
export const LINK_NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/

/** Why a framed link ended without a signature. */
export type LinkError = 'cancelled' | 'busy' | 'failed'

/** The errors a LINK_RESULT may carry. */
export const LINK_ERRORS: readonly LinkError[] = ['cancelled', 'busy', 'failed']

/** game -> parent */
export interface ReadyMessage {
    type: typeof MSG.READY
}

/** parent -> game */
export interface HostMessage {
    type: typeof MSG.HOST
    features: string[]
}

/** game -> parent */
export interface LinkRequestMessage {
    type: typeof MSG.LINK_REQUEST
    nonce: string
    host: string
}

/** parent -> game. `nonce` echoes the request it answers. */
export type LinkResultMessage =
    | { type: typeof MSG.LINK_RESULT; nonce?: string; address: string; signature: string }
    | { type: typeof MSG.LINK_RESULT; nonce?: string; error: LinkError }

/**
 * The exact text a wallet signs (EIP-191 personal_sign) to link itself to a game's scores.
 * @param host the game's host (location.host of the page the player is on)
 * @param nonce the single-use nonce from GET /link/nonce
 */
export function linkMessage(host: string, nonce: string): string {
    return `Link this wallet to my game scores.\nSite: ${host}\nNonce: ${nonce}`
}
