// Privacy preview and AI review panel in the report form (T6.4b, T6.5; R4.4, R4.5, R4.9, AC7, AC8, AC21).
// The extractor is a fake; the form and redactor are real. Fictional text.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AiSuggestion, ExtractableField } from '../../schemas/incident'
import type { ExtractionInput, ExtractionResult, IncidentExtractor } from '../../services/ai/types'
import type { IncidentContent } from '../../services/incidents'
import { en } from '../../strings/en'
import { WATER_POINTS } from '../../test/fakeServices'
import { IncidentForm } from './IncidentForm'

const a = en.ai
const NOW = () => new Date('2026-03-20T12:00:00Z')
const PERSONAL = 'My name is Amina Otieno, call 0712 345 678. Tap 2 near the trough is leaking.'

const suggestion = (suggested: Partial<AiSuggestion['suggested']> = {}, inferenceSource: AiSuggestion['inferenceSource'] = 'in_cloud'): AiSuggestion => ({
  suggested: { incidentType: 'leak', severity: 'high', occurredAt: null, locationNote: 'near the trough', ...suggested },
  inferenceSource,
  model: inferenceSource === 'in_cloud' ? 'gemini-3.5-flash-lite' : 'chrome-built-in',
  generatedAt: '2026-03-20T12:00:00.000Z',
})

function fakeExtractor(...results: ExtractionResult[]) {
  const calls: ExtractionInput[] = []
  const extract = vi.fn(async (input: ExtractionInput): Promise<ExtractionResult> => {
    calls.push(input)
    return results.shift() ?? { ok: false, reason: 'unavailable' }
  })
  const extractor: IncidentExtractor = { extract }
  return { extractor, extract, calls }
}

const field = (label: string) => screen.getByLabelText(new RegExp(`^${label.replace(/[?]/g, '\\?')}`))
const description = () => field(en.reports.fields.description) as HTMLTextAreaElement

function renderForm(options: { extractor?: IncidentExtractor; initial?: IncidentContent; confirmedFields?: readonly ExtractableField[] } = {}) {
  const onSubmit = vi.fn<(content: IncidentContent) => Promise<void>>(async () => undefined)
  render(
    <IncidentForm
      waterPoints={WATER_POINTS}
      onSubmit={onSubmit}
      now={NOW}
      {...(options.extractor ? { extractor: options.extractor } : {})}
      {...(options.initial ? { initial: options.initial } : {})}
      {...(options.confirmedFields ? { confirmedFields: options.confirmedFields } : {})}
    />,
  )
  return { onSubmit }
}

const type = (text: string) => fireEvent.change(description(), { target: { value: text } })
const openPreview = () => fireEvent.click(screen.getByRole('button', { name: a.suggest }))
const preview = () => screen.getByRole('region', { name: a.previewTitle })
const send = async () => {
  fireEvent.click(within(preview()).getByRole('button', { name: a.send }))
  return screen.findByRole('region', { name: a.reviewTitle })
}

describe('without an extractor', () => {
  it('the form is manual only', () => {
    renderForm()
    expect(screen.queryByRole('button', { name: a.suggest })).not.toBeInTheDocument()
  })
})

