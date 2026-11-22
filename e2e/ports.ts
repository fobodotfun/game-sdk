/** Three sites on this machine: different ports are different origins, as in production. */
export const FOBO_PORT = 4310
export const GAME_PORT = 4311
export const STRANGER_PORT = 4312

/** The stand-in for fobo.fun: it frames the game, answers its wallet requests and serves the API. */
export const FOBO_ORIGIN = `http://localhost:${FOBO_PORT}`
/** The game's own site. */
export const GAME_ORIGIN = `http://127.0.0.1:${GAME_PORT}`
/** A site that frames the game without being allowed to. */
export const STRANGER_ORIGIN = `http://localhost:${STRANGER_PORT}`

/** A throwaway key (anvil's first account): never holds anything. */
export const WALLET_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
