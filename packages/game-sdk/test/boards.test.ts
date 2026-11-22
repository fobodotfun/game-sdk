import { describe, expect, it } from 'vitest'
import {
    fastestTime,
    highScore,
    longestStreak,
    lowestScore,
    MAIN_BOARD,
    periodKey,
    rating,
    survivalTime,
    total,
    wins,
} from '../src/boards.js'
import { formatScore, formatTime } from '../src/format.js'
import { seededRandom } from '../src/random.js'
import { boardProblem } from '../src/validate.js'

describe('board presets', () => {
    it('match the contract table', () => {
        const table = [
            [highScore, 'desc', 'best', 'number'],
            [fastestTime, 'asc', 'best', 'time'],
            [lowestScore, 'asc', 'best', 'number'],
            [total, 'desc', 'sum', 'number'],
            [wins, 'desc', 'sum', 'number'],
            [longestStreak, 'desc', 'best', 'number'],
            [survivalTime, 'desc', 'best', 'time'],
            [rating, 'desc', 'latest', 'number'],
        ] as const
        for (const [preset, sort, mode, format] of table) {
            const board = preset('lap')
            expect(board).toMatchObject({ key: 'lap', sort, mode, format, periods: ['daily', 'all'] })
            expect(boardProblem(board)).toBeNull()
        }
    })

    it('take overrides, and main is the prize board', () => {
        expect(fastestTime('lap', { title: 'Best lap', periods: ['weekly'] })).toMatchObject({
            title: 'Best lap',
            periods: ['weekly'],
            sort: 'asc',
        })
        expect(MAIN_BOARD).toMatchObject({ key: 'main', isPrize: true, sort: 'desc', mode: 'best' })
    })
})

describe('periodKey', () => {
    it('names each period in UTC', () => {
        expect(periodKey('daily', '2026-01-31')).toBe('2026-01-31')
        expect(periodKey('monthly', '2026-01-31')).toBe('2026-01')
        expect(periodKey('all', '2026-01-31')).toBe('all')
    })

    it('uses ISO weeks across a year end', () => {
        expect(periodKey('weekly', '2026-01-01')).toBe('2026-W01')
        expect(periodKey('weekly', '2025-12-29')).toBe('2026-W01')
        expect(periodKey('weekly', '2026-01-04')).toBe('2026-W01')
        expect(periodKey('weekly', '2026-01-05')).toBe('2026-W02')
        expect(periodKey('weekly', '2027-01-01')).toBe('2026-W53')
        expect(periodKey('weekly', '2024-12-30')).toBe('2025-W01')
    })
})

describe('formatScore', () => {
    it('shows numbers, times and decimals', () => {
        expect(formatScore({ format: 'number' }, 1234567)).toBe('1,234,567')
        expect(formatScore({ format: 'time' }, 83456)).toBe('1:23.456')
        expect(formatScore({ format: 'decimal', decimals: 2 }, 1250)).toBe('12.50')
        expect(formatScore({ format: 'decimal', decimals: 3 }, 5)).toBe('0.005')
        expect(formatScore({ format: 'decimal', decimals: 2 }, 123456789)).toBe('1,234,567.89')
        expect(formatScore({ format: 'number', unit: 'pts' }, 10)).toBe('10 pts')
    })

    it('formats a time past the hour', () => {
        expect(formatTime(0)).toBe('0:00.000')
        expect(formatTime(3_723_004)).toBe('1:02:03.004')
    })
})

describe('seededRandom', () => {
    it('gives the same numbers for the same seed, and others for another', () => {
        const draw = (seed: string) => {
            const next = seededRandom(seed)
            return [next(), next(), next(), next()]
        }
        expect(draw('abc')).toEqual(draw('abc'))
        expect(draw('abc')).not.toEqual(draw('abd'))
        for (const value of draw('abc')) {
            expect(value).toBeGreaterThanOrEqual(0)
            expect(value).toBeLessThan(1)
        }
    })
})
