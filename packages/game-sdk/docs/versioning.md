# Versions

There are two version numbers: the API's and the SDK's.

## The API

The API's version is in its address: `https://fobo.fun/api/games/v1`.

- Inside `v1`, things are only ever added: new fields, new routes, new optional settings. A call that works today keeps working the same.
- A change that would break a game ships as `v2`, on a new address. `v1` keeps running.
- `game.config()` answers with `apiVersion: 1`.

The whole API is written down in [api-v1.md](api-v1.md).

## The SDK

`@fobo/game-sdk` follows semantic versioning:

- **Patch** (0.1.0 to 0.1.1): fixes. Safe to take.
- **Minor** (0.1 to 0.2): new features. While the version starts with `0.`, a minor release may also change how something works. The changelog says so at the top when it does.
- **Major** (1 to 2): something you use may have changed. Read the changelog first.

From 1.0 on, one major version of the SDK speaks one version of the API. `createGame({ apiVersion })` exists so that is explicit, but only `1` exists and you can leave it out.

Install an exact version in a script tag (`@fobo/game-sdk@0.1.0`), never `@latest`: your game should only change when you change it.

What changed in each release: [CHANGELOG](../CHANGELOG.md).

## What the SDK tells fobo.fun

Every request carries one extra header, `X-Fobo-Game-Sdk: @fobo/game-sdk/0.1.0`: the package and its version. It lets fobo.fun see which versions are in use before retiring anything. It says nothing about the player.

```js
import { SDK_VERSION } from '@fobo/game-sdk'
```

## What it runs on

- Browsers: anything from the last few years (ES2022).
- Servers: Node 20 or newer, Bun, Deno, Cloudflare Workers.
- ES modules only (`import`, not `require`).
- The connectors must be the same version line as the SDK they are used with.
