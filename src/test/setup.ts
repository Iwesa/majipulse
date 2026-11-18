// Shared Vitest setup: DOM matchers, an in-memory IndexedDB, and DOM cleanup.
import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// IndexedDB-backed screens can take over the default 1s under full-suite load.
configure({ asyncUtilTimeout: 4000 })

afterEach(() => {
  cleanup()
})
