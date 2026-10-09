// TEMPORARY layout-inspection harness (not part of the app build).
// Renders the real AppLayout shell around the real LibraryPage so scroll
// containment can be verified in a plain browser without Tauri or webviews.
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AppLayout } from './layouts/AppLayout'
import { LibraryPage } from './pages/library/LibraryPage'
import type { View } from './types'
import './styles/main.scss'
import './styles/ui.scss'
import './styles/compact.scss'

function Preview() {
  const [view, setView] = useState<View>('library')
  return <AppLayout view={view} onViewChange={setView}><LibraryPage /></AppLayout>
}

createRoot(document.getElementById('root')!).render(<StrictMode><Preview /></StrictMode>)