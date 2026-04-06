import { createRoot } from 'react-dom/client'
import App from './App.jsx'

// No StrictMode to prevent double-mount issues with Phaser game engine
createRoot(document.getElementById('root')).render(<App />)
