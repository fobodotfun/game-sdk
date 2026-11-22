# Prizes

A game can have a prize: every day, every week or every month, your choice. One board is the prize board (`isPrize: true`, `main` unless you change it). When its round closes, the best linked wallets that hold enough of the token take the prize places.

Out of the box the prize is daily and the day turns over at 00:00 UTC. Both are yours to change (see below).

Whether a game pays rewards at all is switched on by the token's creator on fobo.fun (`paysRewards`). Everything else is yours to set:

```js
await server.configure({
    holdMin: 100_000, // tokens a wallet must hold to win. 0 = anyone
    prizeShares: [60, 25, 15], // 1st, 2nd, 3rd, in whole percent. Must add up to 100. Up to 10 places
    writes: 'server', // prize games must check scores: see anti-cheat.md
})
```

## How often, and when the day resets

```js
import { highScore } from '@fobo/game-sdk'

await server.configure({
    // the game's day turns over at 5pm New York time (clock changes are handled for you)
    reset: { timeZone: 'America/New_York', hour: 17 },
    // a weekly prize: the prize board must keep that period
    boards: [highScore('main', { isPrize: true, prizePeriod: 'weekly', periods: ['daily', 'weekly', 'all'] })],
})
```

- `reset`: any IANA time zone and a whole hour, 0-23. Default `{ timeZone: 'UTC', hour: 0 }`. It moves every board's day, week and month, from now on (rows already written keep their keys).
- `prizePeriod`: `'daily'` (default), `'weekly'` (Monday to Sunday) or `'monthly'`.
- Sending the prize is always your own server's job: fobo.fun only keeps the pot, the winners and the payouts you report.

## Show it in the game

```js
import { formatCountdown, formatEth } from '@fobo/game-sdk/format'

await game.config() // { title, ticker, holdMin, shares, writes, paysRewards, boards, reset, dayEndsAt }
await game.pot() // this round's prize: { day, period, key, eth, usd, endsAt }
await game.winners('2026-11-20') // the round holding that day: { period, key, winners: [{ place, name, address, sharePct }], unclaimedPct }
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
