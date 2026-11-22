import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

// the same two constants the build fills in (packages/game-sdk/tsup.config.ts), so tests see the real version
const pkg = JSON.parse(readFileSync(new URL('./packages/game-sdk/package.json', import.meta.url), 'utf8')) as {
    name: string
    version: string
}

export default defineConfig({
    define: { __SDK_NAME__: JSON.stringify(pkg.name), __SDK_VERSION__: JSON.stringify(pkg.version) },
    test: {
        include: ['packages/*/test/**/*.test.{ts,tsx}'],
        environment: 'node',
        restoreMocks: true,
        unstubGlobals: true,
    },
})
