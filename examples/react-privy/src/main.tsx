import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PrivyProvider } from '@privy-io/react-auth'
import { App } from './App'

const appId = import.meta.env.VITE_PRIVY_APP_ID as string | undefined
const root = document.getElementById('root')
if (!root) throw new Error('index.html has no #root')

createRoot(root).render(
    <StrictMode>
        {appId ? (
            <PrivyProvider appId={appId}>
                <App />
            </PrivyProvider>
        ) : (
            <p>Copy .env.example to .env and set VITE_PRIVY_APP_ID.</p>
        )}
    </StrictMode>
)
