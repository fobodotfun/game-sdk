import { defineConfig, devices } from '@playwright/test'
import { FOBO_PORT } from './ports.ts'

export default defineConfig({
    testDir: '.',
    testMatch: '*.spec.ts',
    fullyParallel: false,
    workers: 1,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? 'github' : 'list',
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: 'node e2e/server.ts',
        cwd: '..',
        port: FOBO_PORT,
        reuseExistingServer: false,
    },
})
