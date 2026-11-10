import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { checkEnvironment, env } from './config/env'
import './styles/global.css'

async function start() {
  checkEnvironment()
  if (import.meta.env.DEV && env.mocks) {
    const { network } = await import('virtual:msw')
    const { handlers } = await import('./mocks/handlers')
    network.configure({ handlers, onUnhandledFrame: 'bypass' })
    await network.enable()
  }
  const { App } = await import('./app/App')
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
}
start().catch(() => {
  const root = document.getElementById('root')!
  root.setAttribute('role', 'alert')
  root.textContent = '起動できません。環境設定を確認してください。 / Unable to start. Check your environment configuration.'
})
