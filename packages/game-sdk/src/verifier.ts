/**
 * Anti-cheat for a game's own server. A browser can post any score it likes, so a game with prizes lets only its
 * server write scores (`writes: 'server'`), and the server only believes a run it has replayed itself:
 *
 *   1. the page asks for a ticket: a random seed, bound to the player, good once and for a short time
 *   2. the game plays out from that seed and records what the player did (the inputs)
 *   3. the page sends the ticket and the inputs back; the server runs YOUR replay function on them and posts the
 *      score that comes out, with the secret key
 *
 * Runs anywhere `Request`, `Response` and `crypto` exist: Workers, Node 20+, Bun, Deno.
 */
import { errorMessage, GameError } from './errors.js'
import { byteLength, isRecord, parseJson } from './json.js'
import type { ServerClient } from './serverClient.js'
import type { Board, RunTicket } from './types.js'
import { secureOrigins } from './urls.js'
import { boardKeyProblem, check, metaProblem, nameProblem, scoreProblem } from './validate.js'

/** How long a ticket is good for when you set nothing: half an hour. */
export const DEFAULT_TICKET_SECONDS = 30 * 60
/** The largest request body the handler reads. */
const MAX_BODY_BYTES = 64 * 1024
/** How many live tickets the in-memory store keeps before the oldest go. */
const MEMORY_TICKETS_MAX = 10_000
const TICKET_ID_PATTERN = /^[0-9a-f]{32}$/
const RANDOM_BYTES = 16

/** A ticket as the server remembers it. */
export interface StoredTicket {
    id: string
    seed: string
    /** A hash of the player's session (never the session itself), or null for a player with no wallet linked. */
    owner: string | null
    /** ms since epoch. */
    expiresAt: number
}

/**
 * Where tickets wait between "start" and "finish". Two methods, so any database fits (see docs/anti-cheat.md for
 * Cloudflare KV and D1).
 */
export interface TicketStore {
    /** Keeps a ticket until `ticket.expiresAt`. */
    put(ticket: StoredTicket): Promise<void>
    /**
     * Returns the ticket AND deletes it, or null when it is not there. Single use depends on this: the same id
     * must never be handed out twice, even to two requests that arrive together.
     */
    take(id: string): Promise<StoredTicket | null>
}

/** What your replay function answers: the score, or the score with data to keep beside it. */
export type ReplayResult = number | { score: number; meta?: Record<string, unknown> }

/**
 * Your game's rules as one pure function: the same seed and inputs must always give the same score, with no
 * clock, no Math.random() (use seededRandom(seed)) and nothing read from outside. Throw when the inputs are not a
 * run your game could produce.
 */
export type Replay<I = unknown> = (seed: string, inputs: I) => ReplayResult | Promise<ReplayResult>

export interface VerifierOptions<I = unknown> {
    /** Your createServerClient({ apiKey, secretKey }). */
    server: Pick<ServerClient, 'submitScore' | 'player'>
    replay: Replay<I>
    /** Default: in memory, which is fine for one long-running server. Workers and serverless need a real one. */
    store?: TicketStore
    /** The board the scores go to. Default: 'main'. Set by you, never by the page. */
    board?: string
    /** How long a ticket is good for. Default: 1800 (half an hour). */
    ticketSeconds?: number
    /** Whether a player must have linked a wallet to play. Default: true. */
    requireLink?: boolean
    /** Whether the wallet must hold enough of the token to get a ticket. Default: false. */
    requireHolder?: boolean
    /** Other sites allowed to call the handler from a browser (origins). Default: none, only your own site. */
    origins?: string[]
    /** The clock, in ms. */
    now?: () => number
}

/** A finished run, as game.submitRun sends it. */
export interface RunRequest {
    /** The ticket's id. */
    ticket: string
    /** What the player did, in whatever shape your replay function reads. */
    inputs: unknown
    /** The name to post under. */
    name: string
    session?: string | null
    /** What the page thinks it scored. When set it must match the replay exactly. */
    claimed?: { score?: number }
}

export interface Verifier {
    /** Makes a ticket for a player (their session from the page). */
    issue(session?: string | null): Promise<RunTicket>
    /** Replays a run and posts its score. Returns the board with the player's row. */
    verify(run: RunRequest): Promise<Board>
    /**
     * Both of the above as one web handler: mount it on the URL you pass to createGame as `verifyUrl`.
     *
     *     export default { fetch: (request) => verifier.handle(request) }
     */
    handle(request: Request): Promise<Response>
}

