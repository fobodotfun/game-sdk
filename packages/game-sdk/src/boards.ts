/** Leaderboard presets and the period keys boards are stored under. No dependencies. */
import type { BoardDefinition, BoardPeriod } from './types.js'

/** What a preset lets you change. */
export type BoardOptions = Partial<Omit<BoardDefinition, 'key'>>

type Preset = Pick<BoardDefinition, 'title' | 'sort' | 'mode' | 'format'>

/** The periods a board keeps when you name none. */
const DEFAULT_PERIODS: BoardPeriod[] = ['daily', 'all']

const preset =
    (base: Preset) =>
    (key: string, options: BoardOptions = {}): BoardDefinition => ({
        key,
        ...base,
        periods: [...DEFAULT_PERIODS],
        ...options,
    })

/** The highest score wins; a player's best one counts. */
export const highScore = preset({ title: 'High score', sort: 'desc', mode: 'best', format: 'number' })

/** The shortest time wins. Post the time in milliseconds. */
export const fastestTime = preset({ title: 'Fastest time', sort: 'asc', mode: 'best', format: 'time' })

/** The lowest score wins (golf, fewest moves). */
export const lowestScore = preset({ title: 'Lowest score', sort: 'asc', mode: 'best', format: 'number' })

/** Everything a player posts is added up (coins collected, distance travelled). */
export const total = preset({ title: 'Total', sort: 'desc', mode: 'sum', format: 'number' })

/** Counts wins: post 1 for every win. */
export const wins = preset({ title: 'Wins', sort: 'desc', mode: 'sum', format: 'number' })

/** The longest streak wins. */
export const longestStreak = preset({ title: 'Longest streak', sort: 'desc', mode: 'best', format: 'number' })

/** The longest time wins. Post the time in milliseconds. */
export const survivalTime = preset({ title: 'Survival time', sort: 'desc', mode: 'best', format: 'time' })

/** A rating that goes up and down: the latest value you post counts. */
export const rating = preset({ title: 'Rating', sort: 'desc', mode: 'latest', format: 'number' })

/** The board every game starts with. */
export const MAIN_BOARD: BoardDefinition = { ...highScore('main'), isPrize: true }

const DAY_MS = 86_400_000
const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * The key a period's ranking is stored under, for a UTC day inside it: '2026-01-31' (daily), '2026-W05'
 * (weekly, ISO weeks: Monday to Sunday), '2026-01' (monthly), 'all'.
 * @param day YYYY-MM-DD
 */
export function periodKey(period: BoardPeriod, day: string): string {
    if (period === 'all') return 'all'
    if (period === 'daily') return day
    if (period === 'monthly') return day.slice(0, 7)
    // ISO 8601: a week belongs to the year its Thursday falls in
    const date = new Date(`${day}T00:00:00Z`)
    const weekday = date.getUTCDay() || 7
    const thursday = new Date(date.getTime() + (4 - weekday) * DAY_MS)
    const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1)
    const week = Math.floor((thursday.getTime() - yearStart) / DAY_MS / 7) + 1
    return `${thursday.getUTCFullYear()}-W${pad(week)}`
}
