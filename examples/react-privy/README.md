# React + Privy example

A dice game with Privy login. `usePrivyConnector(game)` is the whole wallet integration: see [`src/App.tsx`](src/App.tsx).

```sh
pnpm install && pnpm build   # in the repo root, once
cp examples/react-privy/.env.example examples/react-privy/.env   # add your Privy app id
pnpm --filter example-react-privy dev
```

Without `VITE_FOBO_GAME_KEY` it runs on the in-memory test game, so you can try it before you have a key.
