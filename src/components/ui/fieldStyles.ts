export const controlClasses =
  'block w-full rounded-md border bg-white px-3 py-2 text-base text-slate-900 ' +
  'focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-sky-600 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-100'

export const controlBorder = (invalid: boolean): string => (invalid ? 'border-red-700' : 'border-slate-400')
