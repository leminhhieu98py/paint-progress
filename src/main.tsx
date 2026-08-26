import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installDevConsole } from './devConsole'

// Dev builds only, and it says so itself: a console handle for asking what the
// report would say under a given amount of paint, without painting anything.
installDevConsole()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
