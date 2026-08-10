/**
 * Stable marker embedded in website → WhatsApp "Order" deep-link messages.
 * Incoming processor parses this to start checkout at create-catalog-order.
 */
export const CATALOG_WEBSITE_ORDER_MARKER = 'AW_PRODUCT_ID';

const MARKER_RE = /\bAW_PRODUCT_ID\s*:\s*(\d+)\b/i;
const BUY_INTENT_RE =
  /\b(i\s*(would\s*like|want)\s*to\s*buy|want\s*to\s*order|please\s*share\s*the\s*payment\s*qr)\b/i;

export function parseWebsiteCatalogOrderProductId(content: string): number | null {
  const text = String(content || '').trim();
  if (!text) return null;
  const match = text.match(MARKER_RE);
  if (!match) return null;
  const id = Number(match[1]);
  if (!Number.isFinite(id) || id <= 0) return null;
  // Prefer messages that look like a buy request; still accept bare marker + product id.
  if (!BUY_INTENT_RE.test(text) && !/product/i.test(text)) {
    return null;
  }
  return id;
}

export function buildWebsiteOrderWhatsAppText(product: {
  id: number;
  name: string;
  price_amount?: number | null;
  price_currency?: string | null;
  description?: string | null;
}): string {
  const price =
    product.price_amount != null && Number.isFinite(Number(product.price_amount))
      ? formatPrice(Number(product.price_amount), product.price_currency || 'INR')
      : null;
  const desc = String(product.description || '')
    .trim()
    .slice(0, 120);

  const lines = [
    'Hi! I would like to buy this product.',
    '',
    `*${product.name}*`,
    price ? `Price: ${price}` : null,
    desc ? `Details: ${desc}` : null,
    `${CATALOG_WEBSITE_ORDER_MARKER}:${product.id}`,
    '',
    'Please share the payment QR so I can complete my order.',
  ];
  return lines.filter((l) => l != null).join('\n');
}

function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `₹${amount.toLocaleString('en-IN')}`;
  }
}