/** A refusal the page is told about: an HTTP status, a stable code and a sentence. */
const refuse = (status: number, code: string, message: string): GameError =>
    new GameError('http', message, status, { apiCode: code })

const toHex = (bytes: Uint8Array): string => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')

const randomHex = (): string => toHex(globalThis.crypto.getRandomValues(new Uint8Array(RANDOM_BYTES)))

/** A session's fingerprint: what a ticket is bound to, so a stolen store never holds a usable session. */
async function ownerOf(session: string | null): Promise<string | null> {
    if (session === null) return null
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(session))
    return toHex(new Uint8Array(digest))
}

/** Compares without stopping at the first difference, so timing says nothing about the stored value. */
function isSame(a: string | null, b: string | null): boolean {
    if (a === null || b === null) return a === b
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diff === 0
}

/**
 * Tickets in this process's memory. Right for one long-running server (Node, Bun, Deno). Not for Workers or
 * serverless functions, where each request may land in a different process: pass a store on a database there.
 */
export function memoryTicketStore(now: () => number = Date.now): TicketStore {
    const tickets = new Map<string, StoredTicket>()
    return {
        put(ticket) {
            if (tickets.size >= MEMORY_TICKETS_MAX) {
                for (const [id, kept] of tickets) if (kept.expiresAt <= now()) tickets.delete(id)
            }
            // still full of live tickets (someone is farming them): the oldest goes, memory stays bounded
            const oldest = tickets.size >= MEMORY_TICKETS_MAX ? tickets.keys().next().value : undefined
            if (oldest !== undefined) tickets.delete(oldest)
            tickets.set(ticket.id, ticket)
            return Promise.resolve()
        },
        take(id) {
            const ticket = tickets.get(id) ?? null
            tickets.delete(id)
            return Promise.resolve(ticket)
        },
    }
}

/**
 * The anti-cheat helper: you write `replay`, it does the rest (tickets, single use, expiry, the player check, the
 * replay and posting the score with your secret key).
 *
 *     const verifier = createVerifier({
 *         server: createServerClient({ apiKey, secretKey }),
 *         replay: (seed, inputs) => playRun(seed, inputs).score,
 *     })
 *
 * @throws GameError ('config') for a bad option
 */
