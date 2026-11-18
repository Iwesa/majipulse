import { NavLink } from 'react-router-dom'
import type { Role } from '../../schemas/roles'
import { cn } from '../../lib/cn'
import { en } from '../../strings/en'
import { navItemsForRole } from './navigation'

interface PrimaryNavProps {
  role: Role
  id?: string
  className?: string
  onNavigate?: () => void
}

export function PrimaryNav({ role, id, className, onNavigate }: PrimaryNavProps) {
  return (
    <nav id={id} aria-label={en.layout.primaryNavigation} className={className}>
      <ul className="flex flex-col gap-1">
        {navItemsForRole(role).map((item) => (
          <li key={item.key}>
            <NavLink
              to={item.href}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'block rounded-md px-3 py-2 font-medium',
                  'focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-sky-600',
                  isActive ? 'bg-sky-100 text-sky-950 underline underline-offset-4' : 'text-slate-800 hover:bg-slate-100',
                )
              }
            >
              {en.nav[item.key]}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
