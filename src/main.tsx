import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from './ThemeContext'
import { WeddingDataProvider } from './WeddingDataContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <WeddingDataProvider>
        <App />
      </WeddingDataProvider>
    </ThemeProvider>
  </StrictMode>,
)
