/**
 * The API's limits, in one place: the client checks them before sending (a clear message, no wasted request), and
 * the mock API (`/testing`) and the verifier (`/server`) enforce the very same rules.
 *
 * Every `...Problem` function answers what is wrong with a value, or null when it is fine.
 */
import { GameError } from './errors.js'
import { isRecord, jsonBytes } from './json.js'
import { MAIN_BOARD } from './boards.js'
import { isTimeZone } from './days.js'
import type { BoardPeriod, PrizePeriod } from './types.js'

export const LIMITS = {
    /** A score's `meta`, as JSON. */
    scoreMetaBytes: 512,
    /** Boards a game has, 'main' included. */
    boards: 100,
    boardTitle: 40,
    boardUnit: 8,
    boardDecimals: 6,
    /** Rows a board answers with: default and most. */
    boardRows: 20,
    boardRowsMax: 100,
    /** Names per GET /players. */
    playerNames: 50,
    avatarBytes: 1024 * 1024,
    dataKeys: 64,
    dataValueBytes: 16 * 1024,
    dataTotalBytes: 64 * 1024,
    items: 500,
    itemName: 40,
    itemKind: 24,
    itemRarity: 16,
    itemSlot: 24,
    itemMetaBytes: 2 * 1024,
    /** A game's title. */
    titleLength: 40,
    /** Places in a prize split. */
    prizePlaces: 10,
    timeZone: 64,
} as const

export const NAME_PATTERN = /^[A-Za-z0-9_.-](?:[A-Za-z0-9 _.-]{0,14}[A-Za-z0-9_.-])?$/
export const BOARD_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/
export const ITEM_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/
export const DATA_KEY_PATTERN = /^[a-zA-Z0-9_.-]{1,48}$/
export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export const BOARD_SORTS: readonly string[] = ['desc', 'asc']
export const BOARD_MODES: readonly string[] = ['best', 'sum', 'latest']
export const BOARD_FORMATS: readonly string[] = ['number', 'time', 'decimal']
export const BOARD_PERIODS: readonly BoardPeriod[] = ['daily', 'weekly', 'monthly', 'all']
export const PRIZE_PERIODS: readonly PrizePeriod[] = ['daily', 'weekly', 'monthly']
export const AVATAR_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/** What is wrong with a value. `code` is set when the API has its own code for it. */
export type Problem = { message: string; code?: 'too_large' } | null

const bad = (message: string): Problem => ({ message })
const tooLarge = (message: string): Problem => ({ message, code: 'too_large' })
/** The same problem, with where it was found in front. */
const at = (where: string, problem: Problem): Problem =>
    problem === null ? null : { ...problem, message: `${where} ${problem.message}` }

/**
 * Throws when a check found a problem.
 * @throws GameError ('input') with the problem as its message (and `apiCode` 'too_large' for a size limit)
 */
export function check(problem: Problem): void {
    if (problem !== null) throw new GameError('input', problem.message, 0, { apiCode: problem.code ?? null })
}

const isText = (value: unknown, max: number): value is string =>
    typeof value === 'string' && value.trim() !== '' && value.length <= max

/** The first problem a list of checks finds. */
const first = (...problems: Problem[]): Problem => problems.find((problem) => problem !== null) ?? null

export const nameProblem = (name: unknown): Problem =>
    typeof name === 'string' && NAME_PATTERN.test(name)
        ? null
        : bad('name must be 1-16 letters, digits, spaces, _ - or . (no space at either end)')

export const scoreProblem = (score: unknown): Problem =>
    typeof score === 'number' && Number.isSafeInteger(score) && score >= 0
        ? null
        : bad('score must be a whole number, zero or more (a time is in milliseconds)')

/** A score's optional `meta`: a small JSON object. */
export function metaProblem(meta: unknown, maxBytes: number = LIMITS.scoreMetaBytes): Problem {
    if (meta === undefined || meta === null) return null
    if (!isRecord(meta)) return bad('meta must be a plain object')
    return jsonBytes(meta) > maxBytes ? bad(`meta must be at most ${maxBytes} bytes as JSON`) : null
}

/** An item's optional `meta` (its own, or a granted one's): a JSON object of at most 2 KB. */
export function itemMetaProblem(meta: unknown): Problem {
    const problem = metaProblem(meta, LIMITS.itemMetaBytes)
    return problem && isRecord(meta) ? tooLarge(problem.message) : problem
}

