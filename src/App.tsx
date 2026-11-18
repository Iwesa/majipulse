import { ServicesProvider } from './app/ServicesProvider'
import type { AppServices } from './app/servicesContext'
import { AppRoutes } from './routes/AppRoutes'

/** Router is supplied by the caller (BrowserRouter in main.tsx, MemoryRouter in tests). */
function App({ services }: { services: AppServices }) {
  return (
    <ServicesProvider services={services}>
      <AppRoutes />
    </ServicesProvider>
  )
}

export default App
