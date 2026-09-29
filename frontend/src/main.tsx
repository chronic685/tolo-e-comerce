import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import { I18nProvider, Toaster } from '@tolo/ui'
import App from './App.tsx'
import { AuthProvider } from './lib/AuthContext'
import { CartProvider } from './lib/CartContext'
import { FavoritesProvider } from './lib/FavoritesContext'
import { initEmbedMode } from './lib/appBridge'

initEmbedMode()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <BrowserRouter>
        <AuthProvider>
          <CartProvider>
            <FavoritesProvider>
              <Toaster />
              <App />
            </FavoritesProvider>
          </CartProvider>
        </AuthProvider>
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>,
)
