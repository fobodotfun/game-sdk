# Security

## Reporting a problem

Please do not open a public issue for a security problem. Report it privately:

- GitHub: **Security → Report a vulnerability** on this repository, or
- X: a direct message to [@fobodev](https://x.com/fobodev).

Say what you found and how to reproduce it. We answer within two working days and credit you in the fix unless you ask us not to.

## What the SDK does and does not do

- **A signature, never a transaction.** Linking a wallet asks for one `personal_sign` of a short readable text that names the game's site and a one-time code. The SDK never sends a transaction, never asks for an approval and never switches chains.
- **No keys.** The SDK and its connectors never see a private key or a seed phrase.
- **The public key is public.** `pk_...` is safe in a page. The secret key (`sk_...`) is only for `@fobo/game-sdk/server`; `createGame` refuses it and `createServerClient` refuses to run in a page.
- **Only fobo.fun can sign for a framed game.** Messages are taken only from the page that frames the game, and only when that page is `https://fobo.fun`. Any other site that frames a game gets no wallet requests.
- **HTTPS only.** API and verifier URLs must be `https://` (plain `http://` is allowed for `localhost` while developing).
- **What is stored.** One `localStorage` entry on the game's own site: the linked address (shortened), the player's name and a session token for this game. `game.wallet.unlink()` removes it.
- **No dependencies.** `@fobo/game-sdk` installs nothing else. The connectors (`/reown`, `/privy`, `/wagmi`) use a wallet library that you install yourself; the rest of the SDK never loads one.
- **Nothing is run from text.** No `eval`, no code loaded at run time, and JSON from the network is parsed with every `__proto__` key dropped, so it cannot change how objects behave.

## Scores

A score posted from a page can be faked by the player. Games that pay prizes must set `writes: 'server'` and post scores from their own server after replaying the run (`createVerifier` in `@fobo/game-sdk/server`). See [docs/anti-cheat.md](docs/anti-cheat.md).
