/** Whether a value is a plain JSON object (not null, not an array). */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * JSON.parse for text the SDK did not write (API answers, localStorage, a verifier's request body). A `__proto__`
 * key is dropped at every depth, so nothing parsed here can change an object's prototype when it is later copied
 * or merged.
 * @throws SyntaxError when the text is not JSON
 */
export function parseJson(text: string): unknown {
    return JSON.parse(text, (key, value: unknown) => (key === '__proto__' ? undefined : value)) as unknown
}

/** JSON.stringify with bigint values as decimal strings. */
export function toJson(body: unknown): string {
    return JSON.stringify(body, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value))
}

const encoder = new TextEncoder()

/** A string's size in bytes as UTF-8 (what the API's size limits count). */
export const byteLength = (text: string): number => encoder.encode(text).length

/** A value's size in bytes as JSON. */
export const jsonBytes = (value: unknown): number => byteLength(JSON.stringify(value) ?? '')
