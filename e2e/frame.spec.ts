import { expect, test, type Frame, type Page } from '@playwright/test'
import { privateKeyToAccount } from 'viem/accounts'
import type { Game } from '@fobo/game-sdk'
import { FOBO_ORIGIN, GAME_ORIGIN, STRANGER_ORIGIN, WALLET_KEY } from './ports.ts'

declare global {
    interface Window {
        game: Game
        signAsWallet(hex: string): Promise<string>
    }
}

const wallet = privateKeyToAccount(WALLET_KEY)
/** The API answers the linked wallet as the full address in lower case. */
const LINKED_ADDRESS = wallet.address.toLowerCase()
/** Longer than the game keeps saying hello (5 s): after this, nobody answered. */
const HELLO_OVER_MS = 6000

/** The game's frame inside a framing page, once its SDK is up. */
async function gameFrame(page: Page, url: string): Promise<Frame> {
    await page.goto(url)
    const frame = page.frame({ url: `${GAME_ORIGIN}/` })
    if (!frame) throw new Error('The game frame did not load')
    await frame.waitForFunction(() => Boolean(window.game))
    return frame
}

test.describe('framed by fobo.fun', () => {
    test('links through the framing page, then plays under the wallet', async ({ page }) => {
        const game = await gameFrame(page, FOBO_ORIGIN)
        await game.waitForFunction(() => window.game.wallet.isAvailable)
        expect(await game.evaluate(() => window.game.wallet.isFramed)).toBe(true)

        // the API checks the real signature over the text fobo.fun built for the game's own host
        expect(await game.evaluate(() => window.game.link())).toBe(LINKED_ADDRESS)
        expect(await game.evaluate(() => window.game.wallet.address)).toBe(LINKED_ADDRESS)

        const board = await game.evaluate(() => window.game.submitScore({ name: 'ACE', score: 1200 }))
        expect(board.you).toMatchObject({ rank: 1, name: 'ACE', score: 1200, linked: true })
        expect(await game.evaluate(() => window.game.wallet.name)).toBe('ACE')
    })

    test('keeps the link across a reload', async ({ page }) => {
        const first = await gameFrame(page, FOBO_ORIGIN)
        await first.waitForFunction(() => window.game.wallet.isAvailable)
        await first.evaluate(() => window.game.link())

        const again = await gameFrame(page, FOBO_ORIGIN)
        expect(await again.evaluate(() => window.game.wallet.address)).toBe(LINKED_ADDRESS)
    })

    test('a player who says no leaves the game unlinked', async ({ page }) => {
        const game = await gameFrame(page, `${FOBO_ORIGIN}/?wallet=no`)
        await game.waitForFunction(() => window.game.wallet.isAvailable)

        const failure = await game.evaluate(async () => {
            try {
                await window.game.link()
                return null
            } catch (err) {
                const { code, message } = err as { code: string; message: string }
                return { code, message }
            }
        })
        expect(failure).toEqual({ code: 'wallet', message: 'The wallet request was cancelled' })
        expect(await game.evaluate(() => window.game.wallet.address)).toBeNull()
    })
})

test('a site that is not allowed to frame the game gets no wallet requests', async ({ page }) => {
    const asked: string[] = []
    page.on('request', (request) => {
        if (request.url().includes('/wallet/sign') || request.url().includes('/link')) asked.push(request.url())
    })
    // the stranger answers the hello exactly as fobo.fun does: the game must not believe it
    const game = await gameFrame(page, STRANGER_ORIGIN)
    await page.waitForTimeout(HELLO_OVER_MS)

    expect(await game.evaluate(() => window.game.wallet.isFramed)).toBe(true)
    expect(await game.evaluate(() => window.game.wallet.isAvailable)).toBe(false)
    const message = await game.evaluate(async () => {
        try {
            await window.game.link()
            return null
        } catch (err) {
            return (err as Error).message
        }
    })
    expect(message).toBe('This page offers no wallet')
    expect(asked).toEqual([])
})

test('on its own page, links with the browser wallet', async ({ page }) => {
    const methods: string[] = []
    await page.exposeFunction('signAsWallet', (hex: string) =>
        wallet.signMessage({ message: { raw: hex as `0x${string}` } })
    )
    await page.exposeFunction('walletCalled', (method: string) => methods.push(method))
    await page.addInitScript((address) => {
        // an installed wallet, as an extension injects it
        Object.assign(window, {
            ethereum: {
                async request({ method, params = [] }: { method: string; params?: unknown[] }) {
                    await (window as unknown as { walletCalled(method: string): Promise<void> }).walletCalled(method)
                    if (method === 'eth_requestAccounts') return [address]
                    if (method === 'personal_sign') return window.signAsWallet(params[0] as string)
                    throw new Error(`unexpected ${method}`)
                },
            },
        })
    }, wallet.address)

    await page.goto(GAME_ORIGIN)
    await page.waitForFunction(() => Boolean(window.game))
    expect(await page.evaluate(() => window.game.wallet.isFramed)).toBe(false)
    expect(await page.evaluate(() => window.game.link())).toBe(LINKED_ADDRESS)

    // a signature and nothing else: no transaction, no chain switch
    expect(methods).toEqual(['eth_requestAccounts', 'personal_sign'])
    expect(await page.evaluate(() => window.game.wallet.setName('SOLO'))).toBe('SOLO')
})

test.describe('the game on its own site', () => {
    test('reaches every kind of route from another origin', async ({ page }) => {
        const game = await gameFrame(page, FOBO_ORIGIN)
        await game.waitForFunction(() => window.game.wallet.isAvailable)
        await game.evaluate(() => window.game.link())

        // GET, PUT, POST with bytes and DELETE, each with the session header: all must pass the browser's CORS check
        const result = await game.evaluate(async () => {
            const boards = await window.game.boards()
            const saved = await window.game.save.set({ progress: { level: 3 } })
            const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })
            const withPicture = await window.game.player.setAvatar(png)
            const without = await window.game.player.removeAvatar()
            return { boards, saved, withPicture: withPicture.avatarSource, without: without.avatarSource }
        })
        expect(result.boards.map((board) => board.key)).toEqual(['main'])
        expect(result.saved).toEqual({ progress: { level: 3 } })
        expect(result.withPicture).toBe('game')
        expect(result.without).toBe('generated')
    })
})
