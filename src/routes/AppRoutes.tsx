import { Route, Routes } from 'react-router-dom'
import { NAV_ITEMS } from '../components/layout/navigation'
import { HomePage } from '../pages/HomePage'
import { NotFoundPage, PlaceholderPage } from '../pages/StatusPages'
import { SignInPage } from '../pages/SignInPage'
import { UsersPage } from '../pages/UsersPage'
import { RequireRole, RequireSession } from './guards'

/** Screens that exist in this phase. Every other nav item gets a placeholder. */
const PAGES = { home: HomePage, users: UsersPage } as const

/** There is deliberately no sign-up route (R1.4). */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route element={<RequireSession />}>
        {NAV_ITEMS.map((item) => {
          const Page = item.key in PAGES ? PAGES[item.key as keyof typeof PAGES] : null
          return (
            <Route key={item.key} element={<RequireRole roles={item.roles} />}>
              <Route path={item.href} element={Page ? <Page /> : <PlaceholderPage navKey={item.key} />} />
            </Route>
          )
        })}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
