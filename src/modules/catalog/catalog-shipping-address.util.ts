export type ParsedShippingAddress = {
  shipping_name: string | null;
  shipping_address_line: string;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_pincode: string;
  shipping_landmark: string | null;
  shipping_phone: string | null;
};

/**
 * Parse a customer WhatsApp reply for shipping address.
 * Prefers labeled lines (Address:/City:/Pincode:); falls back to free text + PIN.
 */
export function parseShippingAddressMessage(content: string): ParsedShippingAddress | null {
  const text = String(content || '').trim();
  if (!text || text.length < 8) return null;

  const labeled = parseLabeled(text);
  if (labeled) return labeled;

  const pinMatch = text.match(/\b(\d{6})\b/);
  if (!pinMatch) return null;

  // Free-form: whole message as address line; require a pincode somewhere.
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 1) return null;

  return {
    shipping_name: null,
    shipping_address_line: lines.join(', ').slice(0, 500),
    shipping_city: null,
    shipping_state: null,
    shipping_pincode: pinMatch[1],
    shipping_landmark: null,
    shipping_phone: null,
  };
}

function parseLabeled(text: string): ParsedShippingAddress | null {
  const get = (keys: string[]) => {
    for (const key of keys) {
      const re = new RegExp(`(?:^|\\n)\\s*${key}\\s*[:\\-]\\s*(.+)`, 'i');
      const m = text.match(re);
      if (m?.[1]?.trim()) return m[1].trim().slice(0, 500);
    }
    return null;
  };

  const address =
    get(['address', 'addr', 'full address', 'delivery address', 'shipping address']) ||
    null;
  const pincodeRaw = get(['pincode', 'pin code', 'pin', 'postal code', 'zip']);
  const pinMatch = (pincodeRaw || text).match(/\b(\d{6})\b/);
  if (!address || !pinMatch) return null;

  return {
    shipping_name: get(['name', 'full name', 'receiver', 'recipient']),
    shipping_address_line: address,
    shipping_city: get(['city', 'town', 'district']),
    shipping_state: get(['state', 'province']),
    shipping_pincode: pinMatch[1],
    shipping_landmark: get(['landmark', 'near', 'nearby']),
    shipping_phone: get(['phone', 'mobile', 'whatsapp', 'alt phone']),
  };
}

export function formatAddressAskMessage(order: {
  orderNumber: string;
  productName: string;
  customerName?: string | null;
}): string {
  const name = order.customerName?.trim() || 'there';
  return [
    `🎉 *Order confirmed*`,
    ``,
    `Hi ${name}, your payment is verified for order *${order.orderNumber}* (*${order.productName}*).`,
    ``,
    `Please reply with your *delivery address* so we can ship your order:`,
    ``,
    `Name:`,
    `Address:`,
    `City:`,
    `State:`,
    `Pincode:`,
    `Phone: (optional)`,
    ``,
    `You can copy this format and fill in the details.`,
  ].join('\n');
}
