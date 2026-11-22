import { CONNECT_WAIT_MS, GameError, type Connector } from './index.js'
import { getConnection, signMessage, watchConnection, type Config } from '@wagmi/core'
import { BaseError, UserRejectedRequestError, type Address } from 'viem'

export interface WagmiOptions {
    /** The wagmi config the game already uses. */
    config: Config
    /**
     * Opens the game's connect UI (RainbowKit's openConnectModal, ConnectKit's setOpen(true)...). Called when the
     * player links with no wallet connected. Without it, linking while disconnected fails.
     */
    openConnect?: () => void | Promise<void>
}

function walletError(err: unknown): GameError {
    if (err instanceof GameError) return err
    const isRejected =
        err instanceof BaseError &&
        err.walk((cause) => cause instanceof UserRejectedRequestError) instanceof UserRejectedRequestError
    if (isRejected) return new GameError('wallet', 'The wallet request was cancelled', 0, { cause: err })
    const reason = err instanceof BaseError ? err.shortMessage : err instanceof Error ? err.message : String(err)
    return new GameError('wallet', `The wallet could not sign: ${reason}`, 0, { cause: err })
}

/** Resolves with the next connected address, or rejects after CONNECT_WAIT_MS. */
function nextAddress(config: Config): Promise<Address> {
    return new Promise((resolve, reject) => {
        const stop = () => {
            clearTimeout(timer)
            unwatch()
        }
        const timer = setTimeout(() => {
            stop()
            reject(new GameError('wallet', 'No wallet connected'))
        }, CONNECT_WAIT_MS)
        const unwatch = watchConnection(config, {
            onChange(connection) {
                if (!connection.address) return
                stop()
                resolve(connection.address)
            },
        })
    })
}

/**
 * A wallet connector on wagmi: works with anything built on it (RainbowKit, ConnectKit, Dynamic, plain wagmi).
 * It only asks for a signature: never a network switch, never a transaction.
 * @param options the game's wagmi config and, optionally, how to open its connect UI
 * @returns a connector for `createGame({ connector })` or `game.useConnector()`
 */
export function wagmiConnector({ config, openConnect }: WagmiOptions): Connector {
    const connectedAddress = async (): Promise<Address> => {
        const connection = getConnection(config)
        if (connection.address) return connection.address
        // a page load that is still restoring the last wallet settles by itself: only a real "disconnected" needs the UI
        if (connection.status !== 'disconnected') return nextAddress(config)
        if (!openConnect) throw new GameError('wallet', 'Connect a wallet first')
        const waiting = nextAddress(config)
        await openConnect()
        return waiting
    }

    return {
        async sign(message) {
            try {
                const address = await connectedAddress()
                const signature = await signMessage(config, { account: address, message })
                return { address, signature }
            } catch (err) {
                throw walletError(err)
            }
        },
    }
}
