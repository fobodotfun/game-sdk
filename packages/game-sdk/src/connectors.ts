import { errorMessage, GameError } from './errors.js'
import type { Connector, SignedMessage } from './types.js'

/** The standard wallet provider interface (EIP-1193): window.ethereum and everything shaped like it. */
export interface Eip1193Provider {
    request(args: { method: string; params?: unknown[] }): Promise<unknown>
}

/** How long a connector waits for the player to connect a wallet in its own UI. */
export const CONNECT_WAIT_MS = 3 * 60 * 1000

/** EIP-1193's "the user said no". */
const USER_REJECTED = 4001

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/

/** A message as the hex personal_sign takes. */
export function utf8ToHex(text: string): string {
    let hex = '0x'
    for (const byte of new TextEncoder().encode(text)) hex += byte.toString(16).padStart(2, '0')
    return hex
}

function walletError(err: unknown): GameError {
    if (err instanceof GameError) return err
    const code = typeof err === 'object' && err !== null && 'code' in err ? (err as { code: unknown }).code : null
    if (code === USER_REJECTED) return new GameError('wallet', 'The wallet request was cancelled', 0, { cause: err })
    return new GameError('wallet', `The wallet could not sign: ${errorMessage(err)}`, 0, { cause: err })
}

/**
 * Signs a message with an EIP-1193 provider (asks to connect when it has to).
 * The one place the SDK talks to a wallet: only eth_requestAccounts and personal_sign, nothing else.
 * @param provider the wallet's provider
 * @param message the text to sign
 * @param account the account to sign with; the provider's first account when left out
 * @returns the signer's address and its signature
 * @throws GameError ('wallet') when the player says no or the wallet fails
 */
export async function signWithProvider(
    provider: Eip1193Provider,
    message: string,
    account?: string
): Promise<SignedMessage> {
    try {
        let address = account
        if (!address) {
            const accounts = await provider.request({ method: 'eth_requestAccounts' })
            address = Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] : undefined
        }
        if (!address || !ADDRESS_PATTERN.test(address)) throw new GameError('wallet', 'No wallet connected')
        const signature = await provider.request({ method: 'personal_sign', params: [utf8ToHex(message), address] })
        if (typeof signature !== 'string') throw new GameError('wallet', 'The wallet did not return a signature')
        return { address, signature }
    } catch (err) {
        throw walletError(err)
    }
}

/**
 * A connector over any EIP-1193 provider you already have (a wallet SDK's provider, window.ethereum...).
 * @param provider the provider, or a function that returns it when the player links
 */
export function eip1193Connector(
    provider: Eip1193Provider | (() => Eip1193Provider | Promise<Eip1193Provider>)
): Connector {
    return {
        async sign(message) {
            const resolved = typeof provider === 'function' ? await provider() : provider
            return signWithProvider(resolved, message)
        },
    }
}

interface AnnouncedWallet {
    info: { rdns: string; name: string }
    provider: Eip1193Provider
}

/** The wallets the browser announces right now (EIP-6963); wallets answer the request synchronously. */
function announcedWallets(): AnnouncedWallet[] {
    const found: AnnouncedWallet[] = []
    const onAnnounce = (event: Event) => {
        const detail = (event as CustomEvent<AnnouncedWallet | undefined>).detail
        if (detail?.provider && typeof detail.info?.rdns === 'string') found.push(detail)
    }
    window.addEventListener('eip6963:announceProvider', onAnnounce)
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    window.removeEventListener('eip6963:announceProvider', onAnnounce)
    return found
}

export interface InjectedOptions {
    /** Prefer one wallet by its reverse-DNS id (e.g. 'io.metamask', 'io.rabby'). */
    rdns?: string
}

/**
 * The wallet in the player's browser (an extension, or a wallet app's own browser). No dependencies, no modal:
 * what the SDK uses on its own when the game sets no connector.
 */
export function injectedConnector({ rdns }: InjectedOptions = {}): Connector {
    const findProvider = (): Eip1193Provider => {
        const wallets = announcedWallets()
        const preferred = rdns ? wallets.find((w) => w.info.rdns === rdns) : wallets[0]
        const legacy = (window as { ethereum?: Eip1193Provider }).ethereum
        const provider = preferred?.provider ?? (rdns ? undefined : legacy)
        if (!provider) throw new GameError('wallet', 'No wallet found in this browser')
        return provider
    }
    return eip1193Connector(findProvider)
}
