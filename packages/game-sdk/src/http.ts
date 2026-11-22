import { errorMessage, GameError } from './errors.js'
import { isRecord, parseJson, toJson } from './json.js'

/** How long a request may take before it is abandoned. */
export const DEFAULT_TIMEOUT_MS = 15_000

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** The HTTP methods the API uses. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

/** A body sent as it is (an image), with its content type. */
export interface RawBody {
    data: Blob | ArrayBuffer | Uint8Array
    type: string
}

export interface JsonRequest {
    method?: HttpMethod
    headers?: Record<string, string>
    /** Sent as JSON. bigint values go as decimal strings. */
    body?: unknown
    /** Sent as it is, instead of `body`. */
    raw?: RawBody
    timeoutMs?: number
    fetch?: FetchLike
    /** Take a success with no JSON body as {} (other people's servers). */
    allowEmpty?: boolean
}

// called on globalThis so a browser never sees a detached fetch
const defaultFetch: FetchLike = (input, init) => globalThis.fetch(input, init)

/** Reads a response's body as JSON, or null when it is not JSON. */
async function readJson(res: Response): Promise<unknown> {
    const text = await res.text()
    if (text === '') return null
    try {
        return parseJson(text)
    } catch {
        // not JSON (a proxy's HTML error page): the caller decides from the status
        return null
    }
}

/** The headers and body of a request: JSON, raw bytes, or none. */
function payload(headers: Record<string, string>, body: unknown, raw: RawBody | undefined): RequestInit {
    if (raw) return { headers: { ...headers, 'Content-Type': raw.type }, body: raw.data as BodyInit }
    if (body === undefined) return { headers }
    return { headers: { ...headers, 'Content-Type': 'application/json' }, body: toJson(body) }
}

/**
 * One JSON request with a timeout.
 * @returns the answer's JSON object
 * @throws GameError: 'http' with the status, the API's own message and its code (`apiCode`), 'timeout', 'network',
 * or 'bad_response' when a success carries no JSON object
 */
export async function requestJson<T>(
    url: string,
    {
        method = 'GET',
        headers = {},
        body,
        raw,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        fetch: fetchFn = defaultFetch,
        allowEmpty = false,
    }: JsonRequest = {}
): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    let data: unknown
    try {
        res = await fetchFn(url, { method, ...payload(headers, body, raw), signal: controller.signal })
        data = await readJson(res)
    } catch (err) {
        if (controller.signal.aborted)
            throw new GameError('timeout', `${method} ${url} took longer than ${timeoutMs} ms`, 0, { cause: err })
        throw new GameError('network', `${method} ${url} failed: ${errorMessage(err)}`, 0, { cause: err })
    } finally {
        clearTimeout(timer)
    }
    if (!res.ok) {
        const reason = isRecord(data) && typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
        const apiCode = isRecord(data) && typeof data.code === 'string' ? data.code : null
        throw new GameError('http', reason, res.status, { apiCode })
    }
    if (!isRecord(data) && allowEmpty) return {} as T
    if (!isRecord(data)) throw new GameError('bad_response', `${method} ${url} did not answer with JSON`, res.status)
    return data as T
}
