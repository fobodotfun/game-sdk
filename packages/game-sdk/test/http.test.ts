import { describe, expect, it } from 'vitest'
import { GameError } from '../src/errors.js'
import { requestJson, type FetchLike } from '../src/http.js'
import { recordingFetch } from './helpers.js'

const failure = async (run: Promise<unknown>): Promise<GameError> => {
    try {
        await run
    } catch (err) {
        if (err instanceof GameError) return err
        throw err
    }
    throw new Error('expected a GameError')
}

describe('requestJson', () => {
    it('sends a GET with its headers and returns the JSON object', async () => {
        const { fetch, requests } = recordingFetch(() => ({ body: { ok: true } }))
        const data = await requestJson('https://x.test/a', { headers: { 'X-Key': 'k' }, fetch })
        expect(data).toEqual({ ok: true })
        expect(requests[0]).toMatchObject({ method: 'GET', headers: { 'x-key': 'k' }, body: undefined })
        expect(requests[0]?.headers['content-type']).toBeUndefined()
    })

    it('sends a body as JSON, bigints as decimal strings', async () => {
        const { fetch, requests } = recordingFetch(() => ({ body: {} }))
        await requestJson('https://x.test/a', { method: 'POST', body: { wei: 12345678901234567890n }, fetch })
        expect(requests[0]?.headers['content-type']).toBe('application/json')
        expect(requests[0]?.body).toEqual({ wei: '12345678901234567890' })
    })

    it("throws 'http' with the status and the API's own message", async () => {
        const { fetch } = recordingFetch(() => ({ status: 409, body: { error: 'That name is taken' } }))
        const err = await failure(requestJson('https://x.test/a', { fetch }))
        expect(err).toMatchObject({ code: 'http', status: 409, message: 'That name is taken' })
    })

    it('names the status when an error carries no JSON (a proxy page)', async () => {
        const { fetch } = recordingFetch(() => ({ status: 502, text: '<html>Bad gateway</html>' }))
        const err = await failure(requestJson('https://x.test/a', { fetch }))
        expect(err).toMatchObject({ code: 'http', status: 502, message: 'HTTP 502' })
    })

    it("throws 'bad_response' when a success is not a JSON object", async () => {
        for (const text of ['', 'null', '[1]', '"hi"', '<html>']) {
            const { fetch } = recordingFetch(() => ({ text }))
            expect((await failure(requestJson('https://x.test/a', { fetch }))).code).toBe('bad_response')
        }
    })

    it('takes an empty success as {} when allowed', async () => {
        const { fetch } = recordingFetch(() => ({ text: '' }))
        expect(await requestJson('https://x.test/a', { fetch, allowEmpty: true })).toEqual({})
    })

    it("throws 'network' when the request never gets an answer", async () => {
        const fetch: FetchLike = () => Promise.reject(new TypeError('Failed to fetch'))
        const err = await failure(requestJson('https://x.test/a', { fetch }))
        expect(err.code).toBe('network')
        expect(err.cause).toBeInstanceOf(TypeError)
    })

    it("aborts and throws 'timeout' when the answer takes too long", async () => {
        const fetch: FetchLike = (_url, init) =>
            new Promise((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
            })
        const err = await failure(requestJson('https://x.test/a', { fetch, timeoutMs: 5 }))
        expect(err.code).toBe('timeout')
    })
})
