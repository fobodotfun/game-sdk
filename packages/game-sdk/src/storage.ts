import { errorMessage } from './errors.js'
import { parseJson } from './json.js'

/** A place to keep one JSON value. */
export interface Store<T> {
    get(): T | null
    /** null removes it. */
    set(value: T | null): void
}

/** A store that lives only as long as the page. */
export function memoryStore<T>(): Store<T> {
    let current: T | null = null
    return {
        get: () => current,
        set: (value) => {
            current = value
        },
    }
}

/** Whether this place has a localStorage at all (a browser page: not Node, not a worker). */
export function hasBrowserStorage(): boolean {
    try {
        return typeof globalThis.localStorage?.getItem === 'function'
    } catch (err) {
        // a frame whose storage is blocked throws on the read itself: the same as having none
        console.error('[fobo-game] reading storage', errorMessage(err))
        return false
    }
}

/**
 * A store in the browser's localStorage. Storage can be missing or blocked (private windows, embedded frames):
 * then the value simply lasts for the page, and the player links again next visit.
 */
export function browserStore<T>(key: string): Store<T> {
    const memory = memoryStore<T>()
    let isBlocked = false
    return {
        get() {
            if (isBlocked) return memory.get()
            try {
                const raw = globalThis.localStorage.getItem(key)
                return raw === null ? null : (parseJson(raw) as T)
            } catch (err) {
                console.error('[fobo-game] reading storage', errorMessage(err))
                isBlocked = true
                return memory.get()
            }
        },
        set(value) {
            memory.set(value)
            if (isBlocked) return
            try {
                if (value === null) globalThis.localStorage.removeItem(key)
                else globalThis.localStorage.setItem(key, JSON.stringify(value))
            } catch (err) {
                console.error('[fobo-game] writing storage', errorMessage(err))
                isBlocked = true
            }
        },
    }
}
