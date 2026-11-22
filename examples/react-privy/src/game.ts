import { createGame } from '@fobo/game-sdk'

const apiKey = import.meta.env.VITE_FOBO_GAME_KEY as string | undefined

/** One game object for the whole app. Without a key it runs in test mode. */
export const game = createGame({ apiKey })
