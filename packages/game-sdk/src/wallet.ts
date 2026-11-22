import type { Api } from './api.js'
import { errorMessage, GameError } from './errors.js'
import type { FrameHost } from './frame.js'
import { linkMessage } from './protocol.js'
import type { Store } from './storage.js'
import type { Connector, SignedMessage } from './types.js'

/** What the SDK keeps about a linked wallet. The session is a bearer token for this game only. */
export interface SavedLink {
    address: string
    session: string
    name: string | null
    holds: boolean | null
}

/** The player's linked wallet, as a game sees it. */
export interface Wallet {
    /** Whether fobo.fun (or another allowed site) frames the game: the wallet prompt is then fobo.fun's. */
    readonly isFramed: boolean
    /** Whether linking can work right now (framed: fobo.fun answered; standalone: a connector is set). */
    readonly isAvailable: boolean
    /** The linked wallet's address, or null. */
    readonly address: string | null
    /** The player's username in this game, or null. */
    readonly name: string | null
    /** Whether the wallet holds enough of the token (null until known). */
    readonly holds: boolean | null
    /** The session token to send to your own server, or null. */
    readonly session: string | null
    /** Calls `fn` whenever anything above changes. Returns the unsubscribe function. */
    onChange(fn: () => void): () => void
    /** Sets or changes the player's username (GameError with status 409 when taken). */
    setName(name: string): Promise<string | null>
    /** Re-reads the player's name and whether they still hold. */
    refresh(): Promise<void>
    /** Forgets the wallet on this device. */
    unlink(): void
}

export interface WalletLinkOptions {
    api: Api
    store: Store<SavedLink>
    /** The conversation with the framing page, or null when the game runs on its own page. */
    frame: FrameHost | null
    connector: Connector | null
    /** The game's host as the signed text states it. */
    host: () => string
}

const isSavedLink = (value: unknown): value is SavedLink =>
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SavedLink).session === 'string' &&
    typeof (value as SavedLink).address === 'string'

/** Links a wallet to the game and keeps the link: through the framing page when framed, else through a connector. */
export class WalletLink implements Wallet {
    readonly isFramed: boolean
    private readonly api: Api
    private readonly store: Store<SavedLink>
    private readonly frame: FrameHost | null
    private readonly host: () => string
    private connector: Connector | null
    private saved: SavedLink | null
    private linking: Promise<string> | null = null
    private readonly listeners = new Set<() => void>()

    constructor({ api, store, frame, connector, host }: WalletLinkOptions) {
        this.api = api
        this.store = store
        this.frame = frame
        this.host = host
        this.connector = connector
        this.isFramed = frame !== null
        const stored = store.get()
        this.saved = isSavedLink(stored) ? stored : null
    }

    get isAvailable(): boolean {
        return this.frame ? this.frame.origin !== null : this.connector !== null
    }

    get address(): string | null {
        return this.saved?.address ?? null
    }

    get name(): string | null {
        return this.saved?.name ?? null
    }

    get holds(): boolean | null {
        return this.saved?.holds ?? null
    }

    get session(): string | null {
        return this.saved?.session ?? null
    }

    onChange(fn: () => void): () => void {
        this.listeners.add(fn)
        return () => {
            this.listeners.delete(fn)
        }
    }

    /** Tells listeners something changed. One broken listener never stops the others. */
    emit(): void {
        for (const fn of this.listeners) {
            try {
                fn()
            } catch (err) {
                console.error('[fobo-game] wallet listener', errorMessage(err))
            }
        }
    }

    /** Sets the connector used when the game runs on its own page. Framed, fobo.fun's wallet is always used. */
    useConnector(connector: Connector): void {
        this.connector = connector
        if (!this.isFramed) this.emit()
    }

    /**
     * Links the player's wallet: one signature of a fixed text, no transaction.
     * @returns the linked address
     */
    link(): Promise<string> {
        // one prompt at a time: a second tap joins the first
        this.linking ??= this.linkAndClear()
        return this.linking
    }

    private async linkAndClear(): Promise<string> {
        try {
            return await this.linkOnce()
        } finally {
            this.linking = null
        }
    }

    private async linkOnce(): Promise<string> {
        // picked before the nonce is fetched, so a page with no wallet never burns one
        const sign = this.signer()
        const nonce = await this.api.nonce()
        const signed = await sign(nonce, this.host())
        const { session, address, name, holds } = await this.api.link({ ...signed, nonce })
        this.save({ address, session, name: name ?? null, holds: holds ?? null })
        return address
    }

    /** Who signs the link text: the framing page when framed, else the connector. */
    private signer(): (nonce: string, host: string) => Promise<SignedMessage> {
        const { frame, connector } = this
        if (frame) {
            if (frame.origin === null) throw new GameError('wallet', 'This page offers no wallet')
            return (nonce, host) => frame.requestLink(nonce, host)
        }
        if (!connector)
            throw new GameError('config', 'No wallet connector: pass one to createGame or call useConnector()')
        return (nonce, host) => connector.sign(linkMessage(host, nonce))
    }

    async refresh(): Promise<void> {
        const session = this.saved?.session
        if (!session) return
        try {
            const player = await this.api.player({ session })
            // the player may have unlinked or relinked while the request was out
            if (this.saved?.session !== session) return
            if (player.name !== this.saved.name || player.holds !== this.saved.holds) {
                this.save({ ...this.saved, name: player.name, holds: player.holds })
            }
        } catch (err) {
            if (err instanceof GameError && err.status === 401) return this.unlink()
            console.error('[fobo-game] refreshing the player', errorMessage(err))
        }
    }

    async setName(name: string): Promise<string | null> {
        const saved = this.saved
        if (!saved) throw new GameError('wallet', 'Link a wallet first')
        let player
        try {
            player = await this.api.player({ session: saved.session, name })
        } catch (err) {
            if (err instanceof GameError && err.status === 401) this.unlink()
            throw err
        }
        if (this.saved?.session === saved.session) this.save({ ...this.saved, name: player.name, holds: player.holds })
        return player.name
    }

    /** Keeps the name the board says the wallet plays under. */
    rememberName(name: string | null | undefined): void {
        if (!this.saved || !name || name === this.saved.name) return
        this.save({ ...this.saved, name })
    }

    unlink(): void {
        if (this.saved) this.save(null)
    }

    private save(saved: SavedLink | null): void {
        this.saved = saved
        this.store.set(saved)
        this.emit()
    }
}