export const boardKeyProblem = (key: unknown): Problem =>
    typeof key === 'string' && BOARD_KEY_PATTERN.test(key)
        ? null
        : bad(`board key must be lowercase letters, digits or -, at most 32 characters (got ${JSON.stringify(key)})`)

export const periodProblem = (period: unknown): Problem =>
    BOARD_PERIODS.includes(period as BoardPeriod) ? null : bad(`period must be one of ${BOARD_PERIODS.join(', ')}`)

export function dayProblem(day: unknown, label = 'at'): Problem {
    const isDay = typeof day === 'string' && DAY_PATTERN.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`))
    return isDay ? null : bad(`${label} must be a day like 2026-01-31`)
}

export const limitProblem = (limit: unknown): Problem =>
    typeof limit === 'number' && Number.isInteger(limit) && limit >= 1 && limit <= LIMITS.boardRowsMax
        ? null
        : bad(`limit must be a whole number from 1 to ${LIMITS.boardRowsMax}`)

/** One board's definition. */
export function boardProblem(board: unknown): Problem {
    if (!isRecord(board)) return bad('a board must be an object')
    const { key, title, sort, mode, format, decimals, unit, periods, isPrize, prizePeriod } = board
    const where = `board ${JSON.stringify(key)}:`
    if (boardKeyProblem(key)) return boardKeyProblem(key)
    if (!isText(title, LIMITS.boardTitle)) return bad(`${where} title must be 1-${LIMITS.boardTitle} characters`)
    if (!BOARD_SORTS.includes(sort as string)) return bad(`${where} sort must be 'desc' or 'asc'`)
    if (!BOARD_MODES.includes(mode as string)) return bad(`${where} mode must be 'best', 'sum' or 'latest'`)
    if (!BOARD_FORMATS.includes(format as string)) return bad(`${where} format must be 'number', 'time' or 'decimal'`)
    if (
        decimals !== undefined &&
        !(
            typeof decimals === 'number' &&
            Number.isInteger(decimals) &&
            decimals >= 0 &&
            decimals <= LIMITS.boardDecimals
        )
    )
        return bad(`${where} decimals must be a whole number from 0 to ${LIMITS.boardDecimals}`)
    if (unit !== undefined && !(typeof unit === 'string' && unit.length <= LIMITS.boardUnit))
        return bad(`${where} unit must be at most ${LIMITS.boardUnit} characters`)
    if (!Array.isArray(periods) || periods.length === 0 || periods.some((period) => periodProblem(period)))
        return bad(`${where} periods must list at least one of ${BOARD_PERIODS.join(', ')}`)
    if (new Set(periods).size !== periods.length) return bad(`${where} periods must not repeat`)
    if (isPrize !== undefined && typeof isPrize !== 'boolean') return bad(`${where} isPrize must be true or false`)
    if (prizePeriod !== undefined && !PRIZE_PERIODS.includes(prizePeriod as PrizePeriod))
        return bad(`${where} prizePeriod must be one of ${PRIZE_PERIODS.join(', ')}`)
    if (prizePeriod !== undefined && isPrize !== true) return bad(`${where} only the prize board has a prizePeriod`)
    if (isPrize === true && !periods.includes(prizePeriod ?? 'daily'))
        return bad(`${where} the prize board must keep its prize period ('${String(prizePeriod ?? 'daily')}')`)
    return null
}

/**
 * A game's whole list of boards. 'main' is always one of a game's boards, so it counts towards the most a game
 * has whether the list names it or not; an empty list leaves the game with 'main' alone.
 */
export function boardsProblem(boards: unknown): Problem {
    if (!Array.isArray(boards)) return bad('boards must be a list')
    const hasMain = boards.some((board) => isRecord(board) && board.key === MAIN_BOARD.key)
    if (boards.length + (hasMain ? 0 : 1) > LIMITS.boards)
        return bad(`a game has at most ${LIMITS.boards} boards, 'main' included`)
    const problem = first(...boards.map(boardProblem))
    if (problem) return problem
    const list = boards as { key: string; isPrize?: boolean }[]
    if (new Set(list.map((board) => board.key)).size !== list.length) return bad('two boards have the same key')
    return list.filter((board) => board.isPrize === true).length > 1
        ? bad('only one board can be the prize board')
        : null
}

export const itemKeyProblem = (key: unknown): Problem =>
    typeof key === 'string' && ITEM_KEY_PATTERN.test(key)
        ? null
        : bad(`item key must be lowercase letters, digits or -, at most 48 characters (got ${JSON.stringify(key)})`)

const isHttpsUrl = (value: unknown): boolean => {
    if (typeof value !== 'string') return false
    try {
        return new URL(value).protocol === 'https:'
    } catch {
        // not a URL at all: that is the answer
        return false
    }
}

/** One item's definition. */
export function itemProblem(item: unknown): Problem {
    if (!isRecord(item)) return bad('an item must be an object')
    const { key, name, kind, image, rarity, slot, isStackable, maxQty, meta } = item
    const where = `item ${JSON.stringify(key)}:`
    if (itemKeyProblem(key)) return itemKeyProblem(key)
    if (!isText(name, LIMITS.itemName)) return bad(`${where} name must be 1-${LIMITS.itemName} characters`)
    if (!isText(kind, LIMITS.itemKind)) return bad(`${where} kind must be 1-${LIMITS.itemKind} characters`)
    if (image !== undefined && !isHttpsUrl(image)) return bad(`${where} image must be an https URL`)
    if (rarity !== undefined && !isText(rarity, LIMITS.itemRarity))
        return bad(`${where} rarity must be 1-${LIMITS.itemRarity} characters`)
    if (slot !== undefined && !isText(slot, LIMITS.itemSlot))
        return bad(`${where} slot must be 1-${LIMITS.itemSlot} characters`)
    if (isStackable !== undefined && typeof isStackable !== 'boolean')
        return bad(`${where} isStackable must be true or false`)
    if (maxQty !== undefined && qtyProblem(maxQty)) return bad(`${where} maxQty must be a whole number from 1`)
    if (maxQty !== undefined && isStackable !== true) return bad(`${where} maxQty needs isStackable: true`)
    return at(where, itemMetaProblem(meta))
}

/** A list of items to add or update. */
export function itemsProblem(items: unknown): Problem {
    if (!Array.isArray(items) || items.length === 0) return bad('items must be a list of at least one item')
    if (items.length > LIMITS.items) return bad(`a game has at most ${LIMITS.items} items`)
    const problem = first(...items.map(itemProblem))
    if (problem) return problem
    const keys = (items as { key: string }[]).map((item) => item.key)
    return new Set(keys).size === keys.length ? null : bad('two items have the same key')
}

export const qtyProblem = (qty: unknown): Problem =>
    typeof qty === 'number' && Number.isSafeInteger(qty) && qty >= 1 ? null : bad('qty must be a whole number from 1')

export const slotProblem = (slot: unknown): Problem =>
    isText(slot, LIMITS.itemSlot) ? null : bad(`slot must be 1-${LIMITS.itemSlot} characters`)

/**
 * A saved-data key. `__proto__` fits the API's pattern but is refused here: as an object key it would be read as
 * the object's prototype by careless code.
 */
export const dataKeyProblem = (key: unknown): Problem =>
    typeof key === 'string' && DATA_KEY_PATTERN.test(key) && key !== '__proto__'
        ? null
        : bad(`a saved-data key must be 1-48 letters, digits, _ . or - (got ${JSON.stringify(key)})`)

/** A list of saved-data keys (to read or to remove). */
export function dataKeysProblem(keys: unknown): Problem {
    if (!Array.isArray(keys)) return bad('keys must be a list')
    if (keys.length > LIMITS.dataKeys) return bad(`at most ${LIMITS.dataKeys} keys`)
    return first(...keys.map(dataKeyProblem))
}

/** A player's whole saved data, after a write: at most 64 keys and 64 KB as JSON. */
export function dataTotalProblem(data: Record<string, unknown>): Problem {
    if (Object.keys(data).length > LIMITS.dataKeys)
        return tooLarge(`a player has at most ${LIMITS.dataKeys} saved keys`)
    return jsonBytes(data) > LIMITS.dataTotalBytes
        ? tooLarge(`a player's saved data is at most ${LIMITS.dataTotalBytes / 1024} KB as JSON`)
        : null
}

