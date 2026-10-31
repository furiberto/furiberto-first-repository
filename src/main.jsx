import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import SettingsApp from './SettingsApp.jsx'
import './styles.css'

const mode = new URLSearchParams(window.location.search).get('mode')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {mode === 'settings' ? <SettingsApp /> : <App />}
  </StrictMode>,
)
