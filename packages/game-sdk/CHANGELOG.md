# Changelog

What changed for games that use the SDK. Versions follow [semver](https://semver.org); see docs/versioning.md.

## 0.1.1

- A shorter README, written as a reference, with the anti-cheat steps in it. No code changes.

## 0.1.0

First release.

- **Leaderboards**: `game.submitRun`, `game.board`, up to 100 boards per game with presets (`highScore`, `fastestTime`, `lowestScore`, `total`, `wins`, `longestStreak`, `survivalTime`, `rating`) and daily, weekly, monthly and all-time lists.
- **Players**: `game.link()` (one message signature, never a transaction), `game.player` for names and pictures, `game.players` to look others up.
- **Items**: a catalogue per game, `game.items` to list, equip, give and use up.
- **Saved data**: `game.save`, a small box of data for each player.
- **Prizes**: `game.pot`, `game.winners`, `game.payouts`, `game.potWatch`.
- **Setup from code**: `server.configure({ title, holdMin, prizeShares, writes, boards, items })` and `server.settings()` in `@fobo/game-sdk/server`.
- **Checked scores**: `createVerifier` with one-time tickets, `game.startRun`, `seededRandom`, and the `writes: 'server'` setting.
- **Test mode**: `createGame()` with no `apiKey` runs against a test Game Center inside the page, and keeps its data in the browser. Adding `apiKey` is the only change to go live. `createTestGame`, `createTestServer` and `createMockApi` in `@fobo/game-sdk/testing` are the same thing for unit tests.
- **Wallet connectors** for a game's own site, as part of this package: `@fobo/game-sdk/reown`, `@fobo/game-sdk/privy`, `@fobo/game-sdk/wagmi`. The wallet libraries are optional: install only the one you use.
- **No build step**: `dist/browser/game-sdk.js` is the SDK in one file; `dist/browser/reown.js` is the Reown connector with AppKit inside.
- No runtime dependencies.
