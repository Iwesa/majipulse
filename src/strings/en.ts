/**
 * All user-facing English text. Components must import text from here, never
 * hardcode it, so the app can be localized later (R12.1).
 *
 * Add keys as features need them. Values must be non-empty strings.
 */

/** A nested object whose leaves are strings. */
export type StringTree = { readonly [key: string]: string | StringTree }

export const en = {
  app: {
    name: 'MajiPulse',
    tagline: 'Water infrastructure monitoring',
    setupNotice: 'MajiPulse is being set up. Features will appear here soon.',
  },
  common: {
    loading: 'Loading…',
    retry: 'Try again',
    required: '(required)',
    selectPlaceholder: 'Select an option',
    errorPrefix: 'Error:',
  },
  states: {
    emptyTitle: 'Nothing here yet',
    errorTitle: 'Something went wrong',
    errorDescription: 'We could not load this information.',
    offlineTitle: 'You are offline',
    offlineDescription: 'This information needs a connection. It will load when you are back online.',
  },
  layout: {
    skipToContent: 'Skip to main content',
    primaryNavigation: 'Main navigation',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    organization: 'Organization',
    signedInAs: 'Signed in as',
    demoBanner: 'Demo data (fictional). These records do not describe real people, places, or water points.',
    offlineHelp:
      'Offline reporting works after MajiPulse has loaded. Open the app while you are online before going to places without a connection.',
  },
  connectivity: {
    online: 'Online',
    offline: 'Offline: new reports are saved on this device',
  },
  nav: {
    home: 'Home',
    waterPoints: 'Water points',
    newReport: 'New report',
    myReports: 'My reports',
    incidents: 'Incidents',
    maintenance: 'Maintenance',
    patterns: 'Pattern analysis',
    users: 'Users',
    syncStatus: 'Sync status',
  },
  roles: {
    administrator: 'Administrator',
    technician: 'Technician',
    reporter: 'Reporter',
  },
} as const satisfies StringTree

export type Strings = typeof en
