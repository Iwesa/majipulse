import { Route, Routes } from 'react-router-dom'
import { NAV_ITEMS } from '../components/layout/navigation'
import { HomePage } from '../pages/HomePage'
import { IncidentDetailPage } from '../pages/incidents/IncidentDetailPage'
import { IncidentQueuePage } from '../pages/incidents/IncidentQueuePage'
import { MaintenanceListPage, MaintenanceTaskPage, NewMaintenanceTaskPage } from '../pages/maintenance/MaintenancePages'
import { EditReportPage, NewReportPage } from '../pages/reports/ReportFormPages'
import { MyReportsPage, ReportDetailPage } from '../pages/reports/ReportListPages'
import { NotFoundPage, PlaceholderPage } from '../pages/StatusPages'
import { SignInPage } from '../pages/SignInPage'
import { SyncStatusPage } from '../pages/SyncStatusPage'
import { UsersPage } from '../pages/UsersPage'
import { WaterPointDetailPage } from '../pages/waterPoints/WaterPointDetailPage'
import { WaterPointFormPage } from '../pages/waterPoints/WaterPointFormPage'
import { WaterPointsPage } from '../pages/waterPoints/WaterPointsPage'
import { STAFF_ROLES } from '../schemas/roles'
import { RequireRole, RequireSession } from './guards'

/** Screens that exist so far. Every other nav item gets a placeholder. */
const PAGES = {
  home: HomePage,
  users: UsersPage,
  waterPoints: WaterPointsPage,
  newReport: NewReportPage,
  myReports: MyReportsPage,
  syncStatus: SyncStatusPage,
  incidents: IncidentQueuePage,
  maintenance: MaintenanceListPage,
} as const

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
        <Route element={<RequireRole roles={STAFF_ROLES} />}>
          <Route path="/water-points/new" element={<WaterPointFormPage mode="create" />} />
          <Route path="/water-points/:waterPointId/edit" element={<WaterPointFormPage mode="edit" />} />
          <Route path="/incidents/:incidentId" element={<IncidentDetailPage />} />
          <Route path="/maintenance/new" element={<NewMaintenanceTaskPage />} />
          <Route path="/maintenance/:taskId" element={<MaintenanceTaskPage />} />
        </Route>
        <Route path="/water-points/:waterPointId" element={<WaterPointDetailPage />} />
        {/* A user's own local reports: every role. */}
        <Route path="/reports/:incidentId" element={<ReportDetailPage />} />
        <Route path="/reports/:incidentId/edit" element={<EditReportPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
