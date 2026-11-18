import { Timestamp } from 'firebase/firestore'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WaterPointServiceError } from '../waterPoints'

// Mocked Firestore SDK: records calls so tests can check scoping and writes.
const calls = vi.hoisted(() => ({
  where: vi.fn((...args: unknown[]) => ({ where: args })),
  getDocsFromServer: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
  txGet: vi.fn(),
}))

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>()
  return {
    Timestamp: actual.Timestamp,
    collection: (_db: unknown, path: string) => ({ path }),
    doc: (parent: { path?: string }, ...segments: string[]) =>
      segments.length ? { id: segments.at(-1) } : { id: 'generated-id', parent },
    query: (...args: unknown[]) => ({ query: args }),
    where: calls.where,
    getDocsFromServer: calls.getDocsFromServer,
    runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<void>) =>
      fn({ set: calls.set, update: calls.update, get: calls.txGet }),
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    deleteField: () => 'DELETE_FIELD',
  }
})

const { createFirebaseWaterPointService, firestoreErrorKind } = await import('./waterPointService')

const scope = { organizationId: 'kwale-demo', ownerUid: 'uid-admin' }
const T = Timestamp.fromDate(new Date('2026-03-01T08:00:00Z'))
const stored = (overrides: Record<string, unknown> = {}) => ({
  organizationId: 'kwale-demo',
  name: 'Mwamanga Borehole (fictional)',
  type: 'borehole',
  locationDescription: 'Fictional place',
  status: 'working',
  demo: true,
  createdBy: 'uid-admin',
  createdAt: T,
  updatedAt: T,
  ...overrides,
})
const docSnap = (id: string, data: Record<string, unknown>) => ({ id, data: () => data })
const input = { name: '  New Tap (fictional) ', type: 'tap' as const, locationDescription: 'Market', status: 'working' as const }

const service = createFirebaseWaterPointService({} as never)

beforeEach(() => {
  Object.values(calls).forEach((fn) => fn.mockReset())
  calls.where.mockImplementation((...args: unknown[]) => ({ where: args }))
})
afterEach(() => vi.clearAllMocks())

describe('list', () => {
  it('queries the server with the organization filter', async () => {
    calls.getDocsFromServer.mockResolvedValue({ docs: [] })
    await service.list(scope)
    expect(calls.where).toHaveBeenCalledWith('organizationId', '==', 'kwale-demo')
    expect(calls.getDocsFromServer).toHaveBeenCalledOnce()
  })

  it('converts Timestamps to ISO strings, validates, and sorts by name', async () => {
    calls.getDocsFromServer.mockResolvedValue({
      docs: [docSnap('wp-b', stored({ name: 'B point' })), docSnap('wp-a', stored({ name: 'A point' }))],
    })
    const points = await service.list(scope)
    expect(points.map((p) => p.id)).toEqual(['wp-a', 'wp-b'])
    expect(points[0].createdAt).toBe('2026-03-01T08:00:00.000Z')
  })

  it('skips invalid and foreign records', async () => {
    calls.getDocsFromServer.mockResolvedValue({
      docs: [docSnap('ok', stored()), docSnap('bad', stored({ status: 'broken' })), docSnap('foreign', stored({ organizationId: 'pwani-demo' }))],
    })
    expect((await service.list(scope)).map((p) => p.id)).toEqual(['ok'])
  })

  it.each([
    ['unavailable', 'network'],
    ['permission-denied', 'permission'],
    ['internal', 'unknown'],
  ])('maps %s to %s', async (code, kind) => {
    calls.getDocsFromServer.mockRejectedValue({ code })
    await expect(service.list(scope)).rejects.toMatchObject({ kind })
  })

  it('rejects an invalid scope without querying', async () => {
    await expect(service.list({ organizationId: '', ownerUid: 'u' })).rejects.toMatchObject({ kind: 'invalid' })
    expect(calls.getDocsFromServer).not.toHaveBeenCalled()
  })
})

describe('create', () => {
  it('writes the organization, creator, demo flag, and server timestamps', async () => {
    const id = await service.create(scope, { ...input, ward: 'Demo Ward' })
    expect(id).toBe('generated-id')
    expect(calls.set).toHaveBeenCalledWith(expect.objectContaining({ id: 'generated-id' }), {
      organizationId: 'kwale-demo',
      name: 'New Tap (fictional)',
      type: 'tap',
      locationDescription: 'Market',
      status: 'working',
      ward: 'Demo Ward',
      demo: false,
      createdBy: 'uid-admin',
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
    })
  })

  it('omits an empty ward', async () => {
    await service.create(scope, input)
    expect(calls.set.mock.calls[0][1]).not.toHaveProperty('ward')
  })

  it.each([
    ['empty name', { ...input, name: ' ' }],
    ['unknown type', { ...input, type: 'dam' }],
    ['extra field', { ...input, organizationId: 'pwani-demo' }],
  ])('rejects %s before writing', async (_label, bad) => {
    await expect(service.create(scope, bad as never)).rejects.toBeInstanceOf(WaterPointServiceError)
    expect(calls.set).not.toHaveBeenCalled()
  })
})

describe('update', () => {
  it('updates only editable fields and removes a cleared ward', async () => {
    calls.txGet.mockResolvedValue({ exists: () => true, data: () => stored() })
    await service.update(scope, 'wp-1', { ...input, status: 'needs_repair' })
    expect(calls.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'wp-1' }), {
      name: 'New Tap (fictional)',
      type: 'tap',
      locationDescription: 'Market',
      status: 'needs_repair',
      ward: 'DELETE_FIELD',
      updatedAt: 'SERVER_TIMESTAMP',
    })
  })

  it('refuses a missing or foreign water point', async () => {
    calls.txGet.mockResolvedValue({ exists: () => false, data: () => ({}) })
    await expect(service.update(scope, 'wp-1', input)).rejects.toMatchObject({ kind: 'notFound' })
    calls.txGet.mockResolvedValue({ exists: () => true, data: () => stored({ organizationId: 'pwani-demo' }) })
    await expect(service.update(scope, 'wp-1', input)).rejects.toMatchObject({ kind: 'notFound' })
    expect(calls.update).not.toHaveBeenCalled()
  })
})

describe('firestoreErrorKind', () => {
  it.each([
    ['deadline-exceeded', 'network'],
    ['unauthenticated', 'permission'],
    ['not-found', 'notFound'],
    ['invalid-argument', 'invalid'],
  ])('%s -> %s', (code, kind) => {
    expect(firestoreErrorKind({ code })).toBe(kind)
  })
})
