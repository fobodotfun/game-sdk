import { describe, expect, it } from 'vitest'
import { secureOrigins, secureUrl } from '../src/urls.js'

describe('secureUrl', () => {
    it('takes https, and http only on this machine', () => {
        expect(secureUrl('https://fobo.fun/x', 'apiUrl').origin).toBe('https://fobo.fun')
        for (const local of ['http://localhost:3000', 'http://127.0.0.1:8787', 'http://[::1]:3000']) {
            expect(secureUrl(local, 'apiUrl').protocol).toBe('http:')
        }
    })

    it('refuses everything else', () => {
        const bad = [
            'http://fobo.fun',
            'http://localhost.evil.test',
            'javascript:alert(1)',
            'ftp://fobo.fun',
            'nope',
            '',
            5,
        ]
        for (const value of bad) expect(() => secureUrl(value, 'apiUrl')).toThrow(/apiUrl/)
        expect(() => secureUrl('https://user:pw@fobo.fun', 'apiUrl')).toThrow(/credentials/)
    })
})

describe('secureOrigins', () => {
    it('takes exact origins', () => {
        expect([...secureOrigins(['https://fobo.fun', 'http://localhost:3006'], 'frameOrigins')]).toEqual([
            'https://fobo.fun',
            'http://localhost:3006',
        ])
    })

    it('refuses paths, wildcards, plain http and empty lists', () => {
        const bad = [
            ['https://fobo.fun/'],
            ['https://fobo.fun/games'],
            ['*'],
            ['https://*.fobo.fun'],
            ['http://fobo.fun'],
            [],
            'x',
        ]
        for (const value of bad) expect(() => secureOrigins(value, 'frameOrigins')).toThrow(/frameOrigins/)
    })
})
