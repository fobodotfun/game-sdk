import type { BoardPeriod, GameReset } from './types.js'

/*
 * A game's days: when one ends and the next starts is the game's own choice (its reset), in its own time zone.
 * The same rules fobo.fun runs; here for the test mock and for games that want to show a countdown.
 */

/** A game's reset until it sets its own: midnight UTC. */
export const DEFAULT_RESET: GameReset = { timeZone: 'UTC', hour: 0 }

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const clocks = new Map<string, Intl.DateTimeFormat>()

/** A time zone's clock: its formatter, made once. Throws RangeError for a zone that doesn't exist. */
function zoneClock(timeZone: string): Intl.DateTimeFormat {
    let clock = clocks.get(timeZone)
    if (!clock) {
        clock = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        })
        clocks.set(timeZone, clock)
    }
    return clock
}

/** Whether a time zone exists (an IANA name like 'UTC' or 'America/New_York'). */
export function isTimeZone(timeZone: string): boolean {
    try {
        zoneClock(timeZone)
        return true
    } catch {
        // Intl's RangeError: not a zone it knows
        return false
    }
}

/** What a zone's clock shows at an instant, as the ms of that same reading in UTC. */
function wallClock(timeZone: string, ms: number): number {
    const part: Record<string, number> = {}
    for (const { type, value } of zoneClock(timeZone).formatToParts(new Date(ms))) part[type] = Number(value)
    return Date.UTC(part.year ?? 0, (part.month ?? 1) - 1, part.day, part.hour, part.minute, part.second)
}

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/**
 * The game's day an instant falls in: YYYY-MM-DD, the date the day started on by the game's reset.
 * @param ms ms since epoch (now when left out)
 */
export const gameDay = (reset: GameReset, ms = Date.now()): string =>
    isoDay(wallClock(reset.timeZone, ms) - reset.hour * HOUR_MS)

/** When a game's day starts (ms since epoch): its reset hour on that date, on the zone's clock. */
export function dayStartsAt(reset: GameReset, day: string): number {
    const wall = Date.parse(`${day}T00:00:00Z`) + reset.hour * HOUR_MS
    // the zone's offset at the answer isn't known until the answer is: two passes settle it across a clock change
    let at = wall
    for (let pass = 0; pass < 2; pass++) at = wall - (wallClock(reset.timeZone, at) - at)
    return at
}

/** When a game's day ends (ms since epoch): the start of its next. */
export const dayEndsAt = (reset: GameReset, day: string): number =>
    dayStartsAt(reset, isoDay(Date.parse(`${day}T00:00:00Z`) + DAY_MS))

/**
 * When the period holding a game day ends (ms since epoch): the end of that day, of its week's Sunday or of its
 * month's last day, by the game's reset. Null for all-time.
 * @param day YYYY-MM-DD (a game's day)
 */
export function periodEndsAt(reset: GameReset, period: BoardPeriod, day: string): number | null {
    if (period === 'all') return null
    if (period === 'daily') return dayEndsAt(reset, day)
    const date = new Date(`${day}T00:00:00Z`)
    const last =
        period === 'weekly'
            ? date.getTime() + (6 - ((date.getUTCDay() + 6) % 7)) * DAY_MS
            : Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
    return dayEndsAt(reset, isoDay(last))
}
