# Leaderboards

Every game starts with one board called `main`: highest score wins, each player's best run is kept, with a daily and an all-time list. You can have up to 100 boards.

## Post a score, show the board

```js
import { createGame, formatScore } from '@fobo/game-sdk'

const game = createGame({ apiKey: 'pk_...' })

const board = await game.submitRun({ name: 'ACE', score: 1200 })
board.top // [{ rank, name, score, avatar, linked, meta, equipped, updatedAt }]
board.you // the player's own row, even when they are not in the top
```

Scores are whole numbers, zero or more. For decimals, store a whole number and let the board show the point (see `decimals` below). Names are 1 to 16 characters.

`submitRun` is the one to use. It posts straight to the board, or through your own server when the game's `writes` is `'server'` ([anti-cheat](anti-cheat.md)). You never have to change your page code when you switch.

## More boards

Boards are set from your backend or a setup script, with the secret key ([README, step 3](../README.md)). Pick a preset:

```js
import { createServerClient, highScore, fastestTime, total } from '@fobo/game-sdk/server'

const server = createServerClient({ apiKey: 'pk_...', secretKey: process.env.FOBO_GAME_SECRET })

await server.configure({
    boards: [
        highScore('main', { isPrize: true }),
        fastestTime('lap', { title: 'Fastest lap' }),
        total('kills', { unit: 'kills', periods: ['weekly', 'all'] }),
    ],
})
```

| Preset          | Who is on top | What is kept        | Good for              |
| --------------- | ------------- | ------------------- | --------------------- |
| `highScore`     | highest       | the player's best   | points                |
| `fastestTime`   | lowest        | the player's best   | lap times, speedruns  |
| `lowestScore`   | lowest        | the player's best   | fewest moves, golf    |
| `total`         | highest       | every post added up | kills, coins, xp      |
| `wins`          | highest       | every post added up | post `1` for each win |
| `longestStreak` | highest       | the player's best   | streaks               |
| `survivalTime`  | highest       | the player's best   | how long you lasted   |
| `rating`        | highest       | the last post       | elo, current level    |

The second argument changes anything about the preset:

| Option     | Meaning                                                                             |
| ---------- | ----------------------------------------------------------------------------------- |
| `title`    | shown above the board, up to 40 characters                                          |
| `periods`  | which lists the board keeps: any of `'daily'`, `'weekly'`, `'monthly'`, `'all'`     |
| `unit`     | shown after the value, up to 8 characters (`'m'`, `'kills'`)                        |
| `format`   | `'number'`, `'time'` (the score is milliseconds) or `'decimal'`                     |
| `decimals` | for `'decimal'`: a score of `1234` with `decimals: 2` shows as `12.34`              |
| `isPrize`  | the one board that decides the daily prize. At most one, and it must keep `'daily'` |

Board keys are lowercase letters, digits and `-`, up to 32 characters. The list you pass replaces the one before. A board you leave out is hidden, not deleted: its scores come back if you list it again. `main` always stays.

Rounds and levels are one board each: `fastestTime('level-3')`.

## Post to a board, read a board

```js
await game.submitRun({ name: 'ACE', score: 83_400, board: 'lap' })

await game.board({ board: 'lap' }) // today
await game.board({ board: 'lap', period: 'weekly' }) // this week
await game.board({ board: 'lap', period: 'monthly', at: '2026-10-15' }) // October 2026
await game.board({ board: 'kills', period: 'all', limit: 50, name: 'ACE' })
```

- `period` defaults to `'daily'`. Asking for one the board does not keep throws with `apiCode: 'unknown_period'`.
- `at` is any day (`YYYY-MM-DD`) inside the period you want. Default: today.
- `limit` is 1 to 100. Default: 10.
- `name` adds that player's own row as `you`.
- Days, weeks and months are UTC. Ties go to whoever got there first.

## Show scores the right way

```js
const boards = await game.boards() // every board's definition
const lap = boards.find((board) => board.key === 'lap')

formatScore(lap, 83_400) // '1:23.400'
formatScore({ format: 'decimal', decimals: 2, unit: 'm' }, 1234) // '12.34 m'
```

## A little data beside a score

```js
await game.submitRun({ name: 'ACE', score: 1200, meta: { level: 7, ship: 'gold' } })
```

`meta` comes back on the row. It is small: at most 512 bytes as JSON.
