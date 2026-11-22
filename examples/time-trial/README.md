# Time trial example

A tiny game that cannot be cheated by editing the page: dodge rocks, fastest run wins.

- [`rules.js`](rules.js): the game's rules. The page and the server both load it.
- [`server.js`](server.js): sets the game up with `configure` (a `fastestTime` board, a badge item, `writes: 'server'`), then checks each run with `createVerifier` and gives the "Clean run" badge.
- [`index.html`](index.html): the page. It asks for a ticket, plays, and sends what the player did.

```sh
pnpm install && pnpm build   # in the repo root, once
pnpm --filter example-time-trial dev
```

With no keys it runs offline against the SDK's in-memory copy of the API. With your own game's keys:

```sh
FOBO_GAME_KEY=pk_... FOBO_GAME_SECRET=sk_... pnpm --filter example-time-trial dev
```

How it works, and why: [docs/anti-cheat.md](../../docs/anti-cheat.md).
