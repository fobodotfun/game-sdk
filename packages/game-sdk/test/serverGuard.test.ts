// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { createServerClient } from '../src/serverClient.js'
import { createTestGame, TEST_PUBLIC_KEY, TEST_SECRET_KEY } from '../src/testing.js'

describe('the secret key in a page', () => {
    it('makes importing /server fail, loudly', async () => {
        await expect(import('../src/server.js')).rejects.toThrow(/servers only.*secret key/)
    })

    it('makes createServerClient refuse', () => {
        expect(() => createServerClient({ apiKey: TEST_PUBLIC_KEY, secretKey: TEST_SECRET_KEY })).toThrow(
            /never be in a page/
        )
    })

    it('still lets the offline test game try the verifier flow', async () => {
        const game = createTestGame({ replay: () => 7 })
        await game.link()
        const ticket = await game.startRun()
        const board = await game.submitRun({ name: 'ACE', score: 7, run: { ticket: ticket.id, inputs: [] } })
        expect(board.you?.score).toBe(7)
    })
})
