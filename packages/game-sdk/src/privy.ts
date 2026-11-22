import { CONNECT_WAIT_MS, eip1193Connector, GameError, type Connector } from './index.js'
import { useConnectWallet, useLogin, usePrivy, useWallets, type ConnectedWallet } from '@privy-io/react-auth'
import { useEffect, useMemo, useRef } from 'react'

/** Anything that takes a connector: the game from `createGame()`. */
export interface ConnectorHost {
    useConnector(connector: Connector): void
}

interface Waiter {
    resolve(wallet: ConnectedWallet): void
    reject(err: GameError): void
}

/**
 * A wallet connector on Privy, for games already inside a `<PrivyProvider>`. Signs with the player's Privy wallet
 * (embedded or external); when there is none it opens Privy's login or connect modal and waits. It only asks for a
 * signature: never a network switch, never a transaction.
 * @param game when passed, the connector is set on it (`game.useConnector`) once the component mounts
 * @returns a connector that stays the same object across renders
 */
export function usePrivyConnector(game?: ConnectorHost): Connector {
    const waiters = useRef(new Set<Waiter>())

    // Privy reports a closed modal or a failed login here
    const onError = (code: string) => {
        for (const waiter of [...waiters.current])
            waiter.reject(new GameError('wallet', 'No wallet connected', 0, { cause: code }))
    }
    const { ready, authenticated } = usePrivy()
    const { login } = useLogin({ onError })
    const { connectWallet } = useConnectWallet({ onError })
    const { wallets } = useWallets()
    const wallet = wallets.find((candidate) => candidate.type === 'ethereum')

    // sign() outlives the render it was created in, so it reads the newest Privy state from here
    const latest = useRef({ ready, authenticated, wallet, login, connectWallet })
    useEffect(() => {
        latest.current = { ready, authenticated, wallet, login, connectWallet }
        if (!wallet) return
        for (const waiter of [...waiters.current]) waiter.resolve(wallet)
    })

    const connector = useMemo<Connector>(() => {
        const waitForWallet = (): Promise<ConnectedWallet> => {
            const privy = latest.current
            if (!privy.ready) return Promise.reject(new GameError('wallet', 'The wallet is not ready: try again'))
            return new Promise((resolve, reject) => {
                const stop = () => {
                    clearTimeout(timer)
                    waiters.current.delete(waiter)
                }
                const waiter: Waiter = {
                    resolve(found) {
                        stop()
                        resolve(found)
                    },
                    reject(err) {
                        stop()
                        reject(err)
                    },
                }
                const timer = setTimeout(
                    () => waiter.reject(new GameError('wallet', 'No wallet connected')),
                    CONNECT_WAIT_MS
                )
                waiters.current.add(waiter)
                if (privy.authenticated) privy.connectWallet()
                else privy.login()
            })
        }
        return {
            async sign(message) {
                const signer = latest.current.wallet ?? (await waitForWallet())
                return eip1193Connector(() => signer.getEthereumProvider()).sign(message)
            },
        }
    }, [])

    useEffect(() => {
        game?.useConnector(connector)
    }, [game, connector])

    return connector
}
