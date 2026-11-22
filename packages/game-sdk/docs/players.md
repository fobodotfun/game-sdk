# Players

A player is a wallet linked to your game. Linking is one click and one signature of a short readable message. It is never a transaction.

```js
linkButton.onclick = async () => {
    await game.link()
}
```

On fobo.fun the player's fobo.fun wallet signs, and you write nothing else. On your own site see the [connectors](wallets.md).

## Who is playing

```js
game.wallet.address // '0x1234…abcd' (shortened, for showing) or null
game.wallet.name // their username in your game, or null
game.wallet.holds // holds enough of the token: true, false, or null until known

game.wallet.onChange(() => render()) // runs when any of these change
game.wallet.unlink() // forgets the player on this device
```

The link is remembered on the device, so a returning player is still linked.

## The profile

```js
const me = await game.player.get()
me.name // 'ACE', or null until they pick one
me.avatar // a square picture's URL. Always there
me.avatarSource // 'game' (uploaded here), 'fobo' (their fobo.fun picture) or 'generated'
me.isHolder // holds enough of the token
me.equipped // { skin: 'gold-ship' }
```

Every call on `game.player` needs a linked wallet. Without one it throws a `GameError` with code `wallet`.

## Names and pictures

```js
await game.player.setName('ACE') // 1 to 16 characters. A taken name throws with status 409

await game.player.setAvatar(fileInput.files[0]) // PNG, JPEG, WebP or GIF, at most 1 MB
await game.player.removeAvatar() // back to their fobo.fun picture
```

Every player has a picture even if they never upload one. Names and pictures set here belong to your game only: a game can never change a player's fobo.fun profile.

## Other players

Board rows already carry `name`, `avatar` and `equipped`. To look players up by name:

```js
const players = await game.players(['ACE', 'ZED']) // up to 50 names
// [{ name, avatar, equipped }], one for every name asked, in the same order
```

An avatar is an image URL (png, webp or svg) that loads from any site. Show it in an `<img>`. A made-up face is an svg, so if you draw avatars on a canvas, be ready for one.

Wallet addresses of other players are never sent to a page.
