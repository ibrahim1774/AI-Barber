import { WebsiteData } from '../types';

// Single dispatcher used by every publish path. Defaults to luxe when
// template is missing (older saved sites predate the template field).
// Dynamic imports so the heavy template renderer modules (GeneratedWebsite
// ~84KB, EuphoriaWebsite ~44KB) don't end up in the first-paint bundle —
// they're only needed on publish or re-render, never on the landing page.
export async function generateHTMLForTemplate(siteData: WebsiteData): Promise<string> {
  if (siteData.template === 'euphoria') {
    const mod = await import('../components/EuphoriaWebsite');
    return mod.generateEuphoriaHTMLWithPlaceholders(siteData);
  }
  const mod = await import('../components/GeneratedWebsite');
  return mod.generateHTMLWithPlaceholders(siteData);
}
