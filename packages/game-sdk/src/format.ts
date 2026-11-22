/** Small display helpers for boards and pots, and the leaderboard presets. No dependencies. */
import type { BoardDefinition } from './types.js'

export {
    fastestTime,
    highScore,
    longestStreak,
    lowestScore,
    periodKey,
    rating,
    survivalTime,
    total,
    wins,
    type BoardOptions,
} from './boards.js'

/** 0x1234…abcd */
export function shortAddress(address: string): string {
    return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

/** Time left as HH:MM:SS, or MM:SS under an hour. */
export function formatCountdown(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000))
    const pad = (n: number) => String(n).padStart(2, '0')
    const hours = Math.floor(total / 3600)
    const rest = `${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`
    return hours > 0 ? `${pad(hours)}:${rest}` : rest
}

/** 1.2K, 3.4M */
export function compactNumber(n: number): string {
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

/** An ETH amount at three significant places: 1.234, 0.0123 */
export function formatEth(eth: number): string {
    if (!eth) return '0'
    return String(Number(eth >= 1 ? eth.toFixed(3) : eth.toPrecision(3)))
}

/** $1,234 */
export function formatUsd(usd: number): string {
    return `$${Math.round(usd).toLocaleString('en-US')}`
}

const group = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** Milliseconds as M:SS.mmm, or H:MM:SS.mmm from an hour up: 83456 -> 1:23.456 */
export function formatTime(ms: number): string {
    const whole = Math.max(0, Math.floor(ms))
    const pad = (n: number, width = 2) => String(n).padStart(width, '0')
    const hours = Math.floor(whole / 3_600_000)
    const minutes = Math.floor((whole % 3_600_000) / 60_000)
    const rest = `${pad(Math.floor((whole % 60_000) / 1000))}.${pad(whole % 1000, 3)}`
    return hours > 0 ? `${hours}:${pad(minutes)}:${rest}` : `${minutes}:${rest}`
}

/**
 * A score the way its board shows it: 12,345 (number), 1:23.456 (time, from milliseconds), 12.50 (decimal: the
 * score is a whole number whose last `decimals` digits come after the point), with the board's unit after it.
 *
 *     formatScore(board, entry.score)
 *
 * @param board a board from game.boards() (or anything with its `format`, `decimals` and `unit`)
 */
export function formatScore(board: Pick<BoardDefinition, 'format' | 'decimals' | 'unit'>, value: number): string {
    const whole = Math.max(0, Math.trunc(value))
    let text: string
    if (board.format === 'time') {
        text = formatTime(whole)
    } else if (board.format === 'decimal' && board.decimals) {
        // on the digits, not by dividing: a float would round 0.1 + 0.2 style
        const digits = String(whole).padStart(board.decimals + 1, '0')
        text = `${group(digits.slice(0, -board.decimals))}.${digits.slice(-board.decimals)}`
    } else {
        text = group(String(whole))
    }
    return board.unit ? `${text} ${board.unit}` : text
}
