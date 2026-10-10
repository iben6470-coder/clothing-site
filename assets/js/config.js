// Local dev uses the local Node backend on :3000. When deployed to Netlify, the
// backend runs as a Netlify Function on the SAME domain, so we call same-origin
// "/api" (empty base) - no separate Render host and no CORS needed.
const FASHION_LOCAL_HOSTS = ["localhost", "127.0.0.1"];
window.FASHION_API_BASE = FASHION_LOCAL_HOSTS.includes(window.location.hostname)
  ? "http://localhost:3000"
  : "";
window.FASHION_STORE_WHATSAPP = "212775089960";

// Hosted card payment link from your bank gateway (CMI / Payzone / bank / Stripe Payment Link).
// Do not collect card numbers on this site. Paste only the secure payment page URL from your provider.
window.CARD_PAYMENT_URL = "";