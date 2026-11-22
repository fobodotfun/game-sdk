import { describe, expect, it, vi } from 'vitest'
import { errorMessage, GameError } from '../src/errors.js'

describe('GameError', () => {
    it('carries a code, a status and the cause', () => {
        const cause = new Error('socket closed')
        const err = new GameError('http', 'Name taken', 409, { cause })
        expect(err).toBeInstanceOf(Error)
        expect(err).toMatchObject({ name: 'GameError', code: 'http', status: 409, message: 'Name taken', cause })
        expect(new GameError('wallet', 'No wallet').status).toBe(0)
    })

    it('is recognised across two copies of the SDK on one page', async () => {
        const original = new GameError('wallet', 'cancelled')
        vi.resetModules()
        const { GameError: Copy } = await import('../src/errors.js')
        expect(Copy).not.toBe(GameError)
        expect(original instanceof Copy).toBe(true)
        expect(new Copy('config', 'bad key') instanceof GameError).toBe(true)
    })

    it('does not claim other errors', () => {
        for (const other of [new Error('x'), { code: 'wallet' }, null, undefined, 'GameError']) {
            expect(other instanceof GameError).toBe(false)
        }
    })
})

describe('errorMessage', () => {
    it('reads the message of anything thrown', () => {
        expect(errorMessage(new GameError('network', 'offline'))).toBe('offline')
        expect(errorMessage('plain')).toBe('plain')
    })
})
