// Backwards-compat shim. The unified endpoint lives at /api/import-scrape
// now and handles Booksy + Fresha + StyleSeat + Square + Vagaro. Keeping
// this file so older client builds (cached HTML, in-flight users) still
// resolve to working logic.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import importHandler from './import-scrape.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  return importHandler(req, res);
}
