<p align="center">
    <img src="https://unpkg.com/@fobo/game-sdk@0.2.0/assets/logo.png" alt="FOBO Game SDK" width="120" />
</p>

<h1 align="center">@fobo/game-sdk</h1>

<p align="center">The client for <a href="https://fobo.fun">fobo.fun</a>'s Game Center: leaderboards, players, items, saved data, prizes and anti-cheat for browser games.</p>

<p align="center">
    <a href="https://www.npmjs.com/package/@fobo/game-sdk"><img src="https://img.shields.io/npm/v/@fobo/game-sdk?color=5CFFE4&label=npm" alt="npm version" /></a>
    <a href="https://unpkg.com/@fobo/game-sdk@0.2.0/LICENSE"><img src="https://img.shields.io/npm/l/@fobo/game-sdk?color=blue" alt="MIT licence" /></a>
    <a href="https://www.npmjs.com/package/@fobo/game-sdk"><img src="https://img.shields.io/npm/types/@fobo/game-sdk" alt="TypeScript types included" /></a>
    <a href="https://www.npmjs.com/package/@fobo/game-sdk?activeTab=dependencies"><img src="https://img.shields.io/badge/dependencies-0-brightgreen" alt="zero dependencies" /></a>
</p>

## 📦 Install

```sh
npm install @fobo/game-sdk
```

No build step? Import the one-file browser build:

```html
<script type="module">
    import { createGame } from 'https://unpkg.com/@fobo/game-sdk@0.2.0/dist/browser/game-sdk.js'
</script>
```

- ESM and CommonJS, types included, no runtime dependencies.
- The browser build is about 18 kB gzipped.

## 🚀 Quick start

```js
import { createGame } from '@fobo/game-sdk'

const game = createGame() // no apiKey = test mode

const board = await game.submitRun({ name: 'ACE', score: 1200 })
console.log(board.top) // [{ name: 'ACE', score: 1200, ... }]
```

## 🧪 Test mode and live mode

|         | `createGame()`                     | `createGame({ apiKey: 'pk_...' })` |
| ------- | ---------------------------------- | ---------------------------------- |
| Mode    | test (`game.isTest === true`)      | live                               |
| Data    | this browser only (`localStorage`) | kept on fobo.fun                   |
| Network | none                               | fobo.fun's API                     |
| Wallet  | a made-up one                      | the player's                       |

- Every method works in both modes.
- `game.resetTestData()` wipes the test data.
- To go live, add your game on fobo.fun. You get two keys:
    - `pk_...`: public, goes in your page. It only works from your game's own site.
    - `sk_...`: secret, only for your server. Never put it in a page or in git.

## 🎮 What is on `game`

