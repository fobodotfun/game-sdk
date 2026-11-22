import { GameError } from './errors.js'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Parses a URL the SDK will talk to: https only, except plain http on this machine (local development).
 * @param label the option's name, for the error
 * @throws GameError ('config') otherwise
 */
export function secureUrl(value: unknown, label: string): URL {
    if (typeof value !== 'string' || value === '') throw new GameError('config', `${label} must be a URL`)
    let url: URL
    try {
        url = new URL(value)
    } catch (err) {
        throw new GameError('config', `${label} is not a valid URL: ${value}`, 0, { cause: err })
    }
    const isLocal = url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)
    if (url.protocol !== 'https:' && !isLocal) throw new GameError('config', `${label} must be https: ${value}`)
    if (url.username || url.password) throw new GameError('config', `${label} must not carry credentials`)
    return url
}

/**
 * Checks a list of origins (scheme + host + port, nothing else).
 * @throws GameError ('config') for anything that is not exactly an origin
 */
export function secureOrigins(values: unknown, label: string): Set<string> {
    if (!Array.isArray(values) || values.length === 0)
        throw new GameError('config', `${label} must be a list of origins`)
    const origins = new Set<string>()
    for (const value of values) {
        const url = secureUrl(value, label)
        // the URL parser takes * as a host name; no page's origin ever has one
        if (url.origin !== value || url.hostname.includes('*'))
            throw new GameError('config', `${label} takes origins like ${url.origin}, not ${value}`)
        origins.add(url.origin)
    }
    return origins
}
