// @vitest-environment happy-dom
import { CONNECT_WAIT_MS, linkMessage, type Eip1193Provider } from '../src/index.js'
import type { ConnectedWallet } from '@privy-io/react-auth'
import { act, cleanup, renderHook } from '@testing-library/react'
import { hexToString, verifyMessage, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { usePrivyConnector } from '../src/privy.js'

interface PrivyState {
    ready: boolean
    authenticated: boolean
    wallets: ConnectedWallet[]
}

/** What Privy's hooks return, set by each test; the callbacks are the ones the hook under test registered. */
const privy = vi.hoisted(() => ({
    state: { ready: true, authenticated: false, wallets: [] } as PrivyState,
    login: vi.fn(),
    connectWallet: vi.fn(),
    loginError: undefined as ((code: string) => void) | undefined,
    connectError: undefined as ((code: string) => void) | undefined,
}))

vi.mock('@privy-io/react-auth', () => ({
    usePrivy: () => ({ ready: privy.state.ready, authenticated: privy.state.authenticated }),
    useWallets: () => ({ ready: privy.state.ready, wallets: privy.state.wallets }),
    useLogin: (callbacks: { onError: (code: string) => void }) => {
        privy.loginError = callbacks.onError
        return { login: privy.login }
    },
    useConnectWallet: (callbacks: { onError: (code: string) => void }) => {
        privy.connectError = callbacks.onError
        return { connectWallet: privy.connectWallet }
    },
}))

const MESSAGE = linkMessage('game.test', 'nonce_0123456789abcdef')

const account = privateKeyToAccount(generatePrivateKey())

/** A Privy wallet whose provider really signs. Only the fields the hook reads are filled in. */
function privyWallet(type: 'ethereum' | 'solana' = 'ethereum'): ConnectedWallet {
    const provider: Eip1193Provider = {
        async request({ method, params = [] }) {
            if (method === 'eth_requestAccounts') return [account.address]
            if (method !== 'personal_sign') throw new Error(`unexpected ${method}`)
            return account.signMessage({ message: hexToString(params[0] as Hex) })
        },
    }
    return { type, address: account.address, getEthereumProvider: async () => provider } as unknown as ConnectedWallet
}

beforeEach(() => {
    privy.state = { ready: true, authenticated: false, wallets: [] }
    privy.login.mockReset()
    privy.connectWallet.mockReset()
})

afterEach(() => {
    cleanup()
    vi.useRealTimers()
})

describe('usePrivyConnector', () => {
    it('signs the link message with the connected Privy wallet', async () => {
        privy.state = { ready: true, authenticated: true, wallets: [privyWallet()] }
        const { result } = renderHook(() => usePrivyConnector())

        const signed = await result.current.sign(MESSAGE)

        expect(signed.address).toBe(account.address)
        expect(
            await verifyMessage({ address: account.address, message: MESSAGE, signature: signed.signature as Hex })
        ).toBe(true)
        expect(privy.login).not.toHaveBeenCalled()
        expect(privy.connectWallet).not.toHaveBeenCalled()
    })

    it('sets itself on the game and stays the same object across renders', () => {
        const game = { useConnector: vi.fn() }
        const { result, rerender } = renderHook(() => usePrivyConnector(game))
        const first = result.current

        rerender()

        expect(result.current).toBe(first)
        expect(game.useConnector).toHaveBeenCalledTimes(1)
        expect(game.useConnector).toHaveBeenCalledWith(first)
    })

    it('opens login for a logged-out player and signs once a wallet shows up', async () => {
        const { result, rerender } = renderHook(() => usePrivyConnector())

        const signing = result.current.sign(MESSAGE)
        expect(privy.login).toHaveBeenCalledTimes(1)
        privy.state = { ready: true, authenticated: true, wallets: [privyWallet()] }
        act(() => rerender())
        const signed = await signing

        expect(
            await verifyMessage({ address: account.address, message: MESSAGE, signature: signed.signature as Hex })
        ).toBe(true)
    })

    it('opens connect for a logged-in player with no Ethereum wallet', async () => {
        privy.state = { ready: true, authenticated: true, wallets: [privyWallet('solana')] }
        const { result, rerender } = renderHook(() => usePrivyConnector())

        const signing = result.current.sign(MESSAGE)
        expect(privy.connectWallet).toHaveBeenCalledTimes(1)
        expect(privy.login).not.toHaveBeenCalled()
        privy.state = { ready: true, authenticated: true, wallets: [privyWallet('solana'), privyWallet()] }
        act(() => rerender())

        expect((await signing).address).toBe(account.address)
    })

    it('fails when the player closes the modal', async () => {
        const { result } = renderHook(() => usePrivyConnector())

        const signing = result.current.sign(MESSAGE)
        privy.loginError?.('exited_auth_flow')

        await expect(signing).rejects.toMatchObject({
            name: 'GameError',
            code: 'wallet',
            message: 'No wallet connected',
        })
    })

    it('fails while Privy is still loading', async () => {
        privy.state = { ready: false, authenticated: false, wallets: [] }
        const { result } = renderHook(() => usePrivyConnector())

        await expect(result.current.sign(MESSAGE)).rejects.toMatchObject({
            code: 'wallet',
            message: 'The wallet is not ready: try again',
        })
        expect(privy.login).not.toHaveBeenCalled()
    })

    it('gives up after three minutes', async () => {
        vi.useFakeTimers()
        const { result } = renderHook(() => usePrivyConnector())

        const signing = result.current.sign(MESSAGE)
        const failure = expect(signing).rejects.toMatchObject({ code: 'wallet', message: 'No wallet connected' })
        await vi.advanceTimersByTimeAsync(CONNECT_WAIT_MS)

        await failure
    })
})
