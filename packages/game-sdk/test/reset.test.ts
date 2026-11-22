import { describe, expect, it } from 'vitest'
import { highScore } from '../src/boards.js'
import { DEFAULT_RESET, dayEndsAt, dayStartsAt, gameDay, periodEndsAt } from '../src/days.js'
import { readConfig, readPot, readWinners } from '../src/convert.js'
import { createMockApi, createTestServer } from '../src/testing.js'
import { boardProblem, resetProblem } from '../src/validate.js'
import type { GameConfig, Pot, Winners } from '../src/types.js'

const NEW_YORK_5PM = { timeZone: 'America/New_York', hour: 17 }

describe('a game day', () => {
    it('is the UTC date until the game sets its own reset', () => {
        expect(gameDay(DEFAULT_RESET, Date.UTC(2026, 0, 31, 23, 59))).toBe('2026-01-31')
        expect(dayEndsAt(DEFAULT_RESET, '2026-01-31')).toBe(Date.UTC(2026, 1, 1))
    })

    it('turns over at the reset hour on the zone clock, across a clock change', () => {
        // 5pm in New York is 22:00 UTC in winter and 21:00 UTC in summer
        expect(gameDay(NEW_YORK_5PM, Date.UTC(2026, 0, 31, 21, 59))).toBe('2026-01-30')
        expect(gameDay(NEW_YORK_5PM, Date.UTC(2026, 0, 31, 22, 0))).toBe('2026-01-31')
        expect(dayStartsAt(NEW_YORK_5PM, '2026-01-31')).toBe(Date.UTC(2026, 0, 31, 22))
        expect(dayStartsAt(NEW_YORK_5PM, '2026-07-01')).toBe(Date.UTC(2026, 6, 1, 21))
        // the day the clocks go forward (8 March 2026) is an hour short
        expect(dayEndsAt(NEW_YORK_5PM, '2026-03-07') - dayStartsAt(NEW_YORK_5PM, '2026-03-07')).toBe(23 * 3_600_000)
    })

    it('ends its week on Sunday and its month on the last day', () => {
        expect(periodEndsAt(DEFAULT_RESET, 'weekly', '2026-01-28')).toBe(Date.UTC(2026, 1, 2))
        expect(periodEndsAt(DEFAULT_RESET, 'monthly', '2026-01-28')).toBe(Date.UTC(2026, 1, 1))
        expect(periodEndsAt(DEFAULT_RESET, 'all', '2026-01-28')).toBeNull()
    })
})

describe('what a game may set', () => {
    it('takes a real time zone and a whole hour', () => {
        expect(resetProblem(NEW_YORK_5PM)).toBeNull()
        expect(resetProblem({ timeZone: 'Mars/Olympus', hour: 17 })?.message).toMatch(/time zone/)
        expect(resetProblem({ timeZone: 'UTC', hour: 24 })?.message).toMatch(/0-23/)
    })

    it('judges the prize on a period the prize board keeps', () => {
        expect(
            boardProblem(highScore('main', { isPrize: true, prizePeriod: 'weekly', periods: ['weekly', 'all'] }))
        ).toBeNull()
        const problem = boardProblem(highScore('main', { isPrize: true, prizePeriod: 'weekly', periods: ['daily'] }))
        expect(problem?.message).toMatch(/prize period/)
        expect(boardProblem(highScore('laps', { prizePeriod: 'weekly' }))?.message).toMatch(/only the prize board/)
    })
})

describe('the test API', () => {
    const NOON = Date.UTC(2026, 0, 28, 12)

    it('runs the prize by the week once the prize board says so', async () => {
        const server = createTestServer(createMockApi({ now: () => NOON }))
        const settings = await server.configure({
            reset: NEW_YORK_5PM,
            boards: [highScore('main', { isPrize: true, prizePeriod: 'weekly', periods: ['weekly', 'all'] })],
        })
        expect(settings.reset).toEqual(NEW_YORK_5PM)
        // noon UTC is before 5pm in New York: still the 27th there
        const pot = await server.setPot({ day: '2026-01-27', eth: 1, usd: 3000 })
        expect(pot).toMatchObject({ day: '2026-01-27', period: 'weekly', key: '2026-W05' })
        expect(pot.endsAt).toBe(dayEndsAt(NEW_YORK_5PM, '2026-02-01'))
        expect(await server.winners('2026-01-27')).toMatchObject({ period: 'weekly', key: '2026-W05' })
    })
})

describe('an API from before prize periods', () => {
    it('reads as daily, midnight UTC', () => {
        expect(readConfig({ dayEndsAt: 1 } as GameConfig).reset).toEqual(DEFAULT_RESET)
        expect(readPot({ day: '2026-01-28', eth: 0, usd: 0, endsAt: 1 } as Pot)).toMatchObject({
            period: 'daily',
            key: '2026-01-28',
        })
        expect(readWinners({ day: '2026-01-28', winners: [], unclaimedPct: 100 } as unknown as Winners).key).toBe(
            '2026-01-28'
        )
    })
})
