import type { Role } from '../../schemas/roles'
import { cn } from '../../lib/cn'
import { en } from '../../strings/en'
import { navItemsForRole } from './navigation'

interface PrimaryNavProps {
  role: Role
  currentPath?: string
  id?: string
  className?: string
}

export function PrimaryNav({ role, currentPath, id, className }: PrimaryNavProps) {
  return (
    <nav id={id} aria-label={en.layout.primaryNavigation} className={className}>
      <ul className="flex flex-col gap-1">
        {navItemsForRole(role).map((item) => {
          const current = item.href === currentPath
          return (
            <li key={item.key}>
              <a
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'block rounded-md px-3 py-2 font-medium',
                  'focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-sky-600',
                  current ? 'bg-sky-100 text-sky-950 underline underline-offset-4' : 'text-slate-800 hover:bg-slate-100',
                )}
              >
                {en.nav[item.key]}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
