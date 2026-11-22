import { answers, type Call } from './api.js'
import { readOwned, readPayout, readPot, readSettings } from './convert.js'
import { GameError } from './errors.js'
import type {
    Board,
    BoardDefinition,
    GameSettings,
    GameSetup,
    Item,
    ItemInput,
    LinkedPlayer,
    OwnedItem,
    Payout,
    Pot,
    SavedData,
    ScoreInput,
    Winners,
} from './types.js'
import {
    boardKeyProblem,
    boardsProblem,
    check,
    dataKeysProblem,
    dataValuesProblem,
    itemKeyProblem,
    itemMetaProblem,
    itemsProblem,
    metaProblem,
    nameProblem,
    qtyProblem,
    scoreProblem,
    settingsProblem,
} from './validate.js'

/** A prize you paid, to show on the game's payouts list. */
export interface PayoutRecord {
    day: string
    place: number
    address: string
    amountWei: bigint | string
    txHash: string
}

/**
 * Everything a game's server can ask the Game Center, over a caller that already speaks as the server. No key is
 * in here: createServerClient adds the secret key, the test Game Center needs none.
 * @param call how each request is sent
 */
export function buildServerApi(call: Call) {
    /** A player is named by their username in this game. */
    const checkPlayer = (player: string): void => check(nameProblem(player))

    const settings = async (): Promise<GameSettings> => readSettings(await call<GameSettings>('GET', '/game'))

    return {
        /** The game's settings as they are now. */
        settings,
        /**
         * Sets the game up. Run it when your server deploys or starts: it is safe to repeat, and only what you pass
         * changes. Everything is checked before the first request, so a typo changes nothing.
         *
         *     await server.configure({
         *         title: 'Moon Lander',
         *         holdMin: 100_000,
         *         prizeShares: [60, 25, 15],
         *         writes: 'server',
         *         boards: [highScore('main', { isPrize: true }), fastestTime('lap')],
         *         items: [{ key: 'gold-ship', name: 'Gold ship', kind: 'skin', slot: 'skin' }],
         *     })
         *
         * @returns the game's settings after the change
         */
        async configure({ title, holdMin, prizeShares, writes, boards, items }: GameSetup = {}): Promise<GameSettings> {
            const game = { title, holdMin, shares: prizeShares, writes }
            check(settingsProblem(game))
            if (boards !== undefined) check(boardsProblem(boards))
            if (items !== undefined) check(itemsProblem(items))
            if (Object.values(game).some((value) => value !== undefined)) await call('PUT', '/game', { body: game })
            if (boards !== undefined) await call('PUT', '/boards', { body: { boards } })
            if (items !== undefined && items.length > 0) await call('PUT', '/items', { body: { items } })
            return settings()
        },
        /** A day's prize places, judged now: the best linked wallets that hold enough. */
        winners(day: string): Promise<Winners> {
            return call<Winners>('GET', '/winners', { query: { day } })
        },
        /**
         * Posts a score your server has checked, to 'main' or to `board`. Pass the player's `session` to put it
         * under their wallet.
         */
        async submitScore(score: ScoreInput & { session?: string }): Promise<Board> {
            check(nameProblem(score.name))
            check(scoreProblem(score.score))
            check(metaProblem(score.meta))
            if (score.board !== undefined) check(boardKeyProblem(score.board))
            return answers.board(call<Board>('POST', '/scores', { body: score }))
        },
        /** The player behind a session your page sent you (their name, and whether they hold). */
        player(session: string): Promise<LinkedPlayer> {
            return call<LinkedPlayer>('POST', '/player', { body: { session } })
        },
        /** Reports a day's pot so the game and fobo.fun can show it. */
        async setPot(pot: { day: string; eth: number; usd: number }): Promise<Pot> {
            return readPot(await call<Pot>('POST', '/pot', { body: pot }))
        },
        /** Records a prize you paid. Safe to repeat: a transaction is recorded once. */
        async recordPayout(payout: PayoutRecord): Promise<Payout> {
            const body = { ...payout, amountWei: payout.amountWei.toString() }
            return readPayout(await call<Payout>('POST', '/payouts', { body }))
        },
        /** Recent prizes paid, newest first. */
        payouts(limit = 20): Promise<{ payouts: Payout[] }> {
            return answers.payouts(call<{ payouts: Payout[] }>('GET', '/payouts', { query: { limit } }))
        },
        /**
         * Sets the game's leaderboards: the list replaces the one before. A board left out is hidden (its scores
         * are kept, and come back if you list it again). 'main' always stays.
         *
         *     await server.defineBoards([highScore('main', { isPrize: true }), fastestTime('lap')])
         */
        async defineBoards(boards: BoardDefinition[]): Promise<BoardDefinition[]> {
            check(boardsProblem(boards))
            const answer = await call<{ boards: BoardDefinition[] }>('PUT', '/boards', { body: { boards } })
            return answer.boards
        },
        /** Adds items to the game's catalogue, or updates the ones whose key already exists. */
        async defineItems(items: ItemInput[]): Promise<Item[]> {
            check(itemsProblem(items))
            return answers.items(call<{ items: Item[] }>('PUT', '/items', { body: { items } }))
        },
        /** Removes an item from the catalogue and from every player who owns it. */
        async removeItem(key: string): Promise<Item[]> {
            check(itemKeyProblem(key))
            return answers.items(call<{ items: Item[] }>('DELETE', `/items/${encodeURIComponent(key)}`))
        },
        /** What a player owns. */
        async playerItems(player: string): Promise<OwnedItem[]> {
            checkPlayer(player)
            const { items } = await call<{ items: OwnedItem[] }>('GET', '/player/items', { query: { player } })
            return items.map(readOwned)
        },
        /** Gives a player (by username) an item. */
        async grantItem(
            player: string,
            key: string,
            { qty, meta }: { qty?: number; meta?: Record<string, unknown> } = {}
        ): Promise<OwnedItem> {
            checkPlayer(player)
            check(itemKeyProblem(key))
            if (qty !== undefined) check(qtyProblem(qty))
            check(itemMetaProblem(meta))
            const body = { player, item: key, qty, meta }
            const item = await answers.owned(call<{ item: OwnedItem | null }>('POST', '/player/items/grant', { body }))
            if (!item) throw new GameError('bad_response', 'The API granted the item but did not return it')
            return item
        },
        /** Uses up `qty` of a player's item (1 by default). Returns what is left, or null when it was the last. */
        async consumeItem(player: string, key: string, qty?: number): Promise<OwnedItem | null> {
            checkPlayer(player)
            check(itemKeyProblem(key))
            if (qty !== undefined) check(qtyProblem(qty))
            const body = { player, item: key, qty }
            return answers.owned(call<{ item: OwnedItem | null }>('POST', '/player/items/consume', { body }))
        },
        /** A player's saved data: everything, or only the keys asked for. */
        async getPlayerData(player: string, keys?: string[]): Promise<SavedData> {
            checkPlayer(player)
            if (keys !== undefined) check(dataKeysProblem(keys))
            return answers.data(call<{ data: SavedData }>('GET', '/player/data', { query: { player, keys } }))
        },
        /** Writes keys of a player's saved data (others stay). Returns everything saved. */
        async setPlayerData(player: string, values: SavedData): Promise<SavedData> {
            checkPlayer(player)
            check(dataValuesProblem(values))
            return answers.data(call<{ data: SavedData }>('PUT', '/player/data', { body: { player, set: values } }))
        },
        /** Deletes keys of a player's saved data. Returns what is left. */
        async removePlayerData(player: string, keys: string[]): Promise<SavedData> {
            checkPlayer(player)
            check(dataKeysProblem(keys))
            return answers.data(call<{ data: SavedData }>('PUT', '/player/data', { body: { player, remove: keys } }))
        },
    }
}

/** What createServerClient gives back. */
export type ServerClient = ReturnType<typeof buildServerApi>
