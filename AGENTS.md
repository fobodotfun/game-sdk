# AGENTS.md

For AI assistants. Two kinds of reader:

## You are adding the SDK to a game

Read [`llms.txt`](llms.txt). It is the whole SDK on one page. The short version:

1. No keys yet: `createTestGame()` from `@fobo/game-sdk/testing`. Never invent a key.
2. Page: `createGame({ apiKey: 'pk_...' })`, once, outside any component.
3. Setup is ONE call from a script or server: `server.configure({ title, holdMin, prizeShares, writes, boards, items })` with `@fobo/game-sdk/server`. The fobo.fun form only holds the game's URL, picture, wallet connection on/off and pays rewards on/off. Everything else is this call.
4. Play it on fobo.fun first: that is the safe route, with no wallet code. Connectors (`@fobo/game-sdk/reown`, `/privy`, `/wagmi`) are optional, for the game's own site.
5. The secret key (`sk_...`) never goes in page code, a commit or a chat. Environment variable only.
6. The SDK only ever asks a wallet for a message signature. Never add a transaction, an approval or a network switch for it.
7. A game that pays prizes needs `writes: 'server'` and `createVerifier`: [docs/anti-cheat.md](docs/anti-cheat.md).

## You are working on this repo

- One published package: `packages/game-sdk` (`@fobo/game-sdk`). `examples/*` and `e2e/` only use it.
- [docs/api-v1.md](docs/api-v1.md) is the contract with fobo.fun. The SDK and the mock (`src/testing.ts`) follow it; change it only for a real gap and say so.
- `pnpm check` (format, lint, build, types, unit tests, browser tests) and `pnpm release:check` must pass.
- Style: 4 spaces, no semicolons, single quotes, trailing commas. JSDoc on every export. `try/catch`, never `.catch()`. Static imports only. Comments say why.
- The core has no dependencies and never imports a connector. Wallet libraries are optional peers, imported only by `src/reown.ts`, `src/privy.ts`, `src/wagmi.ts`.
- `src/server.ts` must keep refusing to run in a page, and no page entry may reach code that sends the secret key (`release:check` tests both).
- Words not used in docs: "bundle", "bundler", "guaranteed". No person's name anywhere: the author is "The fobo.fun team", contact @fobodev.
- Never publish, tag or push. Releases are in [RELEASING.md](RELEASING.md).
