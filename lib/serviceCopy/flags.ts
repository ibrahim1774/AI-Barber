// Server-side switches for the service-text endpoint. Read at call time (never cached) so a flip takes effect on the next request.
/**
 * SERVICE_COPY_AUTO_PUBLISH. OFF (anything but the string '1') is the default and the safe state: free-form text a model writes
 * (Mode B, "Write it for me") is only ever a PROPOSAL until the barber taps "Looks right"; nothing a model wrote renders, indexes
 * or reaches a sitemap without that approval. ON ('1') lets Mode B text render without approval (the original no-approval decision).
 * Mode A (the classifier choosing a library family) never prints model text and is not affected by this flag.
 */
export const serviceCopyAutoPublish = (env: Record<string, string | undefined> = process.env): boolean => env.SERVICE_COPY_AUTO_PUBLISH === '1';
