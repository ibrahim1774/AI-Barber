/**
 * S3 (e2e pressure test): the app is "Prime Barber" everywhere a user can see a name. Internal keys stay
 * (bundle id com.ibrahim1774.aibarber, slug and scheme "aibarber", the 'aibarber' booking-choice value, aibarber.org).
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..');
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('Prime Barber naming', () => {
  it('the app name and every permission string say Prime Barber', () => {
    expect(app.name).toBe('Prime Barber');
    const strings: string[] = [];
    const collect = (v: unknown) => {
      if (typeof v === 'string') strings.push(v);
      else if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === 'object') Object.values(v).forEach(collect);
    };
    collect(app.plugins);
    collect(app.ios.infoPlist);
    expect(strings.filter((s) => /ai[ -]?barber/i.test(s))).toEqual([]);
    expect(strings.filter((s) => /uses (your|this)/.test(s)).every((s) => s.startsWith('Prime Barber'))).toBe(true);
  });

  it('internal keys are unchanged', () => {
    expect(app.ios.bundleIdentifier).toBe('com.ibrahim1774.aibarber');
    expect(app.scheme).toBe('aibarber');
    expect(app.slug).toBe('aibarber');
  });

  it('no string literal in src shows "AI Barber" to a user', () => {
    const hits: string[] = [];
    for (const f of walk(path.join(root, 'src'))) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, ''); // comments are not user-visible
        if (/(["'`])[^"'`\n]*\bA[Ii][ -]Barber\b[^"'`\n]*\1/.test(code)) hits.push(`${path.relative(root, f)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('the notification mock and reminders use the Prime Barber title', () => {
    const { REMINDER_TITLE } = require('@/lib/reminders');
    expect(REMINDER_TITLE).toBe('Prime Barber');
  });
});
