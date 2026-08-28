// Local Live Server uses the local Node backend. Netlify uses the hosted backend.
const FASHION_LOCAL_HOSTS = ["localhost", "127.0.0.1"];
window.FASHION_API_BASE = FASHION_LOCAL_HOSTS.includes(window.location.hostname)
  ? "http://localhost:3000"
  : "https://clothing-site-api.onrender.com";
window.FASHION_STORE_WHATSAPP = "212775089960";

// Hosted card payment link from your bank gateway (CMI / Payzone / bank / Stripe Payment Link).
// Do not collect card numbers on this site. Paste only the secure payment page URL from your provider.
window.CARD_PAYMENT_URL = "";