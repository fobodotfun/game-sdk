// filled in from package.json when the package is built or tested (tsup and vitest `define`)
declare const __SDK_NAME__: string | undefined
declare const __SDK_VERSION__: string | undefined

/** The package's name, from its package.json. */
export const SDK_NAME: string = typeof __SDK_NAME__ === 'string' ? __SDK_NAME__ : '@fobo/game-sdk'

/** The package's version, from its package.json (the one place it is written). */
export const SDK_VERSION: string = typeof __SDK_VERSION__ === 'string' ? __SDK_VERSION__ : '0.0.0-dev'

/** What the SDK calls itself on every API request: `<package>/<version>`. */
export const SDK_AGENT = `${SDK_NAME}/${SDK_VERSION}`
