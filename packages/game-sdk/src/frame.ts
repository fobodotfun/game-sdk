import { GameError } from './errors.js'
import { isRecord } from './json.js'
import { FEATURE_LINK, MSG, type LinkError } from './protocol.js'
import type { SignedMessage } from './types.js'

/** How long the game keeps saying hello to the page framing it. */
const HOST_WAIT_MS = 5000
const READY_EVERY_MS = 500
/** How long the player has to answer the wallet. */
const SIGN_WAIT_MS = 3 * 60 * 1000

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/
const SIGNATURE_PATTERN = /^0x[0-9a-fA-F]+$/

const LINK_ERROR_TEXT: Record<LinkError, string> = {
    cancelled: 'The wallet request was cancelled',
    busy: 'Another wallet request is already open',
    failed: 'The wallet could not sign',
}

interface PendingLink {
    nonce: string
    resolve(signed: SignedMessage): void
    reject(err: GameError): void
    timer: ReturnType<typeof setTimeout>
}

/**
 * Whether another site frames this page. A same-origin parent (the game's own wrapper page) does not count.
 */
export function isFramedByAnotherSite(): boolean {
    if (typeof window === 'undefined' || window.parent === window) return false
    try {
        return window.top?.location.origin !== window.location.origin
    } catch {
        // reading a cross-origin parent's location throws: that is the answer
        return true
    }
}

/**
 * The game's side of the conversation with the fobo.fun page that frames it. The game never touches the wallet
 * here: it asks the parent, and fobo.fun shows its own prompt and builds the signed text itself.
 *
 * A message counts only when it comes from the direct parent window AND from an allowed origin; requests are
 * posted to that origin only.
 */
export class FrameHost {
    /** The parent's origin once it has said it can link, else null. */
    origin: string | null = null
    private pending: PendingLink | null = null
    private readyTimer: ReturnType<typeof setInterval> | null = null

    constructor(
        private readonly origins: ReadonlySet<string>,
        private readonly onHost: () => void
    ) {}

    /** Starts listening, and says hello until the parent answers or HOST_WAIT_MS passes. */
    start(): void {
        window.addEventListener('message', this.onMessage)
        const startedAt = Date.now()
        const sayReady = () => {
            if (this.origin !== null || Date.now() - startedAt > HOST_WAIT_MS) return this.stopReady()
            // '*' because the parent's origin is unknown until it answers; the hello carries nothing
            window.parent.postMessage({ type: MSG.READY }, '*')
        }
        this.readyTimer = setInterval(sayReady, READY_EVERY_MS)
        sayReady()
    }

    stop(): void {
        window.removeEventListener('message', this.onMessage)
        this.stopReady()
        this.settle()?.reject(new GameError('wallet', 'The game stopped listening'))
    }

    /**
     * Asks the parent to have the player's wallet sign the link text for this nonce and host.
     * @throws GameError ('wallet') when the player cancels, the parent is busy, or nobody answers
     */
    requestLink(nonce: string, host: string): Promise<SignedMessage> {
        const origin = this.origin
        if (origin === null) return Promise.reject(new GameError('wallet', 'This page offers no wallet'))
        this.settle()?.reject(new GameError('wallet', 'Replaced by a new request'))
        return new Promise<SignedMessage>((resolve, reject) => {
            const timer = setTimeout(
                () => this.settle()?.reject(new GameError('wallet', 'No answer from the wallet')),
                SIGN_WAIT_MS
            )
            this.pending = { nonce, resolve, reject, timer }
            window.parent.postMessage({ type: MSG.LINK_REQUEST, nonce, host }, origin)
        })
    }

    private stopReady(): void {
        if (this.readyTimer !== null) clearInterval(this.readyTimer)
        this.readyTimer = null
    }

    /** Takes the pending request, if any, so it can be answered exactly once. */
    private settle(): PendingLink | null {
        const pending = this.pending
        if (pending) clearTimeout(pending.timer)
        this.pending = null
        return pending
    }

    private readonly onMessage = (event: MessageEvent): void => {
        if (event.source !== window.parent || !this.origins.has(event.origin)) return
        const data: unknown = event.data
        if (!isRecord(data)) return
        if (data.type === MSG.HOST) return this.onHostMessage(data, event.origin)
        if (data.type === MSG.LINK_RESULT) return this.onLinkResult(data, event.origin)
    }

    private onHostMessage(data: Record<string, unknown>, origin: string): void {
        if (!Array.isArray(data.features) || !data.features.includes(FEATURE_LINK)) return
        if (this.origin === origin) return
        this.origin = origin
        this.stopReady()
        this.onHost()
    }

    private onLinkResult(data: Record<string, unknown>, origin: string): void {
        if (!this.pending || origin !== this.origin) return
        // an answer that names a nonce must name ours: a late answer to an older request is not this one's
        if (data.nonce !== undefined && data.nonce !== this.pending.nonce) return
        const pending = this.settle()
        if (!pending) return
        const { address, signature, error } = data
        if (
            typeof address === 'string' &&
            ADDRESS_PATTERN.test(address) &&
            typeof signature === 'string' &&
            SIGNATURE_PATTERN.test(signature)
        ) {
            return pending.resolve({ address, signature })
        }
        const text =
            typeof error === 'string' && error in LINK_ERROR_TEXT
                ? LINK_ERROR_TEXT[error as LinkError]
                : LINK_ERROR_TEXT.failed
        pending.reject(new GameError('wallet', text))
    }
}
