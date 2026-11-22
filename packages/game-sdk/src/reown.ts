import { CONNECT_WAIT_MS, GameError, signWithProvider, type Connector, type Eip1193Provider } from './index.js'
import { createAppKit } from '@reown/appkit'
import { EthersAdapter } from '@reown/appkit-adapter-ethers'
import { robinhood, type AppKitNetwork } from '@reown/appkit/networks'

const PROJECT_ID_PATTERN = /^[0-9a-f]{32}$/i

/** The part of an AppKit instance the connector uses. A real `createAppKit()` result fits as it is. */
export interface AppKitLike {
    getAddress(): string | undefined
    getWalletProvider(): unknown
    open(options?: { view: 'Connect' }): Promise<unknown>
    subscribeAccount(callback: (account: { isConnected: boolean; address?: string }) => void): () => void
    subscribeState(callback: (state: { open: boolean }) => void): () => void
}

/** What the wallet shows the player about the game. */
export interface ReownMetadata {
    name: string
    description: string
    /** Must match the page's origin, or wallets warn the player. */
    url: string
    icons: string[]
}

/** Let the connector create AppKit, on the first sign. */
export interface ReownProjectOptions {
    /** The game's own Reown project id (dashboard.reown.com). Its domain allowlist must hold every origin the game runs on. */
    projectId: string
    metadata: ReownMetadata
    /** Networks offered in the modal. Robinhood Chain when left out. */
    networks?: [AppKitNetwork, ...AppKitNetwork[]]
}

/** Reuse the AppKit the game already made. */
export interface ReownInstanceOptions {
    appKit: AppKitLike
}

export type ReownOptions = ReownProjectOptions | ReownInstanceOptions

function isProvider(value: unknown): value is Eip1193Provider {
    return typeof value === 'object' && value !== null && 'request' in value && typeof value.request === 'function'
}

/** The connected address, opening the modal on its Connect view when nothing is connected yet. */
function connect(kit: AppKitLike): Promise<string> {
    const connected = kit.getAddress()
    if (connected) return Promise.resolve(connected)
    return new Promise((resolve, reject) => {
        const cleanups: Array<() => void> = []
        let isDone = false
        let wasOpen = false

        const finish = (address: string | undefined, cause?: unknown) => {
            if (isDone) return
            isDone = true
            for (const cleanup of cleanups) cleanup()
            if (address) resolve(address)
            else reject(new GameError('wallet', 'No wallet connected', 0, { cause }))
        }

        const timer = setTimeout(() => finish(undefined), CONNECT_WAIT_MS)
        cleanups.push(() => clearTimeout(timer))
        cleanups.push(
            kit.subscribeAccount((account) => {
                if (account.isConnected && account.address) finish(account.address)
            })
        )
        cleanups.push(
            kit.subscribeState((state) => {
                if (state.open) wasOpen = true
                // closing the modal without connecting is a "no"
                else if (wasOpen) finish(kit.getAddress())
            })
        )

        const openModal = async () => {
            try {
                await kit.open({ view: 'Connect' })
            } catch (err) {
                finish(undefined, err)
            }
        }
        void openModal()
    })
}

/**
 * A wallet connector on Reown AppKit: installed wallets and WalletConnect wallets (QR on desktop, deep link on
 * phones). It only asks for a signature: never a network switch, never a transaction.
 * @param options the game's Reown project (AppKit is created on the first sign), or an AppKit the game already has
 * @returns a connector for `createGame({ connector })` or `game.useConnector()`
 * @throws GameError 'config' when the project id is not a Reown project id
 */
export function reownConnector(options: ReownOptions): Connector {
    if (!('appKit' in options) && !PROJECT_ID_PATTERN.test(options.projectId)) {
        throw new GameError(
            'config',
            "reownConnector needs the game's Reown projectId (32 hex characters from dashboard.reown.com)"
        )
    }
    let created: AppKitLike | undefined

    const appKit = (): AppKitLike => {
        if ('appKit' in options) return options.appKit
        created ??= createAppKit({
            adapters: [new EthersAdapter()],
            networks: options.networks ?? [robinhood],
            projectId: options.projectId,
            metadata: options.metadata,
            themeMode: 'dark',
            // a game only needs the wallet list
            features: {
                analytics: false,
                email: false,
                socials: false,
                swaps: false,
                onramp: false,
                send: false,
                history: false,
            },
        })
        return created
    }

    return {
        async sign(message) {
            const kit = appKit()
            const address = await connect(kit)
            const provider = kit.getWalletProvider()
            if (!isProvider(provider)) throw new GameError('wallet', 'The wallet is not ready: try again')
            // sign with the account AppKit shows as connected, whatever order the wallet lists its accounts in
            return signWithProvider(provider, message, address)
        },
    }
}
