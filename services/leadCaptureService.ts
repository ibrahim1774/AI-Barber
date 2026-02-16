import { ShopInputs } from "../types";

export const captureLead = (inputs: ShopInputs): Promise<void> => {
  const webhookUrl = import.meta.env.VITE_LEAD_WEBHOOK_URL;

  if (!webhookUrl) {
    console.warn("[Lead Capture] VITE_LEAD_WEBHOOK_URL is not set, skipping lead capture.");
    return Promise.resolve();
  }

  return fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      industry: "Barbershop",
      companyName: inputs.shopName,
      location: inputs.area,
      phone: inputs.phone,
      brandColor: "#f4a100",
      timestamp: new Date().toISOString(),
      source: window.location.hostname,
    }),
  }).then(() => {
    console.log("[Lead Capture] Lead sent successfully.");
  });
};
