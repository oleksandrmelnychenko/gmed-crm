import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initializeAuthStorage } from './lib/auth-storage.ts'
import { initializeNativeRuntime, isNativeRuntime } from './lib/mobile/runtime.ts'

async function bootstrap() {
  await initializeAuthStorage()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )

  await initializeNativeRuntime()

  if (!isNativeRuntime() && import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      void navigator.serviceWorker.register("/service-worker.js");
    });
  }
}

void bootstrap()
