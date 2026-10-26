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

describe('policy pages (Apple audit rows 2, 4, 6, 8)', () => {
  const read = (n: string) => readFileSync(join(process.cwd(), 'public', `${n}.html`), 'utf8')
  const privacy = read('privacy'), terms = read('terms'), support = read('support')

  it('privacy: clients section, processors, contractual-protection sentence', () => {
    expect(privacy).toContain("Your clients' information")
    for (const p of ['RevenueCat', 'Expo', 'Apple\'s Push Notification service', 'Stripe Connect']) expect(privacy).toContain(p)
    expect(privacy).toContain('Every service provider we share data with is bound by contract to protect it at least as well as this policy does and only to use it to provide services to us.')
  })
  it('privacy: no longer says sites stay online after account deletion', () => {
    expect(privacy).not.toContain('Published websites</strong> stay online')
    expect(privacy).toContain('take your published app website offline, delete its stored content and the photos uploaded for it')
  })
  it('terms: card fee sentence', () => {
    expect(terms).toContain('When clients pay you by card, Prime Barber keeps 2% of each payment and Stripe charges its own processing fee.')
  })
  it('support: delete account matches the new behaviour', () => {
    expect(support).toContain('takes your published app website offline')
    expect(support).toContain('Take my website offline')
  })
  it.each(['privacy', 'terms', 'support'])('%s: ?app=1 hides Home and web-builder/buy links', (n) => {
    const html = read(n)
    expect(html).toContain("app=1")
    expect(html).toContain('.in-app .home-link')
    expect(html).toContain('class="home-link"')
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('<body>'))
  })
  it('terms and support mark the aibarber.org purchase text web-only', () => {
    expect(terms).toContain('<li class="web-only"><strong>On aibarber.org,</strong>')
    expect(support).toContain('<li class="web-only"><strong>Bought on aibarber.org:</strong>')
  })
})
