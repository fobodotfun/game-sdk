// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FrameHost, isFramedByAnotherSite } from '../src/frame.js'
import { MSG } from '../src/protocol.js'

const FOBO = 'https://fobo.fun'
const NONCE = 'abcdefghijklmnop'
const ADDRESS = '0x00000000000000000000000000000000000f0b0f'
const SIGNATURE = `0x${'ab'.repeat(65)}`

const posted: { message: unknown; target: string }[] = []
const parent = { postMessage: (message: unknown, target: string) => posted.push({ message, target }) }
const ownParent = window.parent

/** Delivers a message to the game as if `source` posted it from `origin`. */
function deliver(data: unknown, origin = FOBO, source: unknown = parent): void {
    const event = new MessageEvent('message', { data, origin })
    Object.defineProperty(event, 'source', { value: source })
    window.dispatchEvent(event)
}

let host: FrameHost
let onHost: ReturnType<typeof vi.fn<() => void>>

beforeEach(() => {
    vi.useFakeTimers()
    posted.length = 0
    Object.defineProperty(window, 'parent', { value: parent, configurable: true })
    onHost = vi.fn<() => void>()
    host = new FrameHost(new Set([FOBO]), onHost)
    host.start()
})
afterEach(() => {
    host.stop()
    Object.defineProperty(window, 'parent', { value: ownParent, configurable: true })
    vi.useRealTimers()
})

const greet = () => deliver({ type: MSG.HOST, features: ['link'] })

describe('isFramedByAnotherSite', () => {
    it('is false for a page that is not framed', () => {
        Object.defineProperty(window, 'parent', { value: window, configurable: true })
        expect(isFramedByAnotherSite()).toBe(false)
    })
})

describe('FrameHost', () => {
    it('says hello until the parent answers, then stops', () => {
        expect(posted).toEqual([{ message: { type: MSG.READY }, target: '*' }])
        vi.advanceTimersByTime(1000)
        expect(posted).toHaveLength(3)
        greet()
        expect(host.origin).toBe(FOBO)
        expect(onHost).toHaveBeenCalledTimes(1)
        vi.advanceTimersByTime(5000)
        expect(posted).toHaveLength(3)
    })

    it('gives up saying hello after five seconds', () => {
        vi.advanceTimersByTime(60_000)
        expect(posted.length).toBeLessThanOrEqual(11)
        expect(host.origin).toBeNull()
    })

    it('ignores a hello answer from another origin, another window, or without the link feature', () => {
        deliver({ type: MSG.HOST, features: ['link'] }, 'https://evil.example')
        deliver({ type: MSG.HOST, features: ['link'] }, FOBO, {})
        deliver({ type: MSG.HOST, features: [] })
        deliver('fobogame:host')
        expect(host.origin).toBeNull()
        expect(onHost).not.toHaveBeenCalled()
    })

    it('has no wallet until the parent has answered', async () => {
        await expect(host.requestLink(NONCE, 'game.example')).rejects.toMatchObject({ code: 'wallet' })
    })

    it("asks only the parent's origin, and resolves with its signature", async () => {
        greet()
        const signed = host.requestLink(NONCE, 'game.example')
        expect(posted.at(-1)).toEqual({
            message: { type: MSG.LINK_REQUEST, nonce: NONCE, host: 'game.example' },
            target: FOBO,
        })
        deliver({ type: MSG.LINK_RESULT, nonce: NONCE, address: ADDRESS, signature: SIGNATURE })
        await expect(signed).resolves.toEqual({ address: ADDRESS, signature: SIGNATURE })
    })

    it('takes an answer with no nonce (fobo.fun today)', async () => {
        greet()
        const signed = host.requestLink(NONCE, 'game.example')
        deliver({ type: MSG.LINK_RESULT, address: ADDRESS, signature: SIGNATURE })
        await expect(signed).resolves.toMatchObject({ address: ADDRESS })
    })

    it('ignores answers from elsewhere and answers to another request', async () => {
        greet()
        const signed = host.requestLink(NONCE, 'game.example')
        const settled = vi.fn()
        void signed.then(settled, settled)
        deliver({ type: MSG.LINK_RESULT, address: ADDRESS, signature: SIGNATURE }, 'https://evil.example')
        deliver({ type: MSG.LINK_RESULT, address: ADDRESS, signature: SIGNATURE }, FOBO, {})
        deliver({ type: MSG.LINK_RESULT, nonce: 'ponmlkjihgfedcba', address: ADDRESS, signature: SIGNATURE })
        await vi.advanceTimersByTimeAsync(0)
        expect(settled).not.toHaveBeenCalled()
        deliver({ type: MSG.LINK_RESULT, nonce: NONCE, address: ADDRESS, signature: SIGNATURE })
        await expect(signed).resolves.toBeTruthy()
    })

    it('rejects a malformed answer and reports why the wallet did not sign', async () => {
        greet()
        const malformed = host.requestLink(NONCE, 'game.example')
        deliver({ type: MSG.LINK_RESULT, address: 'not-an-address', signature: SIGNATURE })
        await expect(malformed).rejects.toMatchObject({ message: 'The wallet could not sign' })
        const cancelled = host.requestLink(NONCE, 'game.example')
        deliver({ type: MSG.LINK_RESULT, error: 'cancelled' })
        await expect(cancelled).rejects.toMatchObject({ code: 'wallet', message: 'The wallet request was cancelled' })
        const unknown = host.requestLink(NONCE, 'game.example')
        deliver({ type: MSG.LINK_RESULT, error: '<script>' })
        await expect(unknown).rejects.toMatchObject({ message: 'The wallet could not sign' })
    })

    it('times out, and a new request replaces the old one', async () => {
        greet()
        const first = host.requestLink(NONCE, 'game.example')
        const second = host.requestLink('ponmlkjihgfedcba', 'game.example')
        await expect(first).rejects.toMatchObject({ message: 'Replaced by a new request' })
        const waited = expect(second).rejects.toMatchObject({ message: 'No answer from the wallet' })
        await vi.advanceTimersByTimeAsync(3 * 60 * 1000)
        await waited
    })

    it('stops listening', async () => {
        greet()
        const pending = host.requestLink(NONCE, 'game.example')
        host.stop()
        await expect(pending).rejects.toMatchObject({ code: 'wallet' })
    })
})
