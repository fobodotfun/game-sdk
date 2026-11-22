/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { verifyMessage } from 'viem'
import { describe, expect, it } from 'vitest'
import { FEATURE_LINK, LINK_ERRORS, LINK_NONCE_PATTERN, linkMessage, MSG } from '../src/protocol.js'
import { ACCOUNT } from './helpers.js'

describe('protocol', () => {
    it('keeps the signed link text byte for byte', () => {
        // fobo.fun's API rebuilds this exact text to check the signature: changing it breaks every game
        expect(linkMessage('wantedhood.xyz', 'abcdefghijklmnop')).toBe(
            'Link this wallet to my game scores.\nSite: wantedhood.xyz\nNonce: abcdefghijklmnop'
        )
    })

    it('signs to a signature the address verifies', async () => {
        const message = linkMessage('game.example', 'n0nce_n0nce_n0nce-1')
        const signature = await ACCOUNT.signMessage({ message })
        expect(await verifyMessage({ address: ACCOUNT.address, message, signature })).toBe(true)
        const other = linkMessage('evil.example', 'n0nce_n0nce_n0nce-1')
        expect(await verifyMessage({ address: ACCOUNT.address, message: other, signature })).toBe(false)
    })

    it('takes only url-safe nonces of 16 to 64 characters', () => {
        expect(LINK_NONCE_PATTERN.test('a'.repeat(16))).toBe(true)
        expect(LINK_NONCE_PATTERN.test('A1_-'.repeat(16))).toBe(true)
        for (const bad of ['a'.repeat(15), 'a'.repeat(65), 'a'.repeat(15) + '\n', 'aaaa aaaa aaaa aaaa']) {
            expect(LINK_NONCE_PATTERN.test(bad)).toBe(false)
        }
    })
})

// fobo.fun's side of the frame protocol, when its repo is checked out next to this one (it is not in CI)
const SITE_SOURCE = fileURLToPath(
    new URL('../../../../fobofun-restyle/apps/web/src/lib/gameWalletLink.ts', import.meta.url)
)

describe.skipIf(!existsSync(SITE_SOURCE))('agreement with fobo.fun', () => {
    const site = existsSync(SITE_SOURCE) ? readFileSync(SITE_SOURCE, 'utf8') : ''

    it('uses the same message types and feature name', () => {
        for (const type of Object.values(MSG)) expect(site).toContain(`'${type}'`)
        expect(site).toContain(`['${FEATURE_LINK}']`)
    })

    it('uses the same nonce pattern, errors and link text', () => {
        expect(site).toContain(LINK_NONCE_PATTERN.toString())
        for (const error of LINK_ERRORS) expect(site).toContain(`'${error}'`)
        expect(site).toContain('`Link this wallet to my game scores.\\nSite: ${host}\\nNonce: ${nonce}`')
    })
})
