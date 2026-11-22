import { useEffect, useState, useSyncExternalStore } from 'react'
import { GameError, type BoardEntry } from '@fobo/game-sdk'
import { usePrivyConnector } from '@fobo/game-sdk/privy'
import { game } from './game'

const DICE = 5
const SIDES = 6

/** The linked wallet's address, kept in step with the SDK. */
function useWalletAddress(): string | null {
    return useSyncExternalStore(
        (onChange) => game.wallet.onChange(onChange),
        () => game.wallet.address
    )
}

export function App() {
    // game.link() now signs with the player's Privy wallet (and opens Privy's login when needed)
    usePrivyConnector(game)
    const address = useWalletAddress()
    const [name, setName] = useState('')
    const [top, setTop] = useState<BoardEntry[]>([])
    const [status, setStatus] = useState('')

    /** Runs an SDK call; its errors are written for players, so show them. */
    const attempt = async (action: () => Promise<void>) => {
        try {
            await action()
        } catch (err) {
            if (!(err instanceof GameError)) throw err
            setStatus(err.message)
        }
    }

    useEffect(() => {
        void attempt(async () => setTop((await game.board()).top))
    }, [])

    const roll = () =>
        attempt(async () => {
            const score = Array.from({ length: DICE }, () => 1 + Math.floor(Math.random() * SIDES)).reduce(
                (sum, die) => sum + die,
                0
            )
            const board = await game.submitRun({ name: name.trim() || 'ANON', score })
            setTop(board.top)
            setStatus(`You rolled ${score}. Rank #${board.you?.rank ?? '-'} today.`)
        })

    const link = () =>
        attempt(async () => {
            await game.link()
            if (game.wallet.name) setName(game.wallet.name)
        })

    return (
        <main>
            <h1>Dice Duel</h1>
            <input value={name} maxLength={16} placeholder="Your name" onChange={(e) => setName(e.target.value)} />
            <button onClick={() => void roll()}>Roll</button>
            <button onClick={() => void link()}>{address ?? 'Link wallet'}</button>
            <p>{status}</p>
            <ol>
                {top.map((row) => (
                    <li key={row.rank}>
                        {row.name}: {row.score}
                    </li>
                ))}
            </ol>
        </main>
    )
}
