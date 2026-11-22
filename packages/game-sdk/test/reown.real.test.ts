// @vitest-environment happy-dom
/**
 * The Reown connector against the real @reown/appkit and @reown/appkit-adapter-ethers (nothing mocked but the
 * network): AppKit is created with the connector's own options, a test wallet is injected as `window.ethereum`,
 * and the link is signed through AppKit's real account state and provider.
 */
import { createTestGame } from '../src/testing.js'
import { createAppKit } from '@reown/appkit'
import { EthersAdapter } from '@reown/appkit-adapter-ethers'
import { robinhood } from '@reown/appkit/networks'
import { verifyMessage, type Hex } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { reownConnector } from '../src/reown.js'
import { ACCOUNT, signingProvider } from './helpers.js'

const PROJECT_ID = '0123456789abcdef0123456789abcdef'
const METADATA = { name: 'Test game', description: 'A game', url: 'https://game.test', icons: [] }
const SETTLE_MS = 1500

/** The step a player does by tapping their wallet in the modal. AppKit keeps it off its public type. */
interface HeadlessConnect {
    connectionControllerClient: {
        connectExternal(wallet: { id: string; type: string; provider: unknown; chain: string }): Promise<unknown>
    }
}

/** An installed wallet, as an extension injects it: one account, already on Robinhood Chain. */
function injectedWallet() {
    const wallet = signingProvider()
    return {
        calls: wallet.calls,
        on: () => undefined,
        removeListener: () => undefined,
        async request(args: { method: string; params?: unknown[] }): Promise<unknown> {
            if (args.method === 'eth_accounts') return [ACCOUNT.address]
            if (args.method === 'eth_chainId') return `0x${robinhood.id.toString(16)}`
            if (args.method === 'wallet_switchEthereumChain') return null
            return wallet.request(args)
        },
    }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS))

describe('reownConnector with the real AppKit', () => {
    const wallet = injectedWallet()
    const hosts = new Set<string>()
    /** The sign the first test starts with no wallet connected: it waits on the open modal. */
    let waiting: Promise<{ address: string; signature: string } | { failure: unknown }> | undefined

    beforeEach(() => {
        // offline: AppKit's own calls (wallet list, project settings) fail, as they would for an unknown project
        const offline = async (input: unknown) => {
            hosts.add(new URL(input instanceof Request ? input.url : String(input)).host)
            throw new Error('offline')
        }
        vi.stubGlobal('fetch', offline)
        vi.spyOn(window, 'fetch').mockImplementation(offline)
        Object.defineProperty(window, 'ethereum', { value: wallet, configurable: true })
    })

    it('creates AppKit from a project id and opens the Connect modal when no wallet is connected', async () => {
        const connector = reownConnector({ projectId: PROJECT_ID, metadata: METADATA })
        let isSettled = false
        const signing = async () => {
            try {
                return await connector.sign('first')
            } catch (err) {
                return { failure: err }
            } finally {
                isSettled = true
            }
        }
        waiting = signing()
        await settle()

        // the real modal is in the page, waiting for a tap: that tap is the part a test cannot do
        expect(document.querySelector('w3m-modal')).not.toBeNull()
        expect(isSettled).toBe(false)
        // every call AppKit tried went to Reown's own services, and none got out
        expect([...hosts].every((host) => /(^|\.)(web3modal|walletconnect)\.org$/.test(host))).toBe(true)
    })

    it('signs the link with the wallet AppKit has connected, and the link is accepted', async () => {
        const kit = createAppKit({
            adapters: [new EthersAdapter()],
            networks: [robinhood],
            projectId: PROJECT_ID,
            metadata: METADATA,
            features: { analytics: false, email: false, socials: false },
        })
        await settle()
        expect(kit.getAddress()).toBeFalsy()
        const injected = kit.getConnectors().find((connector) => connector.id === 'injected')
        expect(injected?.provider).toBe(wallet)

        await (kit as unknown as HeadlessConnect).connectionControllerClient.connectExternal({
            id: 'injected',
            type: 'INJECTED',
            provider: injected?.provider,
            chain: 'eip155',
        })
        expect(kit.getAddress()).toBe(ACCOUNT.address)
        expect(kit.getWalletProvider()).toBe(wallet)

        // the real AppKit is passed as it is: no cast, so a changed AppKit type fails the typecheck
        const connector = reownConnector({ appKit: kit })
        const signed = await connector.sign('hello')
        expect(signed.address).toBe(ACCOUNT.address)
        expect(
            await verifyMessage({ address: ACCOUNT.address, message: 'hello', signature: signed.signature as Hex })
        ).toBe(true)

        const game = createTestGame({
            game: { connector },
            verify: ({ address, signature, message }) =>
                verifyMessage({ address: address as Hex, message, signature: signature as Hex }),
        })
        const linked = await game.link()
        expect(linked.toLowerCase()).toBe(ACCOUNT.address.toLowerCase())

        // the sign that was waiting on the modal went through once the wallet connected
        const first = await waiting
        expect(first).toMatchObject({ address: ACCOUNT.address })
        if (!first || 'failure' in first) throw new Error('the waiting sign failed')
        expect(
            await verifyMessage({ address: ACCOUNT.address, message: 'first', signature: first.signature as Hex })
        ).toBe(true)
        expect(wallet.calls.filter((method) => method === 'personal_sign')).toHaveLength(3)
    })
})
