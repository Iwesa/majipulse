import type { Role } from '../../schemas/roles'
import type { en } from '../../strings/en'

export type NavKey = keyof typeof en.nav

export interface NavItem {
  key: NavKey
  href: string
  /** Match the path exactly (so "/reports" is not active on "/reports/new"). */
  end?: boolean
  roles: readonly Role[]
}

const ALL: readonly Role[] = ['administrator', 'technician', 'reporter']
const STAFF: readonly Role[] = ['administrator', 'technician']
const ADMIN: readonly Role[] = ['administrator']

/**
 * Navigation and route access follow the role table in requirements section 2.
 * This only controls what is shown; security rules and functions enforce access.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'home', href: '/', end: true, roles: ALL },
  { key: 'newReport', href: '/reports/new', roles: ALL },
  { key: 'myReports', href: '/reports', end: true, roles: ALL },
  { key: 'waterPoints', href: '/water-points', roles: ALL },
  { key: 'incidents', href: '/incidents', roles: STAFF },
  { key: 'maintenance', href: '/maintenance', roles: STAFF },
  { key: 'patterns', href: '/patterns', roles: STAFF },
  { key: 'users', href: '/users', roles: ADMIN },
  { key: 'syncStatus', href: '/sync', roles: ALL },
]

export function navItemsForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role))
}