export function createVerifier<I = unknown>({
    server,
    replay,
    store,
    board,
    ticketSeconds = DEFAULT_TICKET_SECONDS,
    requireLink = true,
    requireHolder = false,
    origins = [],
    now = Date.now,
}: VerifierOptions<I>): Verifier {
    if (typeof replay !== 'function') throw new GameError('config', 'createVerifier needs your replay function')
    if (!Number.isFinite(ticketSeconds) || ticketSeconds <= 0)
        throw new GameError('config', 'ticketSeconds must be more than 0')
    const boardIssue = board === undefined ? null : boardKeyProblem(board)
    if (boardIssue) throw new GameError('config', boardIssue.message)
    if (requireHolder && !requireLink) throw new GameError('config', 'requireHolder needs requireLink')
    const allowed = origins.length === 0 ? new Set<string>() : secureOrigins(origins, 'origins')
    const tickets = store ?? memoryTicketStore(now)

    const issue = async (session: string | null = null): Promise<RunTicket> => {
        if (session === null && requireLink) throw refuse(401, 'link_required', 'Link a wallet to play')
        if (session !== null) {
            // an unknown session is the API's 401, passed on as it is
            const player = await server.player(session)
            if (requireHolder && !player.holds) {
                throw refuse(403, 'holder_required', `Hold at least ${player.holdMin} of the token to play`)
            }
        }
        const ticket = { id: randomHex(), seed: randomHex(), expiresAt: now() + ticketSeconds * 1000 }
        await tickets.put({ ...ticket, owner: await ownerOf(session) })
        return ticket
    }

    /** Runs the game's own rules; whatever they throw, the page only learns that the run was refused. */
    const replayed = async (
        seed: string,
        inputs: unknown
    ): Promise<{ score: number; meta?: Record<string, unknown> }> => {
        let result: ReplayResult
        try {
            result = await replay(seed, inputs as I)
        } catch (err) {
            console.error('[fobo-game] replay refused a run', errorMessage(err))
            throw refuse(400, 'run_rejected', 'That run could not be replayed')
        }
        const outcome = typeof result === 'number' ? { score: result } : result
        if (!isRecord(outcome) || scoreProblem(outcome.score) || metaProblem(outcome.meta)) {
            // a bug in the game's replay function, not a cheat: say so where its developer looks
            console.error('[fobo-game] replay must return a whole number score (and meta up to 512 bytes)')
            throw refuse(500, 'replay_failed', 'The run could not be scored')
        }
        return outcome
    }

    const verify = async (run: RunRequest): Promise<Board> => {
        const session = run.session ?? null
        check(nameProblem(run.name))
        if (typeof run.ticket !== 'string' || !TICKET_ID_PATTERN.test(run.ticket))
            throw refuse(400, 'bad_ticket', 'The run carries no ticket')
        if (session === null && requireLink) throw refuse(401, 'link_required', 'Link a wallet to play')

        // taken before anything else: a ticket is spent by the first request that names it, whatever happens next
        const ticket = await tickets.take(run.ticket)
        if (!ticket || ticket.expiresAt <= now())
            throw refuse(409, 'ticket_spent', 'That run was already sent, or it took too long. Start a new one')
        if (!isSame(ticket.owner, await ownerOf(session)))
            throw refuse(403, 'ticket_owner', 'That run was started by another player')

        const { score, meta } = await replayed(ticket.seed, run.inputs)
        if (run.claimed?.score !== undefined && run.claimed.score !== score)
            throw refuse(400, 'score_mismatch', 'The replay gave a different score')

        try {
            return await server.submitScore({
                name: run.name,
                score,
                ...(meta ? { meta } : {}),
                ...(board === undefined ? {} : { board }),
                ...(session === null ? {} : { session }),
            })
        } catch (err) {
            // the run was honest and only the write failed (name taken, API down): the player may send it again
            await tickets.put(ticket)
            throw err
        }
    }

    const cors = (request: Request): Record<string, string> => {
        const origin = request.headers.get('Origin')
        if (origin === null || !allowed.has(origin)) return {}
        return {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            Vary: 'Origin',
        }
    }

    const answer = (request: Request, status: number, body: unknown): Response =>
        new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(request) },
        })

    /** The request's JSON object, read with a size limit. */
    const readBody = async (request: Request): Promise<Record<string, unknown>> => {
        if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BODY_BYTES)
            throw refuse(413, 'too_large', 'The run is too large')
        const text = await request.text()
        if (byteLength(text) > MAX_BODY_BYTES) throw refuse(413, 'too_large', 'The run is too large')
        let body: unknown
        try {
            body = parseJson(text)
        } catch {
            // not JSON: refused like any other malformed request
            body = null
        }
        if (!isRecord(body)) throw refuse(400, 'bad_request', 'Send a JSON object')
        return body
    }

    const respond = async (request: Request): Promise<Response> => {
        const body = await readBody(request)
        const { session, name, ticket, inputs, claimed } = body
        if (session !== undefined && session !== null && typeof session !== 'string')
            throw refuse(400, 'bad_request', 'session must be a string')
        if (body.type === 'ticket') return answer(request, 200, { ticket: await issue(session ?? null) })
        const run: RunRequest = {
            ticket: ticket as string,
            inputs,
            name: name as string,
            session: session ?? null,
            ...(isRecord(claimed) && typeof claimed.score === 'number' ? { claimed: { score: claimed.score } } : {}),
        }
        return answer(request, 200, await verify(run))
    }

    const handle = async (request: Request): Promise<Response> => {
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) })
        if (request.method !== 'POST') return answer(request, 405, { error: 'Use POST', code: 'bad_request' })
        try {
            return await respond(request)
        } catch (err) {
            if (!(err instanceof GameError)) {
                console.error('[fobo-game] verifier', errorMessage(err))
                return answer(request, 500, { error: 'Server error' })
            }
            // a value the page sent broke a rule: its fault (400); the API unreachable: not its fault (502)
            const status = err.status || (err.code === 'input' ? 400 : 502)
            const error = err.status || err.code === 'input' ? err.message : 'The game server could not reach fobo.fun'
            if (!err.status && err.code !== 'input') console.error('[fobo-game] verifier', err.message)
            return answer(request, status, { error, ...(err.apiCode ? { code: err.apiCode } : {}) })
        }
    }

    return { issue, verify, handle }
}
