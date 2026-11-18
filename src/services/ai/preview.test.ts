// Privacy preview model (T6.4b, R4.9). Fictional text.
import { describe, expect, it } from 'vitest'
import { buildRedactionPreview } from './preview'

describe('buildRedactionPreview', () => {
  it('marks removed parts and never contains the original values', () => {
    const preview = buildRedactionPreview('My name is Amina, call 0712345678. Tap dry.', 'Kiosk of Mama Rehema (fictional)')
    expect(preview.description).toEqual([
      { kind: 'text', text: 'My name is ' },
      { kind: 'removed', placeholder: 'NAME' },
      { kind: 'text', text: ', call ' },
      { kind: 'removed', placeholder: 'PHONE' },
      { kind: 'text', text: '. Tap dry.' },
    ])
    expect(preview.waterPointName).toEqual([
      { kind: 'text', text: 'Kiosk of Mama ' },
      { kind: 'removed', placeholder: 'NAME' },
      { kind: 'text', text: ' (fictional)' },
    ])
    expect(preview.removedCount).toBe(3)
    const all = JSON.stringify(preview)
    for (const secret of ['Amina', '0712345678', 'Rehema']) expect(all).not.toContain(secret)
  })

  it('ordinary text passes through unchanged', () => {
    expect(buildRedactionPreview('200 litres short at borehole 14.', null)).toEqual({
      description: [{ kind: 'text', text: '200 litres short at borehole 14.' }],
      waterPointName: null,
      removedCount: 0,
    })
  })
})
