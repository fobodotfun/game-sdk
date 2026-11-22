// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { browserStore, memoryStore } from '../src/storage.js'

afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
})

describe('stores', () => {
    it('keeps a value in memory', () => {
        const store = memoryStore<{ a: number }>()
        expect(store.get()).toBeNull()
        store.set({ a: 1 })
        expect(store.get()).toEqual({ a: 1 })
        store.set(null)
        expect(store.get()).toBeNull()
    })

    it('keeps a value in localStorage under its key', () => {
        const store = browserStore<{ a: number }>('k')
        store.set({ a: 1 })
        expect(localStorage.getItem('k')).toBe('{"a":1}')
        expect(browserStore('k').get()).toEqual({ a: 1 })
        store.set(null)
        expect(localStorage.getItem('k')).toBeNull()
    })

    it('falls back to memory when storage is blocked', () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const blocked = () => {
            throw new DOMException('denied', 'SecurityError')
        }
        vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
        const store = browserStore<{ a: number }>('k')
        store.set({ a: 2 })
        expect(store.get()).toEqual({ a: 2 })
        expect(logged).toHaveBeenCalledTimes(1)
    })

    it('treats a corrupt saved value as blocked, not as a crash', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        localStorage.setItem('k', '{not json')
        expect(browserStore('k').get()).toBeNull()
    })
})
