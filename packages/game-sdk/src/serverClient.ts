import { createCaller } from './api.js'
import { GameError } from './errors.js'
import type { FetchLike } from './http.js'
import { DEFAULT_API_URL, KEY_HEADER } from './protocol.js'
import { buildServerApi, type ServerClient } from './serverApi.js'
import { secureUrl } from './urls.js'

export interface ServerOptions {
    /** The game's public key (pk_...). */
    apiKey: string
    /** The game's secret key (sk_...). Keep it in an environment variable. */
    secretKey: string
    apiUrl?: string
    timeoutMs?: number
    fetch?: FetchLike
}

/** Whether this code runs in a web page (where a secret key must never be). */
export const isPage = (): boolean => typeof window !== 'undefined' && typeof document !== 'undefined'

/** The message for anything secret that ends up in a page. */
export const PAGE_ERROR =
    '@fobo/game-sdk/server is for servers only: it uses the secret key (sk_...), which must never be in a page. ' +
    'In a page use createGame from @fobo/game-sdk.'

/**
 * The Game Center API with a game's secret key.
 * @throws GameError ('config') for a bad key or URL, or when called in a page
 */
export function createServerClient({
    apiKey,
    secretKey,
    apiUrl = DEFAULT_API_URL,
    timeoutMs,
    fetch,
}: ServerOptions): ServerClient {
    if (typeof apiKey !== 'string' || !apiKey.startsWith('pk_'))
        throw new GameError('config', 'apiKey must be the public key (pk_...)')
    if (secretKey === undefined || secretKey === null || secretKey === '') {
        // never a silent test mode here: a server that lost its key must fail loudly, not post into thin air
        throw new GameError(
            'config',
            'createServerClient needs your secretKey (sk_...): is its environment variable set? A server has no ' +
                'test mode by default. To run offline use createTestServer from @fobo/game-sdk/testing.'
        )
    }
    if (typeof secretKey !== 'string' || !secretKey.startsWith('sk_'))
        throw new GameError('config', 'secretKey must be the secret key (sk_...)')
    if (isPage()) {
        throw new GameError('config', 'createServerClient is for servers: the secret key must never be in a page')
    }
    const call = createCaller({
        apiUrl: secureUrl(apiUrl, 'apiUrl').origin,
        headers: { [KEY_HEADER]: apiKey, Authorization: `Bearer ${secretKey}` },
        timeoutMs,
        fetch,
    })

    return buildServerApi(call)
}

export type { PayoutRecord, ServerClient } from './serverApi.js'

/**
 * A place's cut of a pot, rounded down to the wei.
 * @param potWei the whole pot
 * @param sharePct the place's share, a whole percent 0-100
 */
export function shareOfPot(potWei: bigint, sharePct: number): bigint {
    if (!Number.isInteger(sharePct) || sharePct < 0 || sharePct > 100)
        throw new GameError('config', `bad share: ${sharePct}`)
    return (potWei * BigInt(sharePct)) / 100n
}
