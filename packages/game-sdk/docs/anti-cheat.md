# Scores nobody can fake

## The problem

Your game runs in the player's browser. The player owns that browser. They can open its console, change your code, or skip your game and send the score themselves:

```js
game.submitScore({ name: 'ME', score: 999999999 })
```

Nothing in a page can stop this. Hiding the code or scrambling it only slows people down.

For a board that is just for fun, that is fine. The moment a score is worth something (a prize, a reward, an item), someone will do it.

## The fix: your server plays the run again

Instead of sending a score, the page sends **what the player did** (their key presses, their moves). Your server plays the same game again with those moves and works out the score itself. The page's number is never trusted.

For that to work the game must be **deterministic**: the same start and the same moves always give the same result. Three rules get you there:

1. **No `Math.random()`.** Use `seededRandom(seed)` from the SDK: a random-number maker that gives the same numbers for the same seed, in the browser and on the server.
2. **No clock.** Count steps (ticks, frames, moves), not milliseconds. A time is `steps × step length`.
3. **One rules file.** Put the game's rules in one file with no drawing and no input code, and load that same file in the page and on the server.

```js
// rules.js: loaded by the page AND the server
import { seededRandom } from '@fobo/game-sdk'

/** Plays a whole run. Throws when the moves are not ones the game allows. */
export function playRun(seed, moves) {
    const random = seededRandom(seed)
    let score = 0
    for (const move of moves) {
        if (move !== 'left' && move !== 'right') throw new Error('Not a move')
        if (random() < 0.5 === (move === 'left')) score += 1
    }
    return score
}
```

## Tickets: one run, one score

Two holes are left. A player could try a thousand seeds and keep the lucky one, or send the same good run again and again. A **ticket** closes both:

1. Before a run, the page asks your server for a ticket. The server makes up the seed, so the player cannot choose it.
2. After the run, the page sends the ticket back with the moves.
3. The server accepts each ticket once, only from the player it was given to, and only for a while (half an hour unless you change it).

## The verifier does all of it

You write `playRun`. `createVerifier` does the tickets, the single use, the expiry, the player check, the replay, and posting the score with your secret key.

```js
// your server
import { createServerClient, createVerifier } from '@fobo/game-sdk/server'
import { playRun } from './rules.js'

const server = createServerClient({ apiKey: 'pk_...', secretKey: process.env.FOBO_GAME_SECRET })

const verifier = createVerifier({
    server,
    replay: (seed, moves) => playRun(seed, moves),
})

// one web handler for both steps. This shape works as it is on Cloudflare Workers, Bun and Deno
export default { fetch: (request) => verifier.handle(request) }
```

`verifier.handle` takes a standard web `Request` and gives back a `Response`, so it fits any framework: in Next.js, `export const POST = (request) => verifier.handle(request)`. For plain Node's `http` server, build a `Request` from what came in and write the `Response` back.

```js
// your page
import { createGame } from '@fobo/game-sdk'

const game = createGame({ apiKey: 'pk_...', verifyUrl: 'https://mygame.xyz/verify' })

const ticket = await game.startRun() // { id, seed, expiresAt }
const moves = await letThePlayerPlay(ticket.seed)
const score = playRun(ticket.seed, moves)

const board = await game.submitRun({ name: 'ACE', score, run: { ticket: ticket.id, inputs: moves } })
```

The `score` the page sends is only a claim. If the server's replay gives a different number, the run is refused.

Options for `createVerifier`:

| Option          | Default  | Meaning                                                                    |
| --------------- | -------- | -------------------------------------------------------------------------- |
| `replay`        | required | `(seed, inputs) => score`, or `{ score, meta }` to keep data beside it     |
| `board`         | `'main'` | the board the scores go to. Set here, never by the page                    |
| `requireLink`   | `true`   | the player must have linked a wallet                                       |
| `requireHolder` | `false`  | the wallet must hold enough of the token to get a ticket                   |
| `ticketSeconds` | `1800`   | how long a ticket is good for                                              |
| `store`         | memory   | where tickets are kept (see below)                                         |
| `origins`       | none     | other sites allowed to call the handler from a browser. Your own always is |

