/**
 * Every Zustand store that holds user or organization data registers a reset
 * function here. The session store calls resetAllStores() on sign-out or when
 * a different user signs in, so no data leaks between accounts (R3.6).
 */
const resets = new Set<() => void>()

export function registerStoreReset(reset: () => void): () => void {
  resets.add(reset)
  return () => resets.delete(reset)
}

export function resetAllStores(): void {
  for (const reset of resets) reset()
}
