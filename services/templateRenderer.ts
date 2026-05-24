import { WebsiteData } from '../types';
import { generateHTMLWithPlaceholders } from '../components/GeneratedWebsite';
import { generateEuphoriaHTMLWithPlaceholders } from '../components/EuphoriaWebsite';

// Single dispatcher used by every publish path. Defaults to luxe when template
// is missing (older saved sites predate the template field).
export function generateHTMLForTemplate(siteData: WebsiteData): string {
  if (siteData.template === 'euphoria') {
    return generateEuphoriaHTMLWithPlaceholders(siteData);
  }
  return generateHTMLWithPlaceholders(siteData);
}
