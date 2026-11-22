# Saved data

A small box of data for each player in your game: their level, xp, settings, what they have unlocked. It lives on fobo.fun, so it follows the player to any device where they link the same wallet.

```js
await game.save.set({ level: 4, xp: 1250, sound: false })

const data = await game.save.get() // { level: 4, xp: 1250, sound: false }
const { level } = await game.save.get(['level']) // only some keys

await game.save.remove(['sound']) // returns what is left
```

`set` writes the keys you pass and leaves the others alone. Every call needs a linked wallet.

## Limits

- Keys: letters, digits, `_`, `.` and `-`, up to 48 characters.
- Values: anything JSON can hold (numbers, text, true/false, lists, objects).
- 64 keys per player, 16 KB per value, 64 KB per player in total.

Over a limit, the call throws a `GameError` with code `input` (the SDK caught it before sending) or `apiCode: 'too_large'`.

## Do not trust it for prizes

The page writes this data, so a player can write it too, with any value they like. Use it for progress and settings. Never decide a prize, a rank or a reward from it.

For data only you can change, write it from your server instead, by the player's name:

```js
import { createServerClient } from '@fobo/game-sdk/server'

const server = createServerClient({ apiKey: 'pk_...', secretKey: process.env.FOBO_GAME_SECRET })

await server.setPlayerData('ACE', { season: 3 })
await server.getPlayerData('ACE')
await server.removePlayerData('ACE', ['season'])
```

It is the same box: the page can still read and overwrite those keys. If a value must be tamper-proof, keep it in your own database.
