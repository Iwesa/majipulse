import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { en } from '../../strings/en'
import { SelectField } from './SelectField'
import { TextArea } from './TextArea'
import { TextField } from './TextField'

const options = [
  { value: 'borehole', label: 'Borehole' },
  { value: 'kiosk', label: 'Kiosk' },
]

const cases = [
  ['TextField', (props: { error?: string; hint?: string; required?: boolean }) => <TextField label="Name" {...props} />, 'textbox'],
  ['TextArea', (props: { error?: string; hint?: string; required?: boolean }) => <TextArea label="Name" {...props} />, 'textbox'],
  [
    'SelectField',
    (props: { error?: string; hint?: string; required?: boolean }) => <SelectField label="Name" options={options} {...props} />,
    'combobox',
  ],
] as const

describe.each(cases)('%s', (_name, renderField, role) => {
  it('associates the label with the control', () => {
    render(renderField({}))
    expect(screen.getByRole(role, { name: 'Name' })).toBeInTheDocument()
  })

  it('has no aria-describedby or aria-invalid by default', () => {
    render(renderField({}))
    const control = screen.getByRole(role)
    expect(control).not.toHaveAttribute('aria-describedby')
    expect(control).not.toHaveAttribute('aria-invalid')
  })

  it('links the hint through aria-describedby', () => {
    render(renderField({ hint: 'Use the sign-board name' }))
    expect(screen.getByRole(role)).toHaveAccessibleDescription('Use the sign-board name')
  })

  it('marks errors invalid and describes them with a text prefix', () => {
    render(renderField({ hint: 'Hint text', error: 'Enter a name' }))
    const control = screen.getByRole(role)
    expect(control).toHaveAttribute('aria-invalid', 'true')
    expect(control).toHaveAccessibleDescription(`Hint text ${en.common.errorPrefix} Enter a name`)
  })

  it('shows a visible required marker and sets required', () => {
    render(renderField({ required: true }))
    expect(screen.getByRole(role, { name: `Name ${en.common.required}` })).toBeRequired()
  })
})

describe('field specifics', () => {
  it('generates unique IDs for multiple fields', () => {
    render(
      <>
        <TextField label="First" />
        <TextField label="Second" />
      </>,
    )
    const [a, b] = screen.getAllByRole('textbox')
    expect(a.id).not.toBe(b.id)
  })

  it('uses a provided id', () => {
    render(<TextField label="Ward" id="ward-field" />)
    expect(screen.getByLabelText('Ward')).toHaveAttribute('id', 'ward-field')
  })

  it('passes input props and change events through', () => {
    const onChange = vi.fn()
    render(<TextField label="Email" type="email" onChange={onChange} />)
    const input = screen.getByRole('textbox', { name: 'Email' })
    expect(input).toHaveAttribute('type', 'email')
    fireEvent.change(input, { target: { value: 'a@example.org' } })
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('renders select options with a placeholder from the strings module', () => {
    render(<SelectField label="Type" options={options} />)
    const names = screen.getAllByRole('option').map((o) => o.textContent)
    expect(names).toEqual([en.common.selectPlaceholder, 'Borehole', 'Kiosk'])
  })

  it('can omit the select placeholder', () => {
    render(<SelectField label="Type" options={options} placeholder={null} />)
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })
})