| Call                                                                    | What it does                                         | Guide                                                                       |
| ----------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------- |
| `game.submitRun({ name, score })`                                       | 🏆 posts a score, returns the board                  | [Leaderboards](https://unpkg.com/@fobo/game-sdk@0.2.0/docs/leaderboards.md) |
| `game.board({ board, name })`                                           | 🏆 a board's ranking and the player's own row        | [Leaderboards](https://unpkg.com/@fobo/game-sdk@0.2.0/docs/leaderboards.md) |
| `game.link()`                                                           | 👛 links the player's wallet with one signed message | [Wallets](https://unpkg.com/@fobo/game-sdk@0.2.0/docs/wallets.md)           |
| `game.player.get()` / `setName()` / `setAvatar()`                       | 👤 the player's name and picture                     | [Players](https://unpkg.com/@fobo/game-sdk@0.2.0/docs/players.md)           |
| `game.items.catalog()` / `mine()` / `grant()` / `consume()` / `equip()` | 🎒 skins, badges, things a player can use up         | [Items](https://unpkg.com/@fobo/game-sdk@0.2.0/docs/items.md)               |
| `game.save.get()` / `set()` / `remove()`                                | 💾 progress and settings, the same on every device   | [Saved data](https://unpkg.com/@fobo/game-sdk@0.2.0/docs/saved-data.md)     |
| `game.pot()` / `winners()` / `payouts()`                                | 💰 the prize (daily, weekly, monthly), if turned on  | [Prizes](https://unpkg.com/@fobo/game-sdk@0.2.0/docs/prizes.md)             |
| `game.startRun()`                                                       | 🛡️ a one-time run ticket from your server            | [Anti-cheat](https://unpkg.com/@fobo/game-sdk@0.2.0/docs/anti-cheat.md)     |

- A failed call throws a `GameError` with a message you can show the player: [Errors](https://unpkg.com/@fobo/game-sdk@0.2.0/docs/errors.md).
- Up to 100 boards per game: high score, fastest time, daily, weekly, monthly and all-time.

## 🛡️ Anti-cheat

A score sent from a page can be faked by anyone with the browser console open. That is fine for a fun board. It is not fine once a score is worth a prize.

The SDK ships the fix: your server plays each run again and posts the score itself.

1. **One rules file**, loaded by the page and the server. No `Math.random()` (use `seededRandom(seed)` from the SDK) and no clock.
2. **Tickets.** Your server hands out the seed before a run. Each ticket works once, for one player, for half an hour.
3. **Replay.** The page sends the player's moves. Your server replays them, and only the score it works out is posted.
4. **Lock the board** with `writes: 'server'`, so pages can no longer post scores by themselves.

```js
// your server (Cloudflare Workers, Bun, Deno, Next.js, Node)
import { createServerClient, createVerifier } from '@fobo/game-sdk/server'
import { playRun } from './rules.js'

const server = createServerClient({ apiKey: 'pk_...', secretKey: process.env.FOBO_GAME_SECRET })
const verifier = createVerifier({ server, replay: (seed, moves) => playRun(seed, moves) })

export default { fetch: (request) => verifier.handle(request) }
```

```js
// your page
const game = createGame({ apiKey: 'pk_...', verifyUrl: 'https://mygame.xyz/verify' })

const ticket = await game.startRun() // { id, seed, expiresAt }
const moves = await letThePlayerPlay(ticket.seed)
await game.submitRun({ name: 'ACE', score, run: { ticket: ticket.id, inputs: moves } })
```

⚠️ A game that pays prizes needs both the verifier and `writes: 'server'`. Full guide, with ticket stores for Cloudflare: [Anti-cheat](https://unpkg.com/@fobo/game-sdk@0.2.0/docs/anti-cheat.md).

## 👛 Wallets

- The SDK only ever asks a wallet to sign a short readable message. It never sends a transaction and never asks for an approval.
- On fobo.fun your game runs in a frame, and fobo.fun's own prompt links the wallet. You write no wallet code: `await game.link()`.
- On your own site, pass a connector for the wallet library you already use. The SDK never loads one you did not install.

| Library                                 | Import                 | Also install                                        |
| --------------------------------------- | ---------------------- | --------------------------------------------------- |
| Reown AppKit                            | `@fobo/game-sdk/reown` | `@reown/appkit @reown/appkit-adapter-ethers ethers` |
| Privy (React)                           | `@fobo/game-sdk/privy` | `@privy-io/react-auth react`                        |
| wagmi (RainbowKit, ConnectKit, Dynamic) | `@fobo/game-sdk/wagmi` | `@wagmi/core viem`                                  |

```js
import { reownConnector } from '@fobo/game-sdk/reown'

game.useConnector(
    reownConnector({
        projectId: 'your Reown project id', // from dashboard.reown.com
        metadata: { name: 'My game', description: 'Beat the board', url: location.origin, icons: [] },
    })
)
```

Privy and wagmi examples: [Wallets](https://unpkg.com/@fobo/game-sdk@0.2.0/docs/wallets.md).

## 🖥️ Server

`@fobo/game-sdk/server` is for Node, Workers, Bun and Deno. It uses your secret key.

```js
import { createServerClient, highScore } from '@fobo/game-sdk/server'

const server = createServerClient({
    apiKey: 'pk_...',
    secretKey: process.env.FOBO_GAME_SECRET, // your sk_... key
})

await server.configure({
    title: 'My game',
    writes: 'server',
    boards: [highScore('main', { title: 'High scores' })],
    items: [{ key: 'gold-ship', name: 'Gold ship', kind: 'skin' }],
})
```

- `configure` sets boards, items and prize rules. It is safe to run again: only what you pass changes.
- With no `secretKey` it throws. There is no silent test mode on a server.

## ✅ Testing

```js
import { createTestGame, createTestServer } from '@fobo/game-sdk/testing'

const game = createTestGame() // in memory, fresh every time
const server = createTestServer() // the server client with no keys and no network
```

In a page, `createGame({ test: { boards, items, writes: 'server', replay: playRun } })` sets the test game up. The `test` part is ignored once you add an `apiKey`.

## 📚 Docs

- 🏆 [Leaderboards](https://unpkg.com/@fobo/game-sdk@0.2.0/docs/leaderboards.md)
- 👤 [Players](https://unpkg.com/@fobo/game-sdk@0.2.0/docs/players.md)
- 🎒 [Items](https://unpkg.com/@fobo/game-sdk@0.2.0/docs/items.md)
- 💾 [Saved data](https://unpkg.com/@fobo/game-sdk@0.2.0/docs/saved-data.md)
- 💰 [Prizes](https://unpkg.com/@fobo/game-sdk@0.2.0/docs/prizes.md)
- 🛡️ [Anti-cheat](https://unpkg.com/@fobo/game-sdk@0.2.0/docs/anti-cheat.md)
- 👛 [Wallets](https://unpkg.com/@fobo/game-sdk@0.2.0/docs/wallets.md)
- ❗ [Errors](https://unpkg.com/@fobo/game-sdk@0.2.0/docs/errors.md)
- 🔖 [Versioning](https://unpkg.com/@fobo/game-sdk@0.2.0/docs/versioning.md)
- 🔌 [API v1](https://unpkg.com/@fobo/game-sdk@0.2.0/docs/api-v1.md): every route the SDK calls
- 🤖 [`llms.txt`](https://unpkg.com/@fobo/game-sdk@0.2.0/llms.txt): the whole SDK on one page, for AI assistants

All of it ships inside the package too: `node_modules/@fobo/game-sdk/docs`.

## 📄 Terms and licence

- Your game is yours: you build it, host it and answer for it. Adding a game to fobo.fun means you agree to the [terms](https://fobo.fun/terms#games).
- Questions, or a security problem to report in private: [@fobodev](https://x.com/fobodev) on X.
- MIT, the fobo.fun team.
