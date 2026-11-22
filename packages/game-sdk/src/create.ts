import { buildGame, type Game, type GameOptions } from './game.js'
import { buildTestGame } from './testing.js'

const TEST_MODE_NOTICE =
    '[fobo] Test mode: no apiKey, scores stay in this browser. Pass your pk_ key to createGame to go live.'

let hasSaidTestMode = false

/**
 * Connects a game to fobo.fun's Game Center.
 *
 *     const game = createGame({ apiKey: 'pk_...' })
 *     await game.submitRun({ name: 'ACE', score: 1200 })
 *     const { top } = await game.board()
 *
 * With no `apiKey` the game runs in test mode: the same calls, answered by a Game Center inside the page (no
 * account, no network, no wallet; the data is kept in this browser). Going live is adding the key.
 *
 * The SDK only ever asks a wallet to sign a short message. It never sends a transaction.
 *
 * @throws GameError ('config') for a bad key, URL or origin
 */
export function createGame(options: GameOptions = {}): Game {
    const { apiKey, test, ...game } = options
    // a key that is there but wrong (empty, the secret one) is a mistake to report, not a wish for test mode
    if (apiKey !== undefined) return buildGame({ ...game, apiKey })
    if (!hasSaidTestMode) {
        hasSaidTestMode = true
        // eslint-disable-next-line no-console -- a notice, not an error: the one place the SDK warns
        console.warn(TEST_MODE_NOTICE)
    }
    return buildTestGame(game, { persist: true, ...test })
}
