import { WebsiteData } from '../types';

// Single dispatcher used by every publish path — browser and server alike.
// Defaults to luxe when template is missing (older saved sites predate the
// template field).
//
// These used to import the .tsx editor components, which meant the only way
// to turn site data into HTML was to be a browser: the component graph pulls
// React, the editor toolbar, PublishOverlay → publishService → lib/supabase,
// and that last one reads import.meta.env at module scope and throws in Node.
// So a paid customer whose tab never came back got no site at all — nothing
// server-side could finish the job.
//
// The generators now live in lib/render/*.ts as pure functions (WebsiteData
// in, HTML string out) with no React and no DOM, so api/publish imports the
// SAME code the preview uses. Verified byte-identical output across all three
// templates before the switch.
//
// Still dynamically imported: each template carries a large CSS/HTML literal
// that has no business in the landing page's first paint.
export async function generateHTMLForTemplate(siteData: WebsiteData): Promise<string> {
  if (siteData.template === 'prime') {
    const mod = await import('../lib/render/prime');
    return mod.generatePrimeHTMLWithPlaceholders(siteData);
  }
  if (siteData.template === 'euphoria') {
    const mod = await import('../lib/render/euphoria');
    return mod.generateEuphoriaHTMLWithPlaceholders(siteData);
  }
  const mod = await import('../lib/render/luxe');
  return mod.generateHTMLWithPlaceholders(siteData);
}
