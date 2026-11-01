import { describe, expect, it } from 'vitest';
import { relayableUrl } from '../../api/web-app/upload-proxy';

const ok = 'https://storage.googleapis.com/primehub-site-assets/site-1/images/a.jpg?X-Goog-Algorithm=GOOG4&X-Goog-Signature=abc';
describe('upload proxy url check', () => {
  it('accepts a signed url for our bucket', () => { expect(relayableUrl(ok, 'primehub-site-assets')?.hostname).toBe('storage.googleapis.com'); });
  it('rejects other hosts, buckets, unsigned, http, credentials, traversal', () => {
    for (const bad of [
      'https://evil.com/primehub-site-assets/a.jpg?X-Goog-Signature=x',
      'https://storage.googleapis.com/other-bucket/a.jpg?X-Goog-Signature=x',
      'https://storage.googleapis.com/primehub-site-assets/a.jpg',
      'http://storage.googleapis.com/primehub-site-assets/a.jpg?X-Goog-Signature=x',
      'https://user:pw@storage.googleapis.com/primehub-site-assets/a.jpg?X-Goog-Signature=x',
      'https://storage.googleapis.com:444/primehub-site-assets/a.jpg?X-Goog-Signature=x',
      'https://storage.googleapis.com/primehub-site-assets/../x.jpg?X-Goog-Signature=x',
      'https://storage.googleapis.com.evil.com/primehub-site-assets/a.jpg?X-Goog-Signature=x',
      '', undefined, 5,
    ]) expect(relayableUrl(bad as any, 'primehub-site-assets')).toBeNull();
  });
});
