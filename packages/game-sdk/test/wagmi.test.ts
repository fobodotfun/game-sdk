import { CONNECT_WAIT_MS, linkMessage } from '../src/index.js'
import { createTestGame } from '../src/testing.js'
import { connect, createConfig, disconnect, http, mock } from '@wagmi/core'
import { defineChain, verifyMessage, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { wagmiConnector } from '../src/wagmi.js'

const MESSAGE = linkMessage('game.test', 'nonce_0123456789abcdef')
const WALLET_RPC = 'http://wallet.test'

const account = privateKeyToAccount(generatePrivateKey())

const chain = defineChain({
    id: 4663,
    name: 'Test chain',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [WALLET_RPC] } },
})

/** wagmi's mock connector sends signing to the chain's RPC: this answers it with a real signature. */
async function walletRpc(_url: unknown, init?: RequestInit): Promise<Response> {
    const { id, method, params } = JSON.parse(String(init?.body)) as {
        id: number
        method: string
        params: [string, Hex]
    }
    if (method !== 'eth_sign')
        return Response.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `unexpected ${method}` } })
    const signature = await account.signMessage({ message: { raw: params[1] } })
    return Response.json({ jsonrpc: '2.0', id, result: signature })
}

function testConfig(features?: Parameters<typeof mock>[0]['features']) {
    const config = createConfig({
        chains: [chain],
        connectors: [mock({ accounts: [account.address], features })],
        transports: { [chain.id]: http() },
    })
    const [wallet] = config.connectors
    if (!wallet) throw new Error('no mock connector')
    return { config, wallet }
}

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(walletRpc))
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe('wagmiConnector', () => {
    it('links a wallet end to end: the API checks the real signature', async () => {
        const { config, wallet } = testConfig()
        await connect(config, { connector: wallet })
        const game = createTestGame({
            game: { connector: wagmiConnector({ config }) },
            verify: ({ address, signature, message }) =>
                verifyMessage({ address: address as Hex, message, signature: signature as Hex }),
        })

        const linked = await game.link()

        expect(linked.toLowerCase()).toBe(account.address.toLowerCase())
        expect(game.wallet.address?.toLowerCase()).toBe(account.address.toLowerCase())
    })

    it('signs the link message with the connected wallet', async () => {
        const { config, wallet } = testConfig()
        await connect(config, { connector: wallet })

        const signed = await wagmiConnector({ config }).sign(MESSAGE)

        expect(signed.address).toBe(account.address)
        expect(
            await verifyMessage({ address: account.address, message: MESSAGE, signature: signed.signature as Hex })
        ).toBe(true)
    })

    it('opens the connect UI when disconnected, then signs', async () => {
        const { config, wallet } = testConfig()
        const openConnect = vi.fn(async () => {
            await connect(config, { connector: wallet })
        })

        const signed = await wagmiConnector({ config, openConnect }).sign(MESSAGE)

        expect(openConnect).toHaveBeenCalledTimes(1)
        expect(
            await verifyMessage({ address: account.address, message: MESSAGE, signature: signed.signature as Hex })
        ).toBe(true)
    })

    it('fails when disconnected with no way to connect', async () => {
        const { config } = testConfig()

        await expect(wagmiConnector({ config }).sign(MESSAGE)).rejects.toMatchObject({
            name: 'GameError',
            code: 'wallet',
            message: 'Connect a wallet first',
        })
    })

    it('gives up after three minutes when nobody connects', async () => {
        vi.useFakeTimers()
        const { config } = testConfig()

        const signing = wagmiConnector({ config, openConnect: () => {} }).sign(MESSAGE)
        const failure = expect(signing).rejects.toMatchObject({ code: 'wallet', message: 'No wallet connected' })
        await vi.advanceTimersByTimeAsync(CONNECT_WAIT_MS)

        await failure
    })

    it('reports a rejected signature as cancelled', async () => {
        const { config, wallet } = testConfig({ signMessageError: true })
        await connect(config, { connector: wallet })

        await expect(wagmiConnector({ config }).sign(MESSAGE)).rejects.toMatchObject({
            code: 'wallet',
            message: 'The wallet request was cancelled',
        })
    })

    it('asks again after the wallet disconnects', async () => {
        const { config, wallet } = testConfig()
        await connect(config, { connector: wallet })
        await disconnect(config)

        await expect(wagmiConnector({ config }).sign(MESSAGE)).rejects.toMatchObject({
            message: 'Connect a wallet first',
        })
    })
})
