import { MAIN_BOARD } from './boards.js'
import { DEFAULT_RESET } from './days.js'
import type { Board, BoardEntry, GameConfig, GameSettings, OwnedItem, Payout, Player, Pot, Winners } from './types.js'

/** The API tells time in seconds; the SDK hands out milliseconds, like Date.now(). */
const toMs = (seconds: number | undefined): number => (seconds ?? 0) * 1000

/** A config as the SDK returns it. An API from before boards answers with the one board every game has. */
export function readConfig(config: Partial<GameConfig> & Pick<GameConfig, 'dayEndsAt'>): GameConfig {
    const writes = config.writes ?? config.scoreWrites ?? 'client'
    return {
        ...(config as GameConfig),
        writes,
        scoreWrites: writes,
        boards: config.boards ?? [MAIN_BOARD],
        apiVersion: config.apiVersion ?? 1,
        paysRewards: config.paysRewards ?? false,
        reset: config.reset ?? DEFAULT_RESET,
        dayEndsAt: toMs(config.dayEndsAt),
    }
}

const readEntry = (entry: BoardEntry): BoardEntry => ({
    ...entry,
    avatar: entry.avatar ?? null,
    equipped: entry.equipped ?? {},
    updatedAt: toMs(entry.updatedAt),
})

/** A board as the SDK returns it. */
export const readBoard = (board: Board): Board => ({
    ...board,
    board: board.board ?? MAIN_BOARD.key,
    period: board.period ?? 'daily',
    key: board.key ?? board.day,
    top: board.top.map(readEntry),
    you: board.you ? readEntry(board.you) : null,
})

/** A pot as the SDK returns it. */
export const readPot = (pot: Pot): Pot => ({
    ...pot,
    period: pot.period ?? 'daily',
    key: pot.key ?? pot.day,
    endsAt: toMs(pot.endsAt),
})

/** A round's winners as the SDK returns them. An API from before prize periods judged every day. */
export const readWinners = (winners: Winners): Winners => ({
    ...winners,
    period: winners.period ?? 'daily',
    key: winners.key ?? winners.day,
})

/** A payout as the SDK returns it. */
export const readPayout = (payout: Payout): Payout => ({ ...payout, at: toMs(payout.at) })

/** A player as the SDK returns it. */
export const readPlayer = (player: Player): Player => ({
    ...player,
    equipped: player.equipped ?? {},
    createdAt: toMs(player.createdAt),
})

/** A game's settings as the SDK returns them (the API may send `holdMin` as a string of digits). */
export const readSettings = (settings: GameSettings): GameSettings => ({
    ...settings,
    holdMin: Number(settings.holdMin),
    reset: settings.reset ?? DEFAULT_RESET,
    boards: settings.boards ?? [MAIN_BOARD],
    items: settings.items ?? [],
})

/** An owned item as the SDK returns it. */
export const readOwned = (item: OwnedItem): OwnedItem => ({ ...item, acquiredAt: toMs(item.acquiredAt) })
