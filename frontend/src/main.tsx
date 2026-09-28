import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import { Toaster } from '@tolo/ui'
import App from './App.tsx'
import { AuthProvider } from './lib/AuthContext'
import { CartProvider } from './lib/CartContext'
import { FavoritesProvider } from './lib/FavoritesContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
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
  </StrictMode>,
)
