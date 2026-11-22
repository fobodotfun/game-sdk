import { buildGame } from '../src/game.js'
import { createServerClient } from '../src/server.js'
import { memoryStore } from '../src/storage.js'
import { createMockApi, TEST_PUBLIC_KEY, TEST_SECRET_KEY, testConnector, type MockApiOptions } from '../src/testing.js'

/** Noon UTC on a Thursday: every test's "now". */
export const NOON = Date.UTC(2026, 0, 1, 12)
export const DAY = '2026-01-01'
export const OTHER_ADDRESS = '0x00000000000000000000000000000000000000b2'
export const API_URL = 'http://localhost'

/** A mock API with a server client and as many pages (one per wallet) as a test needs. */
export function setup(mock: MockApiOptions = {}, clock: { now: number } = { now: NOON }) {
    const api = createMockApi({ now: () => clock.now, ...mock })
    const server = createServerClient({
        apiKey: TEST_PUBLIC_KEY,
        secretKey: TEST_SECRET_KEY,
        apiUrl: API_URL,
        fetch: api.fetch,
    })
    const page = (address?: string, options: { verifyUrl?: string; fetch?: typeof api.fetch } = {}) =>
        buildGame(
            {
                apiKey: TEST_PUBLIC_KEY,
                apiUrl: API_URL,
                fetch: api.fetch,
                connector: testConnector(address),
                ...options,
            },
            { store: memoryStore(), isFramed: false, host: api.host }
        )
    /** A page whose wallet is linked and named. */
    const linked = async (name: string, address?: string) => {
        const game = page(address)
        await game.link()
        await game.player.setName(name)
        return game
    }
    return { api, server, page, linked, clock }
}