/** Saved-data values to write: each one JSON of at most 16 KB. */
export function dataValuesProblem(values: unknown): Problem {
    if (!isRecord(values)) return bad('values must be an object like { level: 3 }')
    const entries = Object.entries(values)
    if (entries.length === 0) return bad('values must hold at least one key')
    if (entries.length > LIMITS.dataKeys) return tooLarge(`a player has at most ${LIMITS.dataKeys} saved keys`)
    for (const [key, value] of entries) {
        if (dataKeyProblem(key)) return dataKeyProblem(key)
        if (
            value === undefined ||
            typeof value === 'function' ||
            typeof value === 'symbol' ||
            typeof value === 'bigint'
        )
            return bad(`saved value "${key}" must be JSON (a number, string, boolean, null, list or object)`)
        if (jsonBytes(value) > LIMITS.dataValueBytes)
            return tooLarge(`saved value "${key}" is over ${LIMITS.dataValueBytes / 1024} KB as JSON`)
    }
    return null
}

/** The names of a GET /players. */
export function namesProblem(names: unknown): Problem {
    if (!Array.isArray(names) || names.length === 0) return bad('names must be a list of at least one name')
    if (names.length > LIMITS.playerNames) return bad(`at most ${LIMITS.playerNames} names at a time`)
    return first(...names.map(nameProblem))
}

