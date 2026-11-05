import { liveDeps, makeHandler } from '../../lib/serviceCopy/handler.js';

export const config = { maxDuration: 60 };

// Off unless SERVICE_COPY_AI=1 (and the web app flags are on). Needs ANTHROPIC_API_KEY and migration 028.
let handler: ReturnType<typeof makeHandler> | null = null;
export default function route(req: any, res: any) {
  handler ??= makeHandler(liveDeps());
  return handler(req, res);
}