When a run is refused the page's `submitRun` throws a `GameError` with a message for the player and one of these statuses: 401 link a wallet first, 403 not a holder or not your ticket, 409 ticket already used or too old, 400 the run does not replay or the score does not match.

## Turn it on: `writes: 'server'`

The verifier only helps if the page can no longer post scores by itself. That is the game's `writes` setting:

```js
await server.configure({ writes: 'server' })
```

- `writes: 'client'`: pages may post scores and give or use up items. Easy, and fakeable.
- `writes: 'server'`: only your server may, with the secret key. A page that tries gets `apiCode: 'server_writes_only'`.

**A game that pays prizes needs `writes: 'server'` and a verifier.** Without both, the prize goes to whoever opens the console first.

Your page code does not change: `game.submitRun` sends the run to your `verifyUrl` when the game says `writes: 'server'`.

## Where tickets are kept

By default tickets sit in your server's memory. That is right for one long-running server (Node, Bun, Deno).

It is wrong for Cloudflare Workers and serverless functions, where each request may land on a different copy of your code. There you pass a `store`: an object with two methods.

```ts
interface TicketStore {
    put(ticket): Promise<void> // keep it until ticket.expiresAt (ms)
    take(id): Promise<ticket | null> // give it back AND delete it
}
```

`take` is the important one: a ticket must never be handed out twice, even to two requests that arrive at the same moment.

### Cloudflare D1 (use this one for prizes)

```sql
CREATE TABLE tickets (id TEXT PRIMARY KEY, seed TEXT NOT NULL, owner TEXT, expires_at INTEGER NOT NULL);
```

```js
const d1TicketStore = (db) => ({
    async put({ id, seed, owner, expiresAt }) {
        await db
            .prepare('INSERT INTO tickets (id, seed, owner, expires_at) VALUES (?, ?, ?, ?)')
            .bind(id, seed, owner, expiresAt)
            .run()
    },
    async take(id) {
        // one statement deletes and returns the row, so two requests can never both get it
        const row = await db
            .prepare('DELETE FROM tickets WHERE id = ? RETURNING seed, owner, expires_at')
            .bind(id)
            .first()
        return row ? { id, seed: row.seed, owner: row.owner, expiresAt: row.expires_at } : null
    },
})

export default {
    fetch(request, env) {
        const server = createServerClient({ apiKey: env.FOBO_GAME_KEY, secretKey: env.FOBO_GAME_SECRET })
        const verifier = createVerifier({ server, replay: playRun, store: d1TicketStore(env.DB) })
        return verifier.handle(request)
    },
}
```

Old rows can be cleared now and then with `DELETE FROM tickets WHERE expires_at < ?`. The verifier checks the expiry itself, so a late row does no harm.

### Cloudflare KV (fun boards only)

```js
const kvTicketStore = (kv) => ({
    async put(ticket) {
        // KV removes it by itself when it expires
        await kv.put(ticket.id, JSON.stringify(ticket), { expiration: Math.ceil(ticket.expiresAt / 1000) })
    },
    async take(id) {
        const ticket = await kv.get(id, 'json')
        if (ticket) await kv.delete(id)
        return ticket
    },
})
```

KV cannot read and delete in one step, and its copies around the world take a moment to agree. Two requests sent at the same instant could both get the ticket. That lets a player post the same run twice, which changes nothing on a "best score" board but would count twice on a `total` board. For a prize game use D1 (or any database with a real delete-and-return).

## What this does and does not prove

A replay proves the run **could happen** under your rules, with a seed the player did not choose, once.

It does not prove a human played. A program can play your game well and send honest moves. If that matters, add limits your rules can check (a longest possible run, a fastest possible reaction), ask for a linked wallet that holds the token (`requireHolder: true`), and look at the top of the board before a prize goes out.

Things to check inside `replay`, and to throw on:

- moves that the game would never accept (wrong type, too many, out of order)
- inputs that are huge: cap the length before you loop over them
- anything the page says about the result. Work it all out again

## Try it

- Offline, in a page, with no server: `createGame({ test: { replay: playRun } })` runs the same verifier inside the page. In a unit test, `createTestGame({ replay: playRun })` does the same in memory.
