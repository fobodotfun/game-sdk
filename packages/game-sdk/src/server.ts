/**
 * For a game's own server (Node 20+, Workers, Deno, Bun): the calls that need the secret key, and the verifier
 * that checks runs. Never import this in a page: the secret key must not reach a browser.
 */
import { isPage, PAGE_ERROR } from './serverClient.js'

// fails at import, loudly, before any key can be passed in (package.json lists this file under sideEffects, so
// a build tool keeps the check)
if (isPage()) throw new Error(PAGE_ERROR)

export {
    createServerClient,
    shareOfPot,
    type PayoutRecord,
    type ServerClient,
    type ServerOptions,
} from './serverClient.js'
export {
    createVerifier,
    memoryTicketStore,
    DEFAULT_TICKET_SECONDS,
    type Replay,
    type ReplayResult,
    type RunRequest,
    type StoredTicket,
    type TicketStore,
    type Verifier,
    type VerifierOptions,
} from './verifier.js'
export {
    fastestTime,
    highScore,
    longestStreak,
    lowestScore,
    rating,
    survivalTime,
    total,
    wins,
    type BoardOptions,
} from './boards.js'
export { seededRandom } from './random.js'
export { GameError, type ApiErrorCode, type GameErrorCode } from './errors.js'
export type { FetchLike } from './http.js'
export type {
    Board,
    BoardDefinition,
    BoardEntry,
    BoardFormat,
    BoardMode,
    BoardPeriod,
    BoardSort,
    GameSettings,
    GameSetup,
    Item,
    ItemInput,
    LinkedPlayer,
    OwnedItem,
    Payout,
    Pot,
    RunTicket,
    SavedData,
    ScoreInput,
    Winners,
} from './types.js'
