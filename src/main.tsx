import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ConfigErrorPage } from './pages/ConfigErrorPage'
import { initFirebase } from './services/firebase/app'
import { createFirebaseAuthService } from './services/firebase/authService'
import { ConfigError, loadAppConfig } from './services/firebase/config'
import { createFirebaseUserAdminService } from './services/firebase/userAdminService'
import './index.css'

const root = createRoot(document.getElementById('root')!)

try {
  const config = loadAppConfig()
  // The debug token is read only in development builds.
  const firebase = initFirebase(config, import.meta.env.DEV ? import.meta.env.VITE_APPCHECK_DEBUG_TOKEN : undefined)
  const services = {
    auth: createFirebaseAuthService(firebase.auth, firebase.db),
    userAdmin: createFirebaseUserAdminService(firebase.db, firebase.functions),
  }
  root.render(
    <StrictMode>
      <BrowserRouter>
        <App services={services} />
      </BrowserRouter>
    </StrictMode>,
  )
} catch (error) {
  if (!(error instanceof ConfigError)) throw error
  // Lists which variables are wrong, never their values.
  console.error(error.message)
  root.render(
    <StrictMode>
      <ConfigErrorPage />
    </StrictMode>,
  )
}
