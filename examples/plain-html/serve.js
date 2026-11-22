// A static server for this folder. `/sdk.js` is the SDK's one-file build (on your own site: copy that file next
// to index.html, or import it from unpkg).
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

const PORT = 5180
const FILES = {
    '/': [new URL('./index.html', import.meta.url), 'text/html; charset=utf-8'],
    '/sdk.js': [import.meta.resolve('@fobo/game-sdk/browser'), 'text/javascript; charset=utf-8'],
}

createServer(async (req, res) => {
    const [file, type] = FILES[new URL(req.url, 'http://localhost').pathname] ?? []
    if (!file) {
        res.writeHead(404).end('Not found')
        return
    }
    try {
        res.writeHead(200, { 'Content-Type': type }).end(await readFile(fileURLToPath(file)))
    } catch (err) {
        console.error('[example]', err.message)
        res.writeHead(500).end('Run `pnpm build` in the repo root first')
    }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`))
