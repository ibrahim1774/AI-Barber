/**
 * Settings' "Publish" hands off to the Edit tab, which runs the one publish
 * path (handlePublish → /publishing). A one-shot flag, not a route param, so
 * it can never fire again on a later visit to the tab.
 */
let requested = false;

export function requestPublish(): void {
  requested = true;
}

/** True once per request; clears it. */
export function takePublishRequest(): boolean {
  const was = requested;
  requested = false;
  return was;
}
