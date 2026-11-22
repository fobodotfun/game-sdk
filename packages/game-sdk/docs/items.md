# Items

Skins, clothing, collectibles, badges, achievements, consumables. Your game has a catalogue, and each player owns some of it.

Items are rows in fobo.fun's database. They are not tokens, they are not on a chain, and they cannot be sent to another player.

## The catalogue

Set it from your backend or setup script, with the secret key:

```js
import { createServerClient } from '@fobo/game-sdk/server'

const server = createServerClient({ apiKey: 'pk_...', secretKey: process.env.FOBO_GAME_SECRET })

await server.configure({
    items: [
        { key: 'gold-ship', name: 'Gold ship', kind: 'skin', slot: 'skin', rarity: 'rare' },
        { key: 'first-win', name: 'First win', kind: 'achievement' },
        { key: 'potion', name: 'Potion', kind: 'item', isStackable: true, maxQty: 99 },
    ],
})
```

| Field         | Meaning                                                                                |
| ------------- | -------------------------------------------------------------------------------------- |
| `key`         | lowercase letters, digits and `-`, up to 48 characters                                 |
| `name`        | shown to players, up to 40 characters                                                  |
| `kind`        | your own grouping, up to 24 characters: `'skin'`, `'badge'`, `'achievement'`, `'item'` |
| `image`       | an `https://` URL                                                                      |
| `rarity`      | your own word, up to 16 characters                                                     |
| `slot`        | where it can be worn (`'skin'`, `'head'`). No slot = cannot be equipped                |
| `isStackable` | `true`: a player can own many. Default `false`: owned once                             |
| `maxQty`      | the most a player can own (stackable items only)                                       |
| `meta`        | your own details (stats, colours), up to 2 KB                                          |

Items with a key that exists are updated; new keys are added. A game can have up to 500 items in all. `server.removeItem('potion')` takes an item out of the catalogue and away from every player.

## In the page

```js
await game.items.catalog() // every item in the game
await game.items.mine() // what this player owns: [{ key, qty, meta, acquiredAt }]

await game.items.equip('skin', 'gold-ship') // wear it. Returns the player's profile
await game.items.equip('skin', null) // take it off
```

A player can only equip an item they own, in the slot the item names. What a player wears shows up as `equipped` on their board rows, so you can draw their skin next to their score.

## Giving and using up items

Who may do this depends on the game's `writes` setting.

**`writes: 'client'`** (the default): the page may.

```js
await game.items.grant('first-win')
await game.items.grant('potion', { qty: 3 })
const left = await game.items.consume('potion') // { key, qty } or null when that was the last
```

Easy, and a player can do the same from the browser's console. Fine for fun, wrong for anything that matters.

**`writes: 'server'`**: only your server may, by the player's name.

```js
await server.grantItem('ACE', 'first-win')
await server.consumeItem('ACE', 'potion', 2)
await server.playerItems('ACE')
```

The server calls work in both modes.

## When it says no

Check `err.apiCode`:

| `apiCode`            | Meaning                                               |
| -------------------- | ----------------------------------------------------- |
| `unknown_item`       | no item with that key                                 |
| `already_owned`      | the player has it and it does not stack               |
| `over_max`           | that would be more than `maxQty`                      |
| `not_enough`         | the player owns fewer than asked, or does not own it  |
| `wrong_slot`         | the item goes in another slot, or cannot be worn      |
| `unknown_player`     | your server named a player this game does not have    |
| `server_writes_only` | the page tried, and the game's `writes` is `'server'` |

Using up the last one of an item also takes it off if it was equipped.
