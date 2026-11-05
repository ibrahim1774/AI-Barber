// Server-side switches for the service-text endpoint. Read at call time (never cached) so a flip takes effect on the next request.
/**
 * SERVICE_COPY_AUTO_PUBLISH. OFF (anything but the string '1') is the default and the safe state: free-form text a model writes
 * (Mode B, "Write it for me") is only ever a PROPOSAL until the barber taps "Looks right"; nothing a model wrote renders, indexes
 * or reaches a sitemap without that approval. ON ('1') lets Mode B text render without approval (the original no-approval decision).

 * RUNBOOK (review 6c NIT 4): the value must be EXACTLY the string 1. A value with a space or a newline ("1\n"), "true" or "on" is OFF (the safe direction).
 * Turning it off is a real kill switch: stored 'auto' text stops printing on the next deploy render (renderPendingBundle) and is dropped on the next save.
 * Mode A (the classifier choosing a library family) never prints model text and is not affected by this flag.
 *
 * REQUIRED ENV before SERVICE_COPY_AI is turned on (review 6d): SERVICE_COPY_SIGNING_SECRET, 16+ random characters (e.g. 32 bytes of hex), server-side only,
 * never logged. It signs every approval of model text (approval.ts), binding it to the account, the draft or site, the service, the niche and the text.
 * Unset or shorter than 16: the whole feature answers 404 (off), nothing is signed and no model text is ever kept or printed (a log line names the variable, never a value).
 * Rotating it retires every approval at once (pages with model text go thin until re-approved). A draft approval expires after 30 days; a published site's does not.
 */
export const serviceCopyAutoPublish = (env: Record<string, string | undefined> = process.env): boolean => env.SERVICE_COPY_AUTO_PUBLISH === '1';
