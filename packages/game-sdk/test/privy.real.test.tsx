// @vitest-environment happy-dom
/**
 * The Privy connector against the real @privy-io/react-auth: a real <PrivyProvider> with a made-up app id. Privy
 * cannot reach its servers for that id, so it never gets ready: what is proven is that the hook runs inside the
 * real provider, against the real hooks, and refuses to sign until Privy is ready.
 */
import { GameError } from '../src/index.js'
import { PrivyProvider } from '@privy-io/react-auth'
import { cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { usePrivyConnector } from '../src/privy.js'

/** Shaped like a Privy app id; no such app exists. */
const APP_ID = 'cmaaaaaaa0000aaaaaaaaaaaa'

function wrapper({ children }: { children: ReactNode }) {
    return <PrivyProvider appId={APP_ID}>{children}</PrivyProvider>
}

describe('usePrivyConnector inside the real PrivyProvider', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', async () => {
            throw new Error('offline')
        })
    })

    afterEach(() => {
        cleanup()
    })

    it('mounts, sets itself on the game, and will not sign before Privy is ready', async () => {
        const game = { useConnector: vi.fn() }
        const { result, rerender } = renderHook(() => usePrivyConnector(game), { wrapper })
        const connector = result.current
        expect(game.useConnector).toHaveBeenCalledWith(connector)

        rerender()
        expect(result.current).toBe(connector)

        let failure: unknown
        try {
            await connector.sign('hello')
        } catch (err) {
            failure = err
        }
        expect(failure).toBeInstanceOf(GameError)
        expect((failure as GameError).message).toBe('The wallet is not ready: try again')
    })
})
