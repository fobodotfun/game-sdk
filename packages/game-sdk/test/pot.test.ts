import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PotWatch } from '../src/pot.js'
import type { Pot } from '../src/types.js'

const START = Date.UTC(2026, 0, 1, 23, 59, 0)
const pot = (endsAt: number): Pot => ({
    day: '2026-01-01',
    period: 'daily',
    key: '2026-01-01',
    eth: 1,
    usd: 3000,
    endsAt,
})

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(START)
})
afterEach(() => vi.useRealTimers())

describe('PotWatch', () => {
    it('renders at once, then every second with the time left', async () => {
        const load = vi.fn(async () => pot(START + 60_000))
        const render = vi.fn()
        const watch = new PotWatch(load)
        watch.start(render)
        expect(render).toHaveBeenLastCalledWith(null, 0)
        await vi.advanceTimersByTimeAsync(1000)
        expect(render).toHaveBeenLastCalledWith(pot(START + 60_000), 59_000)
        expect(load).toHaveBeenCalledTimes(1)
        watch.stop()
        await vi.advanceTimersByTimeAsync(5000)
        expect(render).toHaveBeenCalledTimes(2)
    })

    it('reloads when the day rolls over', async () => {
        const load = vi.fn(async () => pot(START + 10_000))
        const watch = new PotWatch(load)
        watch.start(() => undefined)
        await vi.advanceTimersByTimeAsync(9000)
        expect(load).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(1000)
        expect(load).toHaveBeenCalledTimes(2)
        watch.stop()
    })

    it('retries a failing API once a minute, not once a second', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const load = vi.fn(async (): Promise<Pot> => {
            throw new Error('down')
        })
        const watch = new PotWatch(load)
        watch.start(() => undefined)
        await vi.advanceTimersByTimeAsync(30_000)
        expect(load).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(31_000)
        expect(load).toHaveBeenCalledTimes(2)
        watch.stop()
    })
})
