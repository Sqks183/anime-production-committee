import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/index.css'

const usePrototype = new URLSearchParams(window.location.search).get('view') === 'prototype'
const PrototypeApp = lazy(() => import('./prototype/PrototypeApp'))

createRoot(document.getElementById('root')!).render(<StrictMode>{usePrototype ? <Suspense fallback={null}><PrototypeApp /></Suspense> : <App />}</StrictMode>)
