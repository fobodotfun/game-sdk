// The game's rules, in one file that BOTH the page and the server load. That is the whole trick of a game that
// cannot be cheated: the server plays the run again with the same code and gets the same answer.
import { seededRandom } from '@fobo/game-sdk'

export const ROWS = 40
export const LANES = 3
export const START_LANE = 1
/** One row every tick. */
export const TICK_MS = 120
/** Ticks lost for hitting a rock. */
export const HIT_TICKS = 5
/** Rows at the start with no rock, so nobody crashes before they can react. */
const CLEAR_ROWS = 3
const NO_ROCK = -1

/**
 * The track for a seed: which lane has the rock in each row.
 * @param {string} seed the run ticket's seed
 * @returns {number[]} one lane per row (-1 = no rock)
 */
export function makeTrack(seed) {
    const random = seededRandom(seed)
    return Array.from({ length: ROWS }, (_, row) => (row < CLEAR_ROWS ? NO_ROCK : Math.floor(random() * LANES)))
}

/**
 * Plays a whole run. No clock and no Math.random(): the same seed and lanes always give the same time.
 * @param {string} seed the run ticket's seed
 * @param {number[]} lanes the lane the player was in at each row
 * @returns {{ score: number, meta: { hits: number } }} the time in ms, and the rocks hit
 * @throws when the lanes are not a run the game allows
 */
export function playRun(seed, lanes) {
    if (!Array.isArray(lanes) || lanes.length !== ROWS) throw new Error('A run is one lane for each row')
    const track = makeTrack(seed)
    let hits = 0
    let last = START_LANE
    for (const [row, lane] of lanes.entries()) {
        const isLane = Number.isInteger(lane) && lane >= 0 && lane < LANES
        // one lane sideways per row at most: a run that jumps across the road was not played with the game
        if (!isLane || Math.abs(lane - last) > 1) throw new Error('That is not a move the game allows')
        if (track[row] === lane) hits += 1
        last = lane
    }
    return { score: (ROWS + hits * HIT_TICKS) * TICK_MS, meta: { hits } }
}
