# Plain HTML example

A whole game in [`index.html`](index.html): tap for five seconds, post the score, show the board, link a wallet. No build step, no key (it uses the in-memory test game).

```sh
pnpm install && pnpm build   # in the repo root, once
pnpm --filter example-plain-html dev
```

On your own site, import the SDK from `https://unpkg.com/@fobo/game-sdk@0.1.1/dist/browser/game-sdk.js` and add your key: `createGame({ apiKey: 'pk_...' })`.
