import { privateKeyToAccount } from 'viem/accounts'
import type { Eip1193Provider } from '../src/connectors.js'
import type { FetchLike } from '../src/http.js'

/** A throwaway key (anvil's first account): never holds anything. */
export const ACCOUNT = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')

/** A wallet provider that really signs, as an extension would. */
export function signingProvider(account = ACCOUNT): Eip1193Provider & { calls: string[] } {
    const calls: string[] = []
    return {
        calls,
        async request({ method, params = [] }) {
            calls.push(method)
            if (method === 'eth_requestAccounts') return [account.address]
            if (method === 'personal_sign') return account.signMessage({ message: { raw: params[0] as `0x${string}` } })
            throw new Error(`unexpected ${method}`)
        },
    }
}

export interface Recorded {
    url: string
    method: string
    headers: Record<string, string>
    body: unknown
}

/** A fetch that records each request and answers from `answer`. */
export function recordingFetch(answer: (request: Recorded) => { status?: number; body?: unknown; text?: string }) {
    const requests: Recorded[] = []
    const fetch: FetchLike = async (url, init = {}) => {
        const request: Recorded = {
            url,
            method: init.method ?? 'GET',
            headers: Object.fromEntries(new Headers(init.headers).entries()),
            body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
        }
        requests.push(request)
        const { status = 200, body, text } = answer(request)
        return new Response(text ?? JSON.stringify(body), { status })
    }
    return { fetch, requests }
}
