import { describe, expect, it } from 'vitest'
import { GameError } from '../src/errors.js'
import { parseJson, toJson } from '../src/json.js'
import {
    avatarProblem,
    boardsProblem,
    check,
    dataKeysProblem,
    dataTotalProblem,
    dataValuesProblem,
    dayProblem,
    holdMinProblem,
    itemMetaProblem,
    itemsProblem,
    limitProblem,
    LIMITS,
    metaProblem,
    namesProblem,
    qtyProblem,
    scoreProblem,
    settingsProblem,
    sharesProblem,
} from '../src/validate.js'
import { highScore } from '../src/boards.js'

describe('the shared checks', () => {
    it('hold scores to whole numbers the API can keep', () => {
        expect(scoreProblem(0)).toBeNull()
        expect(scoreProblem(Number.MAX_SAFE_INTEGER)).toBeNull()
        for (const score of [-1, 1.5, Number.NaN, Infinity, '5', null]) expect(scoreProblem(score)).not.toBeNull()
    })

    it('limit score meta to 512 bytes (a plain 400) and item meta to 2 KB (too_large)', () => {
        expect(metaProblem({ level: 3 })).toBeNull()
        expect(metaProblem([1])).not.toBeNull()
        expect(metaProblem({ note: 'x'.repeat(LIMITS.scoreMetaBytes) })).toEqual({ message: expect.any(String) })
        expect(itemMetaProblem({ note: 'x'.repeat(1000) })).toBeNull()
        expect(itemMetaProblem({ note: 'x'.repeat(LIMITS.itemMetaBytes) })?.code).toBe('too_large')
    })

    it('check boards: keys, fields, at most 100 with main, one prize board', () => {
        expect(boardsProblem([highScore('main'), highScore('round-1')])).toBeNull()
        expect(boardsProblem([highScore('Main')])).not.toBeNull()
        expect(boardsProblem([highScore('a'), highScore('a')])).not.toBeNull()
        expect(boardsProblem([{ ...highScore('a'), sort: 'up' }])).not.toBeNull()
        expect(boardsProblem([{ ...highScore('a'), periods: [] }])).not.toBeNull()
        expect(boardsProblem([highScore('a', { isPrize: true }), highScore('b', { isPrize: true })])).not.toBeNull()
        expect(boardsProblem(Array.from({ length: 99 }, (_, i) => highScore(`b-${i}`)))).toBeNull()
        expect(boardsProblem(Array.from({ length: 100 }, (_, i) => highScore(`b-${i}`)))).not.toBeNull()
        expect(
            boardsProblem([highScore('main'), ...Array.from({ length: 99 }, (_, i) => highScore(`b-${i}`))])
        ).toBeNull()
        expect(boardsProblem([])).toBeNull()
        expect(boardsProblem('main')).not.toBeNull()
    })

    it('check items', () => {
        expect(itemsProblem([{ key: 'gold-ship', name: 'Gold ship', kind: 'skin', slot: 'skin' }])).toBeNull()
        expect(
            itemsProblem([{ key: 'potion', name: 'Potion', kind: 'item', isStackable: true, maxQty: 99 }])
        ).toBeNull()
        expect(itemsProblem([{ key: 'Bad Key', name: 'x', kind: 'item' }])).not.toBeNull()
        expect(itemsProblem([{ key: 'a', name: '', kind: 'item' }])).not.toBeNull()
        expect(itemsProblem([{ key: 'a', name: 'A', kind: 'item', maxQty: 0, isStackable: true }])).not.toBeNull()
        expect(itemsProblem([{ key: 'a', name: 'A' }])).not.toBeNull()
        expect(qtyProblem(1)).toBeNull()
        for (const qty of [0, -1, 1.5, '1']) expect(qtyProblem(qty)).not.toBeNull()
    })

    it('check saved data: key shape, 16 KB a value, 64 keys and 64 KB in all', () => {
        expect(dataValuesProblem({ progress: { level: 3 } })).toBeNull()
        expect(dataKeysProblem(['a b'])).not.toBeNull()
        expect(dataKeysProblem(['__proto__'])).not.toBeNull()
        expect(dataValuesProblem({ big: 'x'.repeat(LIMITS.dataValueBytes) })?.code).toBe('too_large')
        const many = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${i}`, 1]))
        expect(dataTotalProblem(many)?.code).toBe('too_large')
        const heavy = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`k${i}`, 'x'.repeat(15_000)]))
        expect(dataValuesProblem(heavy)).toBeNull()
        expect(dataTotalProblem(heavy)?.code).toBe('too_large')
    })

    it('check days, limits, name lists and pictures', () => {
        expect(dayProblem('2026-01-31')).toBeNull()
        expect(dayProblem('2026-1-31')).not.toBeNull()
        expect(limitProblem(100)).toBeNull()
        expect(limitProblem(101)).not.toBeNull()
        expect(limitProblem(0)).not.toBeNull()
        expect(namesProblem(['ACE'])).toBeNull()
        expect(namesProblem(Array.from({ length: 51 }, (_, i) => `P${i}`))).not.toBeNull()
        expect(avatarProblem('image/png', 10)).toBeNull()
        expect(avatarProblem('image/svg+xml', 10)).not.toBeNull()
        expect(avatarProblem('image/png', LIMITS.avatarBytes + 1)?.code).toBe('too_large')
    })

    it('check game settings', () => {
        expect(settingsProblem({})).toBeNull()
        expect(settingsProblem({ title: 'Moon', holdMin: '100000', shares: [60, 25, 15], writes: 'server' })).toBeNull()
        expect(settingsProblem({ title: 'x'.repeat(41) })).not.toBeNull()
        expect(settingsProblem({ writes: 'page' })).not.toBeNull()
        expect(holdMinProblem(0)).toBeNull()
        for (const holdMin of [-1, 1.5, '1.5', '', 'abc']) expect(holdMinProblem(holdMin)).not.toBeNull()
        expect(sharesProblem([100])).toBeNull()
        expect(sharesProblem([60, 30])).not.toBeNull()
        expect(sharesProblem([])).not.toBeNull()
        expect(sharesProblem([50.5, 49.5])).not.toBeNull()
        expect(sharesProblem(Array.from({ length: 11 }, () => 10))).not.toBeNull()
    })

    it('throw a GameError that carries the API code for a size limit', () => {
        expect(() => check(null)).not.toThrow()
        let thrown: unknown
        try {
            check(avatarProblem('image/png', LIMITS.avatarBytes + 1))
        } catch (err) {
            thrown = err
        }
        expect(thrown).toBeInstanceOf(GameError)
        expect(thrown).toMatchObject({ code: 'input', status: 0, apiCode: 'too_large' })
    })
})

describe('JSON handling', () => {
    it('drops __proto__ keys at every depth', () => {
        const parsed = parseJson('{"a":{"__proto__":{"isAdmin":true},"b":1},"__proto__":{"isAdmin":true}}') as {
            a: Record<string, unknown>
        }
        expect(Object.keys(parsed)).toEqual(['a'])
        expect(Object.keys(parsed.a)).toEqual(['b'])
        expect(({} as { isAdmin?: boolean }).isAdmin).toBeUndefined()
        expect((Object.assign({}, parsed.a) as { isAdmin?: boolean }).isAdmin).toBeUndefined()
    })

    it('writes bigint values as strings', () => {
        expect(toJson({ amountWei: 10n ** 18n })).toBe('{"amountWei":"1000000000000000000"}')
    })
})
