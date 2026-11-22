import { CONNECT_WAIT_MS, GameError, linkMessage, type Eip1193Provider } from '../src/index.js'
import { hexToString, verifyMessage, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { reownConnector, type AppKitLike } from '../src/reown.js'

const createAppKit = vi.hoisted(() => vi.fn())
vi.mock('@reown/appkit', () => ({ createAppKit }))
vi.mock('@reown/appkit-adapter-ethers', () => ({ EthersAdapter: vi.fn() }))

const PROJECT_ID = '0123456789abcdef0123456789abcdef'
const METADATA = {
    name: 'Test game',
    description: 'A game',
    url: 'https://game.test',
    icons: ['https://game.test/icon.png'],
}
const MESSAGE = linkMessage('game.test', 'nonce_0123456789abcdef')

const account = privateKeyToAccount(generatePrivateKey())

/** A wallet provider that really signs, and records every method it is asked for. */
function signingProvider() {
    const methods: string[] = []
    const provider: Eip1193Provider = {
        async request({ method, params = [] }) {
            methods.push(method)
            if (method !== 'personal_sign') throw new Error(`unexpected ${method}`)
            const [hex, address] = params as [Hex, string]
            expect(address).toBe(account.address)
            return account.signMessage({ message: hexToString(hex) })
        },
    }
    return { provider, methods }
}

/** AppKit as the connector sees it: an address, a provider, a modal and two subscriptions. */
function fakeAppKit({ address, provider }: { address?: string; provider?: unknown } = {}) {
    const accountListeners = new Set<(account: { isConnected: boolean; address?: string }) => void>()
    const stateListeners = new Set<(state: { open: boolean }) => void>()
    const state = { address, provider }
    const kit = {
        getAddress: () => state.address,
        getWalletProvider: () => state.provider,
        open: vi.fn(async (_options?: { view: 'Connect' }) => {
            for (const listener of [...stateListeners]) listener({ open: true })
        }),
        subscribeAccount(callback: (account: { isConnected: boolean; address?: string }) => void) {
            accountListeners.add(callback)
            return () => accountListeners.delete(callback)
        },
        subscribeState(callback: (state: { open: boolean }) => void) {
            stateListeners.add(callback)
            return () => stateListeners.delete(callback)
        },
    } satisfies AppKitLike
    return {
        kit,
        listenerCount: () => accountListeners.size + stateListeners.size,
        connectWallet(next: string, nextProvider: unknown) {
            state.address = next
            state.provider = nextProvider
            for (const listener of [...accountListeners]) listener({ isConnected: true, address: next })
        },
        closeModal() {
            for (const listener of [...stateListeners]) listener({ open: false })
        },
    }
}

beforeEach(() => {
    createAppKit.mockReset()
})

afterEach(() => {
    vi.useRealTimers()
})

describe('reownConnector', () => {
    it('signs with the connected wallet without opening the modal', async () => {
        const { provider, methods } = signingProvider()
        const { kit } = fakeAppKit({ address: account.address, provider })

        const signed = await reownConnector({ appKit: kit }).sign(MESSAGE)

        expect(signed.address).toBe(account.address)
        expect(
            await verifyMessage({ address: account.address, message: MESSAGE, signature: signed.signature as Hex })
        ).toBe(true)
        expect(kit.open).not.toHaveBeenCalled()
        // the wallet is only ever asked to sign
        expect(methods).toEqual(['personal_sign'])
    })

    it('opens the Connect view and signs once the player connects', async () => {
        const { provider } = signingProvider()
        const fake = fakeAppKit()

        const signing = reownConnector({ appKit: fake.kit }).sign(MESSAGE)
        await vi.waitFor(() => expect(fake.kit.open).toHaveBeenCalledWith({ view: 'Connect' }))
        fake.connectWallet(account.address, provider)
        const signed = await signing

        expect(
            await verifyMessage({ address: account.address, message: MESSAGE, signature: signed.signature as Hex })
        ).toBe(true)
        expect(fake.listenerCount()).toBe(0)
    })

    it('fails when the modal is closed with nothing connected', async () => {
        const fake = fakeAppKit()

        const signing = reownConnector({ appKit: fake.kit }).sign(MESSAGE)
        await vi.waitFor(() => expect(fake.kit.open).toHaveBeenCalled())
        fake.closeModal()

        await expect(signing).rejects.toMatchObject({
            name: 'GameError',
            code: 'wallet',
            message: 'No wallet connected',
        })
        expect(fake.listenerCount()).toBe(0)
    })

    it('gives up after three minutes', async () => {
        vi.useFakeTimers()
        const fake = fakeAppKit()

        const signing = reownConnector({ appKit: fake.kit }).sign(MESSAGE)
        const failure = expect(signing).rejects.toMatchObject({ code: 'wallet', message: 'No wallet connected' })
        await vi.advanceTimersByTimeAsync(CONNECT_WAIT_MS)

        await failure
        expect(fake.listenerCount()).toBe(0)
    })

    it('fails when the modal cannot open', async () => {
        const fake = fakeAppKit()
        fake.kit.open.mockRejectedValueOnce(new Error('modal failed'))

        await expect(reownConnector({ appKit: fake.kit }).sign(MESSAGE)).rejects.toMatchObject({ code: 'wallet' })
    })

    it('fails when AppKit has no wallet provider yet', async () => {
        const { kit } = fakeAppKit({ address: account.address })

        await expect(reownConnector({ appKit: kit }).sign(MESSAGE)).rejects.toMatchObject({
            code: 'wallet',
            message: 'The wallet is not ready: try again',
        })
    })

    it('reports a rejected signature as cancelled', async () => {
        const provider: Eip1193Provider = {
            request: () => Promise.reject(Object.assign(new Error('User rejected'), { code: 4001 })),
        }
        const { kit } = fakeAppKit({ address: account.address, provider })

        await expect(reownConnector({ appKit: kit }).sign(MESSAGE)).rejects.toMatchObject({
            code: 'wallet',
            message: 'The wallet request was cancelled',
        })
    })

    it('rejects a project id that is not a Reown project id', () => {
        expect(() => reownConnector({ projectId: 'nope', metadata: METADATA })).toThrow(GameError)
        expect(createAppKit).not.toHaveBeenCalled()
    })

    it('creates AppKit once, on the first sign, for signing only', async () => {
        const { provider } = signingProvider()
        const { kit } = fakeAppKit({ address: account.address, provider })
        createAppKit.mockReturnValue(kit)

        const connector = reownConnector({ projectId: PROJECT_ID, metadata: METADATA })
        expect(createAppKit).not.toHaveBeenCalled()
        await connector.sign(MESSAGE)
        await connector.sign(MESSAGE)

        expect(createAppKit).toHaveBeenCalledTimes(1)
        const options = createAppKit.mock.calls[0]?.[0]
        expect(options).toMatchObject({ projectId: PROJECT_ID, metadata: METADATA, themeMode: 'dark' })
        expect(options.networks.map((network: { id: number }) => network.id)).toEqual([4663])
        expect(Object.values(options.features)).toEqual(Array(7).fill(false))
    })
})