describe('privacy preview (T6.4b, R4.9, AC21)', () => {
  it('shows the description help text', () => {
    renderForm({ extractor: fakeExtractor().extractor })
    expect(screen.getByText(en.reports.fields.descriptionHint)).toBeInTheDocument()
  })

  it('makes no AI call until "Send"', () => {
    const { extractor, extract } = fakeExtractor()
    renderForm({ extractor })
    type(PERSONAL)
    openPreview()
    expect(preview()).toBeInTheDocument()
    expect(extract).not.toHaveBeenCalled()
  })

  it('asks for a description first when it is empty, with no call', () => {
    const { extractor, extract } = fakeExtractor()
    renderForm({ extractor })
    openPreview()
    expect(screen.getByText(a.needsDescription)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: a.previewTitle })).not.toBeInTheDocument()
    expect(extract).not.toHaveBeenCalled()
  })

  it('shows the redacted text with removals marked, never the original values', () => {
    renderForm({ extractor: fakeExtractor().extractor })
    fireEvent.change(field(en.reports.fields.waterPoint), { target: { value: 'wp-soko' } })
    type(PERSONAL)
    openPreview()
    const text = within(preview()).getByTestId('ai-preview-text')
    expect(text).toHaveTextContent('My name is [NAME] (name removed), call [PHONE] (phone number removed). Tap 2 near the trough is leaking.')
    expect(text).toHaveTextContent('Soko Kiosk (fictional)')
    for (const secret of ['Amina', 'Otieno', '0712', '345 678']) expect(preview()).not.toHaveTextContent(secret)
    expect(within(text).getAllByText(/\[(NAME|PHONE)\]/).every((el) => el.closest('mark'))).toBe(true)
  })

  it('shows the warning about undetected details in an announced alert', () => {
    renderForm({ extractor: fakeExtractor().extractor })
    type(PERSONAL)
    openPreview()
    expect(within(preview()).getByRole('alert')).toHaveTextContent(a.previewWarning)
  })

  it('"Cancel" makes no call and manual entry still works', async () => {
    const { extractor, extract } = fakeExtractor()
    const { onSubmit } = renderForm({ extractor })
    fireEvent.change(field(en.reports.fields.waterPoint), { target: { value: 'wp-soko' } })
    type('Tap dry (fictional).')
    openPreview()
    fireEvent.click(within(preview()).getByRole('button', { name: a.cancel }))
    expect(screen.queryByRole('region', { name: a.previewTitle })).not.toBeInTheDocument()
    fireEvent.change(field(en.reports.fields.incidentType), { target: { value: 'no_water' } })
    fireEvent.click(screen.getByRole('button', { name: en.reports.save }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(onSubmit.mock.calls[0][0]).toEqual({ waterPointId: 'wp-soko', description: 'Tap dry (fictional).', incidentType: 'no_water', severity: null })
    expect(extract).not.toHaveBeenCalled()
  })

  it('"Edit description first" returns focus to the description and rebuilds the preview', async () => {
    const { extractor, extract } = fakeExtractor()
    renderForm({ extractor })
    type(PERSONAL)
    openPreview()
    fireEvent.click(within(preview()).getByRole('button', { name: a.editFirst }))
    // react-hook-form moves focus in a timeout.
    await waitFor(() => expect(description()).toHaveFocus())
    type('Tap 2 near the trough is leaking.')
    expect(within(preview()).getByTestId('ai-preview-text')).toHaveTextContent(/^Description: Tap 2 near the trough is leaking\.$/)
    expect(extract).not.toHaveBeenCalled()
  })

  it('"Send" passes the current description; the service redacts it before the model call', async () => {
    const { extractor, calls } = fakeExtractor({ ok: true, suggestion: suggestion(), dropped: [] })
    renderForm({ extractor })
    fireEvent.change(field(en.reports.fields.waterPoint), { target: { value: 'wp-soko' } })
    type(PERSONAL)
    openPreview()
    await send()
    expect(calls).toEqual([{ description: PERSONAL, waterPointName: 'Soko Kiosk (fictional)' }])
  })
})

