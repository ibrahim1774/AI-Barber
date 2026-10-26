import { PRIVACY_URL, SUPPORT_URL, TERMS_URL } from '@/lib/policyLinks';

describe('in-app policy links', () => {
  it('all carry ?app=1 so the site hides its Home link', () => {
    expect(PRIVACY_URL).toBe('https://www.aibarber.org/privacy?app=1');
    expect(TERMS_URL).toBe('https://www.aibarber.org/terms?app=1');
    expect(SUPPORT_URL).toBe('https://www.aibarber.org/support?app=1');
  });
  it('no source file opens a bare privacy/terms/support page', () => {
    const { execSync } = require('child_process');
    const out = execSync(`grep -rnE "aibarber\\.org/(privacy|terms|support)" src --include=*.ts --include=*.tsx | grep -v "src/web/" | grep -v "app=1" | grep -v "policyLinks.ts" || true`, { cwd: require('path').join(__dirname, '..') }).toString();
    // Doc comments naming the page ("aibarber.org/support") are not links.
    const links = out.split('\n').filter((l: string) => /https?:\/\//.test(l));
    expect(links).toEqual([]);
  });
});
