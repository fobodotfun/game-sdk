import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

// the version is written once, in package.json: the build puts it into the code (src/version.ts)
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    name: string
    version: string
}
const define = { __SDK_NAME__: JSON.stringify(pkg.name), __SDK_VERSION__: JSON.stringify(pkg.version) }

// dist is emptied by the build script, not here: the three builds run side by side and would wipe each other's files
export default defineConfig([
    {
        entry: [
            'src/index.ts',
            'src/protocol.ts',
            'src/server.ts',
            'src/testing.ts',
            'src/format.ts',
            // the wallet connectors: each one's library is an optional peer the game installs itself
            'src/reown.ts',
            'src/privy.ts',
            'src/wagmi.ts',
        ],
        format: 'esm',
        target: 'es2022',
        dts: true,
        define,
    },
    {
        // one minified file for <script type="module"> with no build step
        entry: { 'browser/game-sdk': 'src/browser.ts' },
        format: 'esm',
        target: 'es2022',
        platform: 'browser',
        splitting: false,
        minify: true,
        dts: true,
        define,
    },
    {
        // the Reown connector for <script type="module"> with no build step: AppKit and everything it needs is
        // inside, and its own lazy views load as chunks from the same folder
        entry: { reown: 'src/reown.ts' },
        outDir: 'dist/browser',
        format: 'esm',
        target: 'es2022',
        platform: 'browser',
        noExternal: [/.*/],
        splitting: true,
        minify: true,
        define: { ...define, 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
        esbuildOptions(options) {
            options.chunkNames = 'chunks/[name]-[hash]'
            options.legalComments = 'linked'
        },
    },
])
