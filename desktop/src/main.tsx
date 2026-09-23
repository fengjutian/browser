import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/main.scss'
import './styles/ui.scss'
import './styles/compact.scss'
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>)
