import { describe, expect, it } from 'vitest'
import { en, type StringTree } from './en'

function emptyPaths(tree: StringTree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') return value.trim() === '' ? [path] : []
    return emptyPaths(value, path)
  })
}

describe('English strings module', () => {
  it('has no empty values', () => {
    expect(emptyPaths(en)).toEqual([])
  })

  it('detects empty values (guards the check itself)', () => {
    expect(emptyPaths({ a: '', b: { c: '  ', d: 'ok' } })).toEqual(['a', 'b.c'])
  })
})
