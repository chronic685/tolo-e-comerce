import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import { Toaster } from '@tolo/ui'
import App from './App.tsx'
import { AuthProvider } from './lib/AuthContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Toaster />
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
