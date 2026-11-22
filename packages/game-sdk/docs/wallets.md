# Wallets

Players link a wallet so prizes have somewhere to go and names cannot be copied.

**Linking is one signature of a short readable message. The SDK never sends a transaction, never asks for an approval, never switches network and never sees a private key.** The message names your game's site and a one-time code, nothing else.

**Inside fobo.fun there is nothing to sign at all.** When your game runs in fobo.fun's frame, the player taps Link on fobo.fun's own prompt and fobo.fun vouches for the wallet they are signed in with there. Your game never opens a wallet, and the SDK needs no connector for it. The signature is only for players on your own site.

```js
linkButton.onclick = async () => {
    const address = await game.link() // '0x1234…abcd'
}
```

## On fobo.fun: nothing to do

Your game runs in a frame on fobo.fun. `game.link()` asks fobo.fun, and fobo.fun shows its own prompt with the player's fobo.fun wallet. You write no wallet code and install nothing. This is the safe route, and the one to start with.

## On your own site: optional connectors

If you also host the game on your own domain, `game.link()` uses the wallet in the player's browser (MetaMask and the like). Want a wallet picker, QR codes or email login? Use a connector. They are part of `@fobo/game-sdk`; you only install the wallet library itself.

| Your game uses                             | Import from            | Also install                                                  |
| ------------------------------------------ | ---------------------- | ------------------------------------------------------------- |
| Nothing yet (Reown AppKit / WalletConnect) | `@fobo/game-sdk/reown` | `@reown/appkit @reown/appkit-adapter-ethers ethers`           |
| Privy (React)                              | `@fobo/game-sdk/privy` | `@privy-io/react-auth react`                                  |
| wagmi, RainbowKit, ConnectKit, Dynamic     | `@fobo/game-sdk/wagmi` | `@wagmi/core viem`                                            |
| Any other wallet object                    | `@fobo/game-sdk`       | nothing: `eip1193Connector(provider)`, or write the one below |

Importing a connector without its library stops with an error that names the missing package (`Cannot find package '@reown/appkit'`). Install it and try again.

### Reown AppKit

Installed wallets, a QR code on desktop, deep links on phones.

```js
import { reownConnector } from '@fobo/game-sdk/reown'

game.useConnector(
    reownConnector({
        projectId: 'your Reown project id', // your own, from dashboard.reown.com
        metadata: {
            name: 'My game',
            description: 'Beat the board',
            url: location.origin,
            icons: [`${location.origin}/icon.png`],
        },
    })
)
```

- Add every site the game runs on to the Reown project's domain allowlist.
- AppKit is created on the first link, not at page load. Already have one? Pass it: `reownConnector({ appKit })`.
- `networks` defaults to Robinhood Chain.
- No build step: `dist/browser/reown.js` has AppKit inside. Host the whole `dist/browser` folder (it loads its own `chunks/` from next to it) and import `reownConnector` from it in a `<script type="module">`.

### Privy

A React hook, for anywhere inside your `<PrivyProvider>`.

```jsx
import { usePrivyConnector } from '@fobo/game-sdk/privy'
import { game } from './game' // createGame({ apiKey: 'pk_...' }), outside any component

export function LinkWallet() {
    usePrivyConnector(game)
    return <button onClick={() => game.link()}>Link wallet</button>
}
```

A logged-out player gets Privy's login; a logged-in player with no Ethereum wallet gets Privy's connect screen.

### wagmi

```js
import { wagmiConnector } from '@fobo/game-sdk/wagmi'

game.useConnector(wagmiConnector({ config, openConnect: () => openConnectModal() }))
```

`config` is the wagmi config your game already uses. `openConnect` opens your connect screen when the player links with no wallet connected (RainbowKit's `openConnectModal`, ConnectKit's `setOpen(true)`). Without it, linking while disconnected fails with "Connect a wallet first".

### Your own

A connector is one function. Anything that can sign a message works:

```js
game.useConnector({
    async sign(message) {
        const signature = await signer.signMessage(message)
        return { address: await signer.getAddress(), signature }
    },
})
```

Every connector waits up to three minutes for the player.

## After linking

See [players.md](players.md): names, pictures, and what `game.wallet` tells you.
