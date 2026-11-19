/**
 * Dependency-free accessibility checks (T9.2), shared by component tests
 * (jsdom) and Playwright (real browser, via `page.evaluate(auditDocument, ...)`).
 *
 * The function must stay self-contained: Playwright serializes its source and
 * runs it in the page, so it cannot use imports or outer variables.
 *
 * Covers names of controls and links, label and description references,
 * unique IDs, headings, landmarks, tables, invalid-field error links, and
 * positive tabindex. With `browser: true` it also checks text contrast
 * (WCAG 1.4.3), target size (WCAG 2.5.8), and horizontal overflow (1.4.10),
 * which need real layout and CSS.
 */
export interface AuditOptions {
  browser?: boolean
}

export interface AuditViolation {
  rule: string
  element: string
}

export function auditDocument(options: AuditOptions = {}): AuditViolation[] {
  const violations: AuditViolation[] = []
  const describe = (el: Element) => {
    const id = el.id ? `#${el.id}` : ''
    const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60)
    return `<${el.tagName.toLowerCase()}${id}> ${text}`
  }
  const report = (rule: string, el: Element) => violations.push({ rule, element: describe(el) })

  /** Hidden from everyone: display none, hidden attribute, or inside aria-hidden. */
  const isHidden = (el: Element): boolean => {
    for (let node: Element | null = el; node; node = node.parentElement) {
      if (node.getAttribute('aria-hidden') === 'true' || node.hasAttribute('hidden')) return true
      if (options.browser) {
        const style = getComputedStyle(node)
        if (style.display === 'none' || style.visibility === 'hidden') return true
      } else if (node instanceof HTMLElement && node.style.display === 'none') return true
    }
    return false
  }

  const byId = (id: string) => document.getElementById(id)
  const textOf = (el: Element): string => {
    let text = ''
    el.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? ''
      else if (child instanceof Element && child.getAttribute('aria-hidden') !== 'true') {
        text += child.getAttribute('aria-label') ?? child.getAttribute('alt') ?? textOf(child)
      }
    })
    return text.trim()
  }
  const labelledByText = (el: Element) =>
    (el.getAttribute('aria-labelledby') ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => (byId(id) ? textOf(byId(id) as Element) : ''))
      .join(' ')
      .trim()
  const accessibleName = (el: Element): string => {
    const labelledBy = labelledByText(el)
    if (labelledBy) return labelledBy
    const aria = el.getAttribute('aria-label')?.trim()
    if (aria) return aria
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
      const labels = el.labels ? Array.from(el.labels).map(textOf).join(' ').trim() : ''
      if (labels) return labels
      return el.getAttribute('title')?.trim() ?? ''
    }
    return textOf(el) || (el.getAttribute('title')?.trim() ?? '')
  }

  // 1. Unique IDs (label and ARIA references depend on them).
  const seen = new Map<string, Element>()
  document.querySelectorAll('[id]').forEach((el) => {
    if (seen.has(el.id)) report('duplicate-id', el)
    else seen.set(el.id, el)
  })

  // 2. ARIA ID references point at existing elements.
  for (const attr of ['aria-labelledby', 'aria-describedby', 'aria-controls']) {
    document.querySelectorAll(`[${attr}]`).forEach((el) => {
      const ids = (el.getAttribute(attr) ?? '').split(/\s+/).filter(Boolean)
      if (ids.length === 0 || ids.some((id) => !byId(id))) report(`${attr}-missing-target`, el)
    })
  }

  // 3. Form controls have a name.
  document.querySelectorAll('input, select, textarea').forEach((el) => {
    if (el instanceof HTMLInputElement && el.type === 'hidden') return
    if (isHidden(el)) return
    if (!accessibleName(el)) report('control-without-name', el)
  })

  // 4. Buttons and links have a name; links have a destination.
  document.querySelectorAll('button, a, [role="button"], [role="link"]').forEach((el) => {
    if (isHidden(el)) return
    if (!accessibleName(el)) report(el.tagName === 'A' ? 'link-without-name' : 'button-without-name', el)
    if (el.tagName === 'A' && !el.hasAttribute('href')) report('link-without-href', el)
  })

  // 5. Interactive elements are not nested.
  document.querySelectorAll('a button, button a, button button, a a').forEach((el) => report('nested-interactive', el))

  // 6. No positive tabindex (it breaks the natural focus order).
  document.querySelectorAll('[tabindex]').forEach((el) => {
    if (Number(el.getAttribute('tabindex')) > 0) report('positive-tabindex', el)
  })

  // 7. Images and SVG icons are either named or hidden.
  document.querySelectorAll('img').forEach((el) => {
    if (!el.hasAttribute('alt')) report('img-without-alt', el)
  })
  document.querySelectorAll('svg').forEach((el) => {
    if (isHidden(el)) return
    if (el.getAttribute('role') === 'img' && accessibleName(el)) return
    report('svg-not-hidden', el)
  })

  // 8. Invalid fields point at a visible error message.
  document.querySelectorAll('[aria-invalid="true"]').forEach((el) => {
    const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
    if (!ids.some((id) => (byId(id)?.textContent ?? '').trim().length > 0)) report('invalid-without-error', el)
  })

  // 9. Headings: exactly one h1, and no skipped levels going down.
  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).filter((h) => !isHidden(h))
  const h1s = headings.filter((h) => h.tagName === 'H1')
  if (h1s.length !== 1) violations.push({ rule: h1s.length === 0 ? 'no-h1' : 'multiple-h1', element: h1s.map(describe).join(' | ') || '(page)' })
  let previous = 0
  for (const h of headings) {
    const level = Number(h.tagName[1])
    if (previous && level > previous + 1) report('heading-level-skipped', h)
    if (!textOf(h)) report('empty-heading', h)
    previous = level
  }

  // 10. Landmarks: one main; navigation landmarks are labelled when there is more than one.
  const mains = document.querySelectorAll('main, [role="main"]')
  if (mains.length !== 1) violations.push({ rule: 'main-landmark-count', element: String(mains.length) })
  const navs = document.querySelectorAll('nav')
  if (navs.length > 1) navs.forEach((nav) => !accessibleName(nav) && report('nav-without-label', nav))
  document.querySelectorAll('section[aria-labelledby], section[aria-label]').forEach((s) => {
    if (!accessibleName(s)) report('region-without-name', s)
  })

  // 11. Data tables have header cells with scope and a caption or name.
  document.querySelectorAll('table').forEach((table) => {
    const ths = table.querySelectorAll('th')
    if (ths.length === 0) report('table-without-headers', table)
    ths.forEach((th) => !th.hasAttribute('scope') && report('th-without-scope', th))
    if (!table.querySelector('caption') && !accessibleName(table)) report('table-without-caption', table)
  })

  // 12. Live regions and dialogs are named or have content roles.
  document.querySelectorAll('[role="dialog"], [role="alertdialog"]').forEach((d) => {
    if (!accessibleName(d)) report('dialog-without-name', d)
  })

  if (options.browser) {
    // 13. No horizontal scrolling at the current width (WCAG 1.4.10, checked at 360 px).
    if (document.documentElement.scrollWidth > window.innerWidth + 1) {
      violations.push({ rule: 'horizontal-overflow', element: `${document.documentElement.scrollWidth}px > ${window.innerWidth}px` })
    }

    // 14. Text contrast (WCAG 1.4.3): 4.5:1, or 3:1 for large text.
    // Tailwind v4 colors compute to oklch(); a 1x1 canvas converts any CSS color to sRGB.
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const cache = new Map<string, [number, number, number, number] | null>()
    const parse = (value: string): [number, number, number, number] | null => {
      if (cache.has(value)) return cache.get(value) ?? null
      let result: [number, number, number, number] | null = null
      const alpha = /\/\s*([\d.]+%?)\s*\)$|rgba\([^)]*,\s*([\d.]+)\)$/.exec(value)
      const a = alpha ? (alpha[1] ? (alpha[1].endsWith('%') ? parseFloat(alpha[1]) / 100 : parseFloat(alpha[1])) : parseFloat(alpha[2])) : 1
      if (value === 'transparent' || a === 0) result = [0, 0, 0, 0]
      else if (ctx) {
        ctx.clearRect(0, 0, 1, 1)
        ctx.fillStyle = '#000'
        ctx.fillStyle = value
        ctx.fillRect(0, 0, 1, 1)
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
        result = [r, g, b, a]
      }
      cache.set(value, result)
      return result
    }
    const channel = (c: number) => {
      const s = c / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    const luminance = ([r, g, b]: [number, number, number, number]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    const blend = (top: [number, number, number, number], bottom: [number, number, number, number]): [number, number, number, number] => {
      const a = top[3]
      return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1]
    }
    const backgroundOf = (el: Element): [number, number, number, number] | null => {
      const layers: Array<[number, number, number, number]> = []
      for (let node: Element | null = el; node; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (style.backgroundImage && style.backgroundImage !== 'none') return null
        const bg = parse(style.backgroundColor)
        if (bg && bg[3] > 0) {
          layers.push(bg)
          if (bg[3] >= 1) break
        }
      }
      let color: [number, number, number, number] = [255, 255, 255, 1]
      for (const layer of layers.reverse()) color = blend(layer, color)
      return color
    }
    const isVisuallyHidden = (el: Element) => {
      for (let node: Element | null = el; node; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (style.clip === 'rect(0px, 0px, 0px, 0px)' || style.clipPath === 'inset(50%)' || (node as HTMLElement).offsetWidth <= 1) return true
      }
      return false
    }
    const checked = new Set<Element>()
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement
      if (!el || checked.has(el) || !(node.textContent ?? '').trim()) continue
      checked.add(el)
      if (isHidden(el) || isVisuallyHidden(el) || el.closest('[disabled], [aria-disabled="true"]')) continue
      const style = getComputedStyle(el)
      const fg = parse(style.color)
      const bg = backgroundOf(el)
      if (!fg || !bg || Number(style.opacity) < 1) continue
      const color = blend(fg, bg)
      const [l1, l2] = [luminance(color), luminance(bg)].sort((a, b) => b - a)
      const ratio = (l1 + 0.05) / (l2 + 0.05)
      const size = parseFloat(style.fontSize)
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700)
      if (ratio < (large ? 3 : 4.5)) violations.push({ rule: 'contrast', element: `${describe(el)} (${ratio.toFixed(2)}:1)` })
    }

    // 15. Target size (WCAG 2.5.8): controls at least 24 x 24 px. Inline text links are exempt.
    document.querySelectorAll('button, input:not([type="hidden"]), select, textarea, [role="button"]').forEach((el) => {
      if (isHidden(el) || isVisuallyHidden(el)) return
      const rect = el.getBoundingClientRect()
      if (rect.width < 24 || rect.height < 24) violations.push({ rule: 'target-size', element: `${describe(el)} (${Math.round(rect.width)}x${Math.round(rect.height)})` })
    })
  }

  return violations
}
