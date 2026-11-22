# Errors

Everything the SDK throws is a `GameError`. Its `message` is written to be shown to players.

| Field     | What it is                                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code`    | `http`, `network`, `timeout`, `bad_response`, `config`, `input` (a value you passed is wrong), `wallet`                                                                               |
| `status`  | the HTTP status when the API answered: 401 the session ended, 403 not allowed, 409 name taken, 429 slow down                                                                          |
| `apiCode` | the API's own reason: `unknown_board`, `unknown_period`, `unknown_item`, `unknown_player`, `wrong_slot`, `already_owned`, `over_max`, `not_enough`, `too_large`, `server_writes_only` |

```js
import { GameError } from '@fobo/game-sdk'

try {
    await game.items.consume('potion')
} catch (err) {
    if (err instanceof GameError && err.apiCode === 'not_enough') openShop()
    else if (err instanceof GameError) toast(err.message)
}
```

What to do with each `code`:

- `input`, `config`: a bug in the game. The message says which value is wrong.
- `network`, `timeout`: the player is offline or the request was slow. Let them try again.
- `wallet`: the player closed the wallet prompt, or has no linked wallet. Show the message.
- `http`: the API said no. Look at `status` and `apiCode`.
- `bad_response`: the answer was not what the SDK expected. Check you are on the newest SDK.
