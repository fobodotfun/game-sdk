import { describe, expect, it } from 'vitest'
import { compactNumber, formatCountdown, formatEth, formatUsd, shortAddress } from '../src/format.js'

describe('format', () => {
    it('shortens addresses', () => {
        expect(shortAddress('0x00000000000000000000000000000000000f0b0f')).toBe('0x0000…0b0f')
        expect(shortAddress('0x1234…abcd')).toBe('0x1234…abcd')
    })

    it('counts down', () => {
        expect(formatCountdown(0)).toBe('00:00')
        expect(formatCountdown(-5)).toBe('00:00')
        expect(formatCountdown(59_999)).toBe('00:59')
        expect(formatCountdown(3_600_000)).toBe('01:00:00')
        expect(formatCountdown(86_399_000)).toBe('23:59:59')
    })

    it('formats amounts', () => {
        expect(compactNumber(1234)).toBe('1.2K')
        expect(compactNumber(3_400_000)).toBe('3.4M')
        expect(formatEth(0)).toBe('0')
        expect(formatEth(1.23456)).toBe('1.235')
        expect(formatEth(0.012345)).toBe('0.0123')
        expect(formatUsd(1234.5)).toBe('$1,235')
    })
})
