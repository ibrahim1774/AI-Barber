import { ShopInputs } from "../types";
import { getAdAttribution } from "./adAttribution";

// Hands the lead to /api/capture-lead which forwards it to the
// configured Make.com webhook server-side. Server-side capture is
// more reliable than direct browser-to-Make because:
//   - `keepalive: true` plus serverless retries survives the page
//     navigation that immediately follows form submission;
//   - the webhook URL lives in a server env var (not VITE_*) so it
//     isn't baked into the client bundle (anyone could read it);
//   - a Vercel function reports back actual HTTP status, so we can
//     log + surface failures instead of silently succeeding when the
//     webhook returned 404/500.

export const captureLead = async (inputs: ShopInputs): Promise<void> => {
  const payload = {
    industry: "Barbershop",
    companyName: inputs.shopName,
    location: inputs.area,
    phone: inputs.phone,
    bookingLink: inputs.bookingUrl || "",
    brandColor: "#f4a100",
    source: window.location.hostname,
    sourcePath: window.location.pathname,
    // Which Facebook campaign/ad drove this lead (tw_source, tw_adid,
    // tw_campaign, utm_*, …). Empty object if the visitor didn't arrive
    // from a tagged ad link. capture-lead forwards these to Make.com.
    ...getAdAttribution(),
  };

  try {
    const resp = await fetch("/api/capture-lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.error(`[Lead Capture] /api/capture-lead returned ${resp.status}: ${text}`);
      return;
    }

    const data = await resp.json().catch(() => ({}));
    console.log("[Lead Capture] Lead forwarded to CRM.", data);
  } catch (err) {
    console.error("[Lead Capture] Network error sending lead:", err);
  }
};
