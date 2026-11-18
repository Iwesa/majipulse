import { describe, expect, it } from 'vitest'

describe('test tooling', () => {
  it('provides an in-memory IndexedDB', async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('tooling-check', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('items')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    expect(db.objectStoreNames.contains('items')).toBe(true)
    db.close()
  })

  it('provides DOM matchers in jsdom', () => {
    const el = document.createElement('p')
    el.textContent = 'hello'
    document.body.append(el)
    expect(el).toBeInTheDocument()
    expect(el).toHaveTextContent('hello')
  })
})
