import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ConfigErrorPage } from './pages/ConfigErrorPage'
import { createFirebaseIncidentExtractor } from './services/ai/firebaseExtractor'
import { initFirebase } from './services/firebase/app'
import { createFirebaseAuthService } from './services/firebase/authService'
import { createFirestoreIncidentSyncAdapter } from './services/firebase/incidentSyncAdapter'
import { ConfigError, loadAppConfig } from './services/firebase/config'
import { createFirebaseDashboardService, createFirebaseMaintenanceService, createFirebaseStaffIncidentService } from './services/firebase/staffServices'
import { createFirebaseUserAdminService } from './services/firebase/userAdminService'
import { createFirebaseWaterPointService } from './services/firebase/waterPointService'
import { openMajiPulseDb } from './services/offline/db'
import { createIdbIncidentOutbox } from './services/offline/incidentOutbox'
import { createIdbWaterPointCache } from './services/offline/waterPointCache'
import './index.css'

const root = createRoot(document.getElementById('root')!)

try {
  const config = loadAppConfig()
  // The debug token is read only in development builds.
  const firebase = initFirebase(config, import.meta.env.DEV ? import.meta.env.VITE_APPCHECK_DEBUG_TOKEN : undefined)
  // If IndexedDB is unavailable (for example some private windows), cache
  // calls fail and the app works online only.
  const database = openMajiPulseDb()
  database.catch(() => undefined)
  const services = {
    auth: createFirebaseAuthService(firebase.auth, firebase.db),
    userAdmin: createFirebaseUserAdminService(firebase.db, firebase.functions),
    waterPoints: createFirebaseWaterPointService(firebase.db),
    waterPointCache: createIdbWaterPointCache(database),
    incidentOutbox: createIdbIncidentOutbox(database),
    staffIncidents: createFirebaseStaffIncidentService(firebase.db),
    maintenance: createFirebaseMaintenanceService(firebase.db),
    dashboard: createFirebaseDashboardService(firebase.db),
    incidentSync: createFirestoreIncidentSyncAdapter(firebase.db),
    incidentExtractor: createFirebaseIncidentExtractor(firebase.app),
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
