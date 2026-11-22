# Prizes

A game can have a daily prize. One board is the prize board (`isPrize: true`, `main` unless you change it). It closes at 00:00 UTC, and the best linked wallets that hold enough of the token take the prize places.

Whether a game pays rewards at all is switched on by the token's creator on fobo.fun (`paysRewards`). Everything else is yours to set:

```js
await server.configure({
    holdMin: 100_000, // tokens a wallet must hold to win. 0 = anyone
    prizeShares: [60, 25, 15], // 1st, 2nd, 3rd, in whole percent. Must add up to 100. Up to 10 places
    writes: 'server', // prize games must check scores: see anti-cheat.md
})
```

## Show it in the game

```js
import { formatCountdown, formatEth } from '@fobo/game-sdk/format'

await game.config() // { title, ticker, holdMin, shares, writes, paysRewards, boards, dayEndsAt }
await game.pot() // today's prize: { day, eth, usd, endsAt }
await game.winners('2026-11-20') // { winners: [{ place, name, address, sharePct }], unclaimedPct }
await game.payouts() // prizes paid, newest first

// a banner that counts down
const watch = game.potWatch()
watch.start((pot, msLeft) => {
    banner.textContent = pot ? `${formatEth(pot.eth)} ETH · ${formatCountdown(msLeft)}` : ''
})
// watch.stop() when the banner goes away
```

`game.wallet.holds` tells you whether the linked player holds enough to win, so you can say so before they play.

## Games that pay their own prizes

If your own server holds and sends the prize, it can tell fobo.fun what happened so the game and fobo.fun show it:

```js
import { createServerClient, shareOfPot } from '@fobo/game-sdk/server'

const { winners } = await server.winners('2026-11-20')
await server.setPot({ day: '2026-11-21', eth: 0.5, usd: 1500 })

const amountWei = shareOfPot(potWei, winners[0].sharePct) // BigInt, rounded down
// ...you send the prize yourself, then record it
await server.recordPayout({ day: '2026-11-20', place: 1, address: winners[0].address, amountWei, txHash })
```

`recordPayout` is safe to repeat: a transaction is recorded once. The SDK never sends a transaction for you, on the server or in the page.