/** An avatar upload, by its type and size. */
export function avatarProblem(type: unknown, bytes: number): Problem {
    if (!AVATAR_TYPES.includes(type as string)) return bad('the picture must be a PNG, JPEG, WebP or GIF')
    if (bytes === 0) return bad('the picture is empty')
    return bytes > LIMITS.avatarBytes ? tooLarge('the picture must be at most 1 MB') : null
}

/** A game's name as players see it. */
export function titleProblem(title: unknown): Problem {
    if (typeof title !== 'string' || title.trim() === '') return bad('title must be text')
    return title.length > LIMITS.titleLength ? bad(`title must be at most ${LIMITS.titleLength} characters`) : null
}

/** How many whole tokens a wallet must hold: a whole number from 0, or the same as a string of digits. */
export function holdMinProblem(holdMin: unknown): Problem {
    const isWhole =
        typeof holdMin === 'number'
            ? Number.isSafeInteger(holdMin) && holdMin >= 0
            : typeof holdMin === 'string' && /^\d{1,30}$/.test(holdMin)
    return isWhole ? null : bad('holdMin must be a whole number of tokens, 0 or more')
}

/** The prize split: 1 to 10 places, each a whole percent from 1, adding up to exactly 100. */
export function sharesProblem(shares: unknown): Problem {
    if (!Array.isArray(shares) || shares.length < 1 || shares.length > LIMITS.prizePlaces)
        return bad(`the prize split must have 1 to ${LIMITS.prizePlaces} places`)
    const list = shares as unknown[]
    if (!list.every((share) => typeof share === 'number' && Number.isInteger(share) && share >= 1 && share <= 100))
        return bad('each prize share must be a whole percent from 1 to 100')
    return (list as number[]).reduce((sum, share) => sum + share, 0) === 100
        ? null
        : bad('the prize shares must add up to 100')
}

/** Who may write scores and items. */
export const writesProblem = (writes: unknown): Problem =>
    writes === 'client' || writes === 'server' ? null : bad("writes must be 'client' or 'server'")

/** When a game's day turns over: a real time zone and a whole hour, 0-23. */
export function resetProblem(reset: unknown): Problem {
    if (!isRecord(reset)) return bad('reset must be { timeZone, hour }')
    const { timeZone, hour } = reset
    if (typeof hour !== 'number' || !Number.isInteger(hour) || hour < 0 || hour > 23)
        return bad('reset.hour must be a whole hour, 0-23')
    return typeof timeZone === 'string' && timeZone !== '' && timeZone.length <= LIMITS.timeZone && isTimeZone(timeZone)
        ? null
        : bad('reset.timeZone must be a time zone like UTC or America/New_York')
}

/** The body of PUT /game: only known fields, each one valid. */
export function settingsProblem(settings: unknown): Problem {
    if (!isRecord(settings)) return bad('the settings must be an object')
    const { title, holdMin, shares, writes, reset } = settings
    return (
        (title === undefined ? null : titleProblem(title)) ??
        (holdMin === undefined ? null : holdMinProblem(holdMin)) ??
        (shares === undefined ? null : sharesProblem(shares)) ??
        (writes === undefined ? null : writesProblem(writes)) ??
        (reset === undefined ? null : resetProblem(reset))
    )
}
