import { errorMessage } from './errors.js'
import type { Pot } from './types.js'

const TICK_MS = 1000
const REFRESH_MS = 60_000

/** Called every second with the pot (null until it loads) and the time left in the day. */
export type PotRender = (pot: Pot | null, msLeft: number) => void

/**
 * Keeps a prize pot and its countdown on screen: ticks every second, reloads the pot every minute and when the day
 * rolls over.
 */
export class PotWatch {
    private pot: Pot | null = null
    private loadedAt = 0
    private isLoading = false
    private timer: ReturnType<typeof setInterval> | null = null
    private render: PotRender | null = null

    constructor(private readonly loadPot: () => Promise<Pot>) {}

    /** Starts (or restarts) the countdown. */
    start(render: PotRender): void {
        this.stop()
        this.render = render
        this.tick()
        this.timer = setInterval(() => this.tick(), TICK_MS)
    }

    stop(): void {
        if (this.timer !== null) clearInterval(this.timer)
        this.timer = null
        this.render = null
    }

    private tick(): void {
        const now = Date.now()
        const isStale = now - this.loadedAt > REFRESH_MS || (this.pot !== null && now >= this.pot.endsAt)
        if (isStale && !this.isLoading) void this.load()
        this.render?.(this.pot, this.pot ? Math.max(0, this.pot.endsAt - now) : 0)
    }

    private async load(): Promise<void> {
        this.isLoading = true
        try {
            this.pot = await this.loadPot()
        } catch (err) {
            console.error('[fobo-game] pot', errorMessage(err))
        } finally {
            // also after a failure, so a broken API is retried once a minute, not once a second
            this.loadedAt = Date.now()
            this.isLoading = false
        }
    }
}
