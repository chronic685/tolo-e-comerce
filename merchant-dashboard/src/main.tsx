import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import { Toaster } from '@tolo/ui'
import App from './App.tsx'
import { AuthProvider } from './lib/AuthContext'
import { MerchantProvider } from './lib/MerchantContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <MerchantProvider>
          <Toaster />
          <App />
        </MerchantProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