describe('review panel (T6.5, R4.4, AC7)', () => {
  it('shows proposals with the SDK-reported source; nothing is applied until "Use"', async () => {
    const { extractor } = fakeExtractor({ ok: true, suggestion: suggestion({}, 'on_device'), dropped: [] })
    const { onSubmit } = renderForm({ extractor })
    type('Tap 2 near the trough is leaking, very serious.')
    openPreview()
    const review = await send()
    expect(within(review).getByText(a.source.on_device)).toBeInTheDocument()
    expect(within(review).getByText(a.reviewIntro)).toBeInTheDocument()
    expect(review).toHaveTextContent(`${en.reports.fields.incidentType}: ${en.incidentTypes.leak}`)
    expect(review).toHaveTextContent(`${en.reports.fields.severity}: ${en.severities.high}`)
    expect(review).toHaveTextContent(`${en.reports.fields.locationNote}: near the trough`)
    expect(screen.getByRole('status')).toHaveTextContent(a.reviewReady)
    expect((field(en.reports.fields.severity) as HTMLSelectElement).value).toBe('')
    expect((field(en.reports.fields.locationNote) as HTMLInputElement).value).toBe('')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows the cloud source label', async () => {
    const { extractor } = fakeExtractor({ ok: true, suggestion: suggestion({}, 'in_cloud'), dropped: [] })
    renderForm({ extractor })
    type('Leak.')
    openPreview()
    expect(within(await send()).getByText(a.source.in_cloud)).toBeInTheDocument()
  })

  it('"Use" fills a field, "Use and edit" fills and focuses, "Ignore" removes the proposal', async () => {
    const { extractor } = fakeExtractor({ ok: true, suggestion: suggestion(), dropped: [] })
    renderForm({ extractor })
    type('Tap 2 near the trough is leaking, very serious.')
    openPreview()
    const review = await send()
    fireEvent.click(within(review).getByRole('button', { name: `${a.use}: ${en.reports.fields.incidentType}` }))
    expect((field(en.reports.fields.incidentType) as HTMLSelectElement).value).toBe('leak')
    expect(screen.getByRole('status')).toHaveTextContent(`${en.reports.fields.incidentType} filled in`)
    fireEvent.click(within(review).getByRole('button', { name: `${a.useAndEdit}: ${en.reports.fields.locationNote}` }))
    expect(field(en.reports.fields.locationNote)).toHaveValue('near the trough')
    await waitFor(() => expect(field(en.reports.fields.locationNote)).toHaveFocus())
    fireEvent.click(within(review).getByRole('button', { name: `${a.ignore}: ${en.reports.fields.severity}` }))
    expect((field(en.reports.fields.severity) as HTMLSelectElement).value).toBe('')
    expect(within(review).getByText(a.none)).toBeInTheDocument()
  })

  it('saves the AI block as provenance with the reporter-confirmed values', async () => {
    const s = suggestion()
    const { extractor } = fakeExtractor({ ok: true, suggestion: s, dropped: [] })
    const { onSubmit } = renderForm({ extractor })
    fireEvent.change(field(en.reports.fields.waterPoint), { target: { value: 'wp-soko' } })
    type('Tap 2 near the trough is leaking.')
    openPreview()
    const review = await send()
    fireEvent.click(within(review).getByRole('button', { name: `${a.use}: ${en.reports.fields.incidentType}` }))
    fireEvent.click(screen.getByRole('button', { name: en.reports.save }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(onSubmit.mock.calls[0][0]).toEqual({
      waterPointId: 'wp-soko',
      description: 'Tap 2 near the trough is leaking.',
      incidentType: 'leak',
      severity: null,
      ai: s,
    })
  })

  it.each([
    ['unavailable', a.unavailable.unavailable],
    ['offline', a.unavailable.offline],
    ['timeout', a.unavailable.timeout],
    ['invalid', a.unavailable.invalid],
  ] as const)('%s: says suggestions are unavailable and the form still saves (R4.7)', async (reason, message) => {
    const { extractor } = fakeExtractor({ ok: false, reason })
    const { onSubmit } = renderForm({ extractor })
    fireEvent.change(field(en.reports.fields.waterPoint), { target: { value: 'wp-soko' } })
    type('Tap dry (fictional).')
    openPreview()
    fireEvent.click(within(preview()).getByRole('button', { name: a.send }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(a.unavailableTitle)
    expect(alert).toHaveTextContent(message)
    fireEvent.change(field(en.reports.fields.incidentType), { target: { value: 'no_water' } })
    fireEvent.click(screen.getByRole('button', { name: en.reports.save }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('ai')
  })
})

describe('confirmed fields are preserved (R4.5, AC8)', () => {
  it('a field the reporter set before the run is not proposed', async () => {
    const { extractor } = fakeExtractor({ ok: true, suggestion: suggestion(), dropped: [] })
    renderForm({ extractor })
    type('Tap 2 near the trough is leaking.')
    fireEvent.change(field(en.reports.fields.severity), { target: { value: 'low' } })
    openPreview()
    const review = await send()
    expect(within(review).queryByRole('button', { name: `${a.use}: ${en.reports.fields.severity}` })).not.toBeInTheDocument()
    expect(within(review).getByText(a.keptYours)).toBeInTheDocument()
    expect((field(en.reports.fields.severity) as HTMLSelectElement).value).toBe('low')
  })

  it('re-running keeps accepted and edited fields', async () => {
    const { extractor } = fakeExtractor(
      { ok: true, suggestion: suggestion(), dropped: [] },
      { ok: true, suggestion: suggestion({ incidentType: 'no_water', severity: 'low', locationNote: 'by the gate' }), dropped: [] },
    )
    renderForm({ extractor })
    type('Tap 2 near the trough is leaking, by the gate.')
    openPreview()
    let review = await send()
    fireEvent.click(within(review).getByRole('button', { name: `${a.use}: ${en.reports.fields.incidentType}` }))
    fireEvent.click(within(review).getByRole('button', { name: `${a.useAndEdit}: ${en.reports.fields.locationNote}` }))
    fireEvent.change(field(en.reports.fields.locationNote), { target: { value: 'the left tap near the trough' } })

    openPreview()
    review = await send()
    await waitFor(() => expect(within(review).getByText(a.keptYours)).toBeInTheDocument())
    expect((field(en.reports.fields.incidentType) as HTMLSelectElement).value).toBe('leak')
    expect(field(en.reports.fields.locationNote)).toHaveValue('the left tap near the trough')
    // Only the never-confirmed severity is proposed again.
    expect(within(review).getByRole('button', { name: `${a.use}: ${en.reports.fields.severity}` })).toBeInTheDocument()
    expect(within(review).queryByRole('button', { name: `${a.use}: ${en.reports.fields.incidentType}` })).not.toBeInTheDocument()
    expect(within(review).queryByRole('button', { name: `${a.use}: ${en.reports.fields.locationNote}` })).not.toBeInTheDocument()
  })

  it('editing a saved report: fields confirmed in earlier saves stay closed even if now empty', async () => {
    const { extractor } = fakeExtractor({ ok: true, suggestion: suggestion(), dropped: [] })
    renderForm({
      extractor,
      initial: { waterPointId: 'wp-soko', description: 'Tap 2 near the trough is leaking.', incidentType: 'other', severity: null },
      confirmedFields: ['incidentType', 'severity'],
    })
    openPreview()
    const review = await send()
    expect(within(review).queryByRole('button', { name: `${a.use}: ${en.reports.fields.severity}` })).not.toBeInTheDocument()
    expect(within(review).queryByRole('button', { name: `${a.use}: ${en.reports.fields.incidentType}` })).not.toBeInTheDocument()
    expect(within(review).getByRole('button', { name: `${a.use}: ${en.reports.fields.locationNote}` })).toBeInTheDocument()
  })
})
