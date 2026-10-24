import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The product is named Prime Barber; aibarber.org stays as the domain.
describe.each(['support', 'privacy', 'terms'])('public/%s.html', (page) => {
  const html = readFileSync(join(process.cwd(), 'public', `${page}.html`), 'utf8')

  it('uses the Prime Barber name', () => {
    expect(html).toContain('Prime Barber')
    expect(html).toMatch(/<title>[^<]*Prime Barber/)
  })

  it('has no AI Barber product name left', () => {
    expect(html).not.toMatch(/AI Barber/i)
  })

  it('keeps aibarber.org links', () => {
    expect(html).toContain('aibarber.org')
  })
})

describe('support page deletion instructions', () => {
  const html = readFileSync(join(process.cwd(), 'public', 'support.html'), 'utf8')
  it('explains in-app and email account deletion', () => {
    expect(html).toContain('Settings → Delete account')
    expect(html).toContain('mailto:support@davoxa.com')
  })
})
