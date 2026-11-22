# FOBO Game API v1: contract

The one source of truth for what `https://fobo.fun/api/games/v1` serves and what `@fobo/game-sdk` calls. The site
and the SDK are both built against this file. Everything here is additive to what v1 already serves: a call that
worked before works the same (no `board` means `main`, no `period` means `daily`).

## Versioning

- The version is in the path: `/api/games/v1`. Within a version, changes are additive only (new fields, new routes,
  new optional params). Anything breaking ships as `/api/games/v2`, and v1 keeps working.
- `GET /config` returns `apiVersion: 1`.
- The SDK sends `X-Fobo-Game-Sdk: <package>/<version>` on every request. An SDK major version targets one API
  version (`createGame({ apiVersion })` defaults to it; only `1` exists).
- Auth, CORS, error shape and rate limiting follow what v1 already does (publishable key, player session from the
  wallet link, secret key for server calls). New routes reuse those exactly.

## Trust mode

A game has one write mode, `writes: 'client' | 'server'` (today's `score_writes`, widened): who may post scores and
grant or consume items.

- `client`: the browser may, with the player's session. Easy, and easy to fake. Not for prize games.
- `server`: only the game's backend may, with the secret key.

Returned by `GET /config`.

## 1. Leaderboards

A game has up to 100 boards, `main` included. Every game starts with `main` (highest score wins, best run kept,
daily + all-time).

```ts
type Board = {
    key: string // ^[a-z0-9][a-z0-9-]{0,31}$
    title: string // <= 40 chars
    sort: 'desc' | 'asc' // desc: highest wins. asc: lowest wins (times, moves)
    mode: 'best' | 'sum' | 'latest'
    format: 'number' | 'time' | 'decimal'
    decimals?: number // 0..6, for 'decimal' (fixed point: 1234 with decimals 2 shows 12.34)
    unit?: string // <= 8 chars, shown after the value ('m', 'kills')
    periods: Array<'daily' | 'weekly' | 'monthly' | 'all'> // at least one
    isPrize: boolean // at most one board; it decides winners. Must include 'daily'
}
```

- Scores are whole numbers (`0 .. 2^53-1`). `time` is milliseconds.
- `best`: a player's best per period is kept (by `sort`). `sum`: each post is added (post the amount gained, `> 0`).
  `latest`: the last post replaces the value (ratings, current level).
- Ties: whoever reached the value first (the API keeps the order scores arrived in, so two posts in the same second
  still rank in order). Posting a `latest` value equal to the one kept changes nothing, the place in a tie included.
- A `sum` that would pass `2^53-1`: plain 400.
- Periods are UTC. Period keys: daily `YYYY-MM-DD`, weekly ISO `YYYY-Www`, monthly `YYYY-MM`, all-time `all`.

Presets the SDK exports (plain `Board` fragments):

| Preset                                   | sort | mode   | format |
| ---------------------------------------- | ---- | ------ | ------ |
| `highScore`                              | desc | best   | number |
| `fastestTime`                            | asc  | best   | time   |
| `lowestScore` (fewest moves, golf)       | asc  | best   | number |
| `total` (kills, coins, xp over a period) | desc | sum    | number |
| `wins`                                   | desc | sum    | number |
| `longestStreak`                          | desc | best   | number |
| `survivalTime`                           | desc | best   | time   |
| `rating` (elo, level)                    | desc | latest | number |

Rounds and levels are one board each (`round-1`, `level-3`), with `fastestTime` or `highScore`.

Routes:

- `GET /config` adds `boards: Board[]`, `apiVersion`, `writes`, `paysRewards`, and keeps `title`.
- `PUT /boards` (secret key) `{ boards: Board[] }`: replaces the game's boards. Removing a board hides it; its rows
  are kept and come back if the key is defined again. `main` can be changed but not removed: a list without it
  keeps the `main` the game has, and an empty list leaves `main` alone. When another board is the prize board,
  `main` stops being it. More than 100 boards (with `main`), a key used twice, two prize boards or a prize board
  without `daily`: plain 400.
- `POST /scores` adds optional `board` (default `main`). Unknown board: 400 `unknown_board`.
- `GET /board?board=&period=&at=&limit=&name=`: `period` defaults to `daily`, or to the board's first period when
  it keeps no daily; `at` is any `YYYY-MM-DD` inside the period wanted (default today); a period the board does
  not keep: 400 `unknown_period`. Rows:
  `{ rank, name, avatar, score, meta, equipped, updatedAt }`, plus the asked player's own row when `name` is given
  and they are outside the page (as today).
- `GET /winners`, `GET|POST /pot`, `GET|POST /payouts`: the prize board, daily, unchanged.

## 2. Players

A player is a wallet linked to the game. Their profile in a game:

```ts
type Player = {
    name: string
    avatar: string // absolute https URL of a square image, always present
    avatarSource: 'game' | 'fobo' | 'generated'
    isHolder: boolean
    equipped: Record<string, string> // slot -> item key
    createdAt: number
}
```

- Avatar, first that exists: the picture the player uploaded in this game, their fobo.fun profile picture, the face
  fobo.fun generates for their wallet (so every wallet has one, fobo.fun user or not). A name that is not linked to
  a wallet gets a face generated from the name. The URL is an image URL (png, webp or svg): opaque, cacheable, and
  served with `Access-Control-Allow-Origin: *`. A generated face is an svg, so a game that draws pictures on a
  canvas must be ready for one.
- A game can never change a player's fobo.fun profile. Names and pictures set through the API belong to that game.
- Wallet addresses are never returned to the browser.

Routes:

- `GET /player` (session) -> `Player`. With the secret key: `?player=<name>`; a name no wallet in the game has:
  404 `unknown_player`. The same holds for every route the secret key uses with `player`. The secret key with no
  `player` and no session: plain 400. A page (no secret key) that names a `player`: 401.
- `POST /player` (session) `{ name }`: set or change the username (existing route and rules).
- `POST /player/avatar` (session): an image, at most 1 MB (png, jpeg, webp, gif first frame). Re-encoded to a
  256 px square on fobo.fun. -> `Player`.
- `DELETE /player/avatar` (session): back to the fobo.fun picture. -> `Player`.
- `GET /players?names=a,b,c` (publishable key, up to 50): `{ players: Array<{ name, avatar, equipped }> }`. Every
  name asked is answered, in the order asked: a name with no wallet behind it gets its generated face and nothing
  equipped. No names, a malformed name or more than 50: plain 400.

## 3. Saved data

A small key-value store per player per game, for progress and settings (level, xp, options, unlock flags).

- `GET /player/data?keys=a,b` (session; no `keys` = all) -> `{ data: Record<string, Json> }`.
- `PUT /player/data` (session) `{ set?: Record<string, Json>, remove?: string[] }` -> `{ data }`.
- Secret key may read and write any player's data by adding `player: <name>`.
- Limits: key `^[a-zA-Z0-9_.-]{1,48}$`, 64 keys, 16 KB per value, 64 KB per player.
- The browser can write it, so a player can edit it. Never base prizes on it.

## 4. Items

Skins, clothing, collectibles, badges, achievements, consumables. A catalogue per game, and what each player owns.
Items live in fobo.fun's database only: they are not tokens, not on-chain and cannot be sent to another player.

```ts
type Item = {
    key: string // ^[a-z0-9][a-z0-9-]{0,47}$
    name: string // <= 40 chars
    kind: string // <= 24 chars, the game's own grouping: 'skin', 'clothing', 'item', 'badge', 'achievement'
    image?: string // https URL
    rarity?: string // <= 16 chars
    slot?: string // <= 24 chars: where it can be equipped ('skin', 'head'). None = not equippable
    isStackable: boolean // false: a player owns it once
    maxQty?: number // stackable only: sending it for an item that is not stackable is a 400
    meta?: Json // <= 2 KB, the game's own details (stats, colours)
}
type OwnedItem = { key: string; qty: number; meta?: Json; acquiredAt: number }
```

Routes:

- `GET /items` (publishable key) -> `{ items: Item[] }`.
- `PUT /items` (secret key) `{ items: Item[] }`: add or update by key; items not sent stay as they are. A game
  holds up to 500 items in all: a call that would pass that, an empty list, or a key sent twice is a plain 400.
- `DELETE /items/:key` (secret key): removes it from the catalogue and from every player.
- `GET /player/items` (session) -> `{ items: OwnedItem[] }`.
- `POST /player/items/grant` `{ item, qty?, meta? }` and `POST /player/items/consume` `{ item, qty? }`
  -> `{ item: OwnedItem | null }`. With the session only when `writes` is `client`; with the secret key
  (`player: <name>`) always. Errors: `unknown_item`, `already_owned`, `over_max`, `not_enough`. No `item`:
  plain 400.
- `POST /player/equip` (session) `{ slot, item: string | null }`: the player must own it and its `slot` must match.
  Checked in this order: the item exists (404 `unknown_item`), it goes in that slot (400 `wrong_slot`, also for an
  item with no slot), the player owns it (409 `not_enough`). `item: null` empties the slot. -> `Player`.

## 5. Game settings

A game is set up from its own backend with the secret key, not on a form. The form on fobo.fun keeps only the game's
URL, its picture, wallet connection on/off and pays rewards on/off.

```ts
type GameSettings = {
    title: string
    holdMin: number // whole tokens a wallet must hold to win a prize; 0 = anyone
    shares: number[] // the prize split by place: 1..10 places, each a whole percent from 1, summing to exactly 100
    writes: 'client' | 'server'
    paysRewards: boolean // read-only here: the creator sets it on fobo.fun
    walletLink: boolean // read-only here: the creator sets it on fobo.fun
    boards: Board[]
    items: Item[]
}
```

- `GET /game` (secret key) -> `GameSettings`.
- `PUT /game` (secret key) `{ title?: string (<= 40), holdMin?: string | number (>= 0 whole tokens, 0 = anyone),
shares?: number[] (1..10 places, each a whole percent from 1, summing to exactly 100), writes?: 'client' | 'server' }`
  -> `GameSettings`. Only the fields sent change. `paysRewards` and `walletLink` cannot be set here. A title that
  was never set is the token's name. `holdMin` is whole tokens: a fraction is a plain 400.
- Boards and items keep their own routes (`PUT /boards`, `PUT /items`).

## Wire details

What the sections above leave open, fixed here so the site and the SDK agree.

- Session: routes marked (session) read it from the `X-Fobo-Game-Session` header. `POST /scores` and `POST /player`
  also keep reading `session` from the JSON body, as today. CORS allows `X-Fobo-Game-Session` and `X-Fobo-Game-Sdk`,
  and the methods `GET, POST, PUT, DELETE, OPTIONS`.
- Secret key acting for a player: `player` in the JSON body, `?player=` on a `GET`.
- Times are seconds since epoch (`createdAt`, `updatedAt`, `acquiredAt`), like `dayEndsAt` today.
- `GET /config` keeps `scoreWrites` (same value as `writes`). `POST /player` keeps today's answer
  (`{ address, name, holds, holdMin }`); `Player.name` is `null` until the wallet has a username.
- `GET /board` answers `{ board, period, key, day, top, you }`: `key` is the period key, `day` the UTC day asked
  (as today). Rows keep `linked`. `limit` is 1..100, default 20 (what v1 always answered). `?day=` still works as
  `at`, and the SDK sends both, so an API from before boards still answers the day asked.
- `POST /scores` answers as `GET /board` for that board and the posted name, on its `daily` period (its first
  period when it keeps no daily). `meta` stays at most 512 bytes as JSON. A score posted with a session goes
  under the wallet's username: a `name` in the body is ignored.
- Linking: `POST /link/nonce` then `POST /link` `{ address, signature, nonce }`, both from a page of the game (the
  `Origin` is the site the signed text names; none: plain 400). A malformed address, signature or nonce: plain 400.
  The signature is checked before the nonce is used up: a wrong signature is 401 and the nonce still works; a
  nonce that is unknown, used or expired is 401. `POST /link` answers the full address in lower case to the page
  that just signed with it; `POST /player` answers it shortened.
- Auth statuses: an unknown or missing publishable key 401; a missing, unknown or expired session 401; a wrong
  secret key 401; a secret-key route called without one 401; a write with no `Origin` and no secret key 401.
- `GET /pot` and `GET /winners` take `?day=YYYY-MM-DD` (default today, UTC). `POST /pot` (secret key)
  `{ day?, eth, usd }`: both amounts are numbers from 0 (as today).
- `POST /payouts` (secret key) `{ day, place, address, amountWei, txHash }`: `place` is 1..the number of places in
  `shares`; a transaction is recorded once (sending it again answers the same record; one recorded for another
  game is a plain 400). `GET /payouts?limit=`: 1..50, default 10, newest first.
- A new game's `main`: `{ title: 'High score', sort: 'desc', mode: 'best', format: 'number',
periods: ['daily', 'all'], isPrize: true }`.
- `PUT /boards` answers `{ boards }`. `PUT /items` and `DELETE /items/:key` answer `{ items }` (the catalogue after).
- `POST /player/avatar` takes the raw image bytes as the body, with the image's `Content-Type`.
- Items: `qty` is a whole number from 1 (default 1). Granting an item that is not stackable to a player who owns it:
  `already_owned`. Going past `maxQty`: `over_max`. Consuming more than owned, or equipping an item the player does
  not own: `not_enough`. Consuming the last one removes it (`{ item: null }`) and unequips it. An item granted with
  `meta` keeps it (<= 2 KB).

## Errors

The existing shape (`{ error, code }` with the HTTP status). New codes: `unknown_board`, `unknown_period`,
`unknown_item`, `unknown_player`, `wrong_slot`, `already_owned`, `over_max`, `not_enough`, `too_large`,
`server_writes_only`.

Statuses: `unknown_board`, `unknown_period`, `wrong_slot` 400; `unknown_item`, `unknown_player` 404;
`already_owned`, `over_max`, `not_enough` 409; `too_large` 413; `server_writes_only` 403. An error with no specific code has no `code` field (as today).
