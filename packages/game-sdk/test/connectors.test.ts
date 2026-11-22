// @vitest-environment happy-dom
import { verifyMessage } from 'viem'
import { afterEach, describe, expect, it } from 'vitest'
import {
    eip1193Connector,
    injectedConnector,
    signWithProvider,
    utf8ToHex,
    type Eip1193Provider,
} from '../src/connectors.js'
import { ACCOUNT, signingProvider } from './helpers.js'

const MESSAGE = 'Link this wallet to my game scores.\nSite: game.example\nNonce: abcdefghijklmnop'

/** Announces wallets the way extensions do (EIP-6963). */
function announce(wallets: { rdns: string; provider: Eip1193Provider }[]): () => void {
    const onRequest = () => {
        for (const { rdns, provider } of wallets) {
            const detail = { info: { rdns, name: rdns, uuid: rdns, icon: '' }, provider }
            window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }))
        }
    }
    window.addEventListener('eip6963:requestProvider', onRequest)
    return () => window.removeEventListener('eip6963:requestProvider', onRequest)
}

let cleanup = () => {}
afterEach(() => {
    cleanup()
    cleanup = () => {}
    delete (window as { ethereum?: unknown }).ethereum
})

describe('utf8ToHex', () => {
    it('encodes text as the bytes a wallet signs', () => {
        expect(utf8ToHex('')).toBe('0x')
        expect(utf8ToHex('hi\n')).toBe('0x68690a')
        expect(utf8ToHex('é€')).toBe('0xc3a9e282ac')
    })
})

describe('signWithProvider', () => {
    it('connects, signs with personal_sign, and the signature verifies', async () => {
        const provider = signingProvider()
        const { address, signature } = await signWithProvider(provider, MESSAGE)
        expect(provider.calls).toEqual(['eth_requestAccounts', 'personal_sign'])
        expect(address).toBe(ACCOUNT.address)
        expect(
            await verifyMessage({ address: ACCOUNT.address, message: MESSAGE, signature: signature as `0x${string}` })
        ).toBe(true)
    })

    it('skips the connect step for a known account', async () => {
        const provider = signingProvider()
        await signWithProvider(provider, MESSAGE, ACCOUNT.address)
        expect(provider.calls).toEqual(['personal_sign'])
    })

    it("reports the player's no as a cancelled wallet request", async () => {
        const provider: Eip1193Provider = {
            request: () => Promise.reject(Object.assign(new Error('User rejected'), { code: 4001 })),
        }
        await expect(signWithProvider(provider, MESSAGE)).rejects.toMatchObject({
            code: 'wallet',
            message: 'The wallet request was cancelled',
        })
    })

    it('refuses a wallet with no account or a non-text signature', async () => {
        const empty: Eip1193Provider = { request: async () => [] }
        await expect(signWithProvider(empty, MESSAGE)).rejects.toMatchObject({
            code: 'wallet',
            message: 'No wallet connected',
        })
        const odd: Eip1193Provider = {
            request: async ({ method }) => (method === 'personal_sign' ? null : [ACCOUNT.address]),
        }
        await expect(signWithProvider(odd, MESSAGE)).rejects.toMatchObject({ code: 'wallet' })
    })
})

describe('eip1193Connector', () => {
    it('takes a provider or a function that finds one when the player links', async () => {
        const direct = await eip1193Connector(signingProvider()).sign(MESSAGE)
        const lazy = await eip1193Connector(async () => signingProvider()).sign(MESSAGE)
        expect(direct).toEqual(lazy)
    })
})

describe('injectedConnector', () => {
    it('uses the first announced wallet', async () => {
        const first = signingProvider()
        cleanup = announce([
            { rdns: 'io.first', provider: first },
            { rdns: 'io.second', provider: signingProvider() },
        ])
        await injectedConnector().sign(MESSAGE)
        expect(first.calls).toContain('personal_sign')
    })

    it('prefers a wallet by rdns, and fails when that wallet is missing', async () => {
        const second = signingProvider()
        cleanup = announce([
            { rdns: 'io.first', provider: signingProvider() },
            { rdns: 'io.second', provider: second },
        ])
        await injectedConnector({ rdns: 'io.second' }).sign(MESSAGE)
        expect(second.calls).toContain('personal_sign')
        await expect(injectedConnector({ rdns: 'io.other' }).sign(MESSAGE)).rejects.toMatchObject({ code: 'wallet' })
    })

    it('falls back to window.ethereum, and says so when there is no wallet', async () => {
        await expect(injectedConnector().sign(MESSAGE)).rejects.toMatchObject({
            message: 'No wallet found in this browser',
        })
        const legacy = signingProvider()
        ;(window as { ethereum?: unknown }).ethereum = legacy
        await injectedConnector().sign(MESSAGE)
        expect(legacy.calls).toContain('personal_sign')
    })
})
