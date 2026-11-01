// Web only: the real module is webAutosave.web.ts. Nothing to load in the phone app.
export {};
/** Phone: nothing to flush (the draft is published or synced by its own flows). */
export async function flushWebAutosave(_capMs?: number): Promise<void> {}
