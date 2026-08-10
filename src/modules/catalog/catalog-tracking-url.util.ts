/**
 * Best-effort public tracking URL for common Indian couriers.
 * Owner can still override with tracking_url on ship.
 */
export function buildCourierTrackingUrl(
  courierName: string | null | undefined,
  trackingNumber: string | null | undefined,
): string | null {
  const tracking = String(trackingNumber || '').trim();
  if (!tracking) return null;
  const courier = String(courierName || '').trim().toLowerCase();
  const enc = encodeURIComponent(tracking);

  if (!courier) {
    return `https://www.google.com/search?q=${encodeURIComponent(`track shipment ${tracking}`)}`;
  }
  if (courier.includes('delhivery')) {
    return `https://www.delhivery.com/track/package/${enc}`;
  }
  if (courier.includes('bluedart') || courier.includes('blue dart')) {
    return `https://www.bluedart.com/tracking/${enc}`;
  }
  if (courier.includes('dtdc')) {
    return `https://www.dtdc.in/tracking/tracking_results.asp?Ttype=awb_no&strCnno=${enc}`;
  }
  if (courier.includes('india post') || courier.includes('speed post') || courier.includes('indiapost')) {
    return `https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx`;
  }
  if (courier.includes('shiprocket')) {
    return `https://shiprocket.co/tracking/${enc}`;
  }
  if (courier.includes('ekart') || courier.includes('flipkart')) {
    return `https://www.flipkart.com/support/track-order?trackingId=${enc}`;
  }
  if (courier.includes('ecom') || courier.includes('ecomexpress')) {
    return `https://ecomexpress.in/tracking/?awb_field=${enc}`;
  }
  if (courier.includes('xpressbees') || courier.includes('expressbees')) {
    return `https://www.xpressbees.com/shipment/tracking?awbNo=${enc}`;
  }

  return `https://www.google.com/search?q=${encodeURIComponent(`${courierName} track ${tracking}`)}`;
}
