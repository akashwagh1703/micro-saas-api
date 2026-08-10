import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

export type PackingSlipOrder = {
  orderNumber: string;
  productName: string;
  quantity: number;
  amountInr: number | string;
  customerName: string | null;
  customerPhone: string | null;
  shippingName: string | null;
  shippingAddressLine: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingPincode: string | null;
  shippingLandmark: string | null;
  shippingPhone: string | null;
  courierName: string | null;
  trackingNumber: string | null;
  createdAt: Date;
  businessName: string;
};

@Injectable()
export class CatalogPackingSlipService {
  async buildPdf(orders: PackingSlipOrder[]): Promise<Buffer> {
    if (!orders.length) {
      throw new Error('No orders for packing slip');
    }

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      orders.forEach((order, index) => {
        if (index > 0) doc.addPage();
        this.drawSlip(doc, order, index + 1, orders.length);
      });

      doc.end();
    });
  }

  private drawSlip(
    doc: PDFKit.PDFDocument,
    order: PackingSlipOrder,
    pageIndex: number,
    pageCount: number,
  ) {
    const business = order.businessName || 'Business';
    doc.fontSize(18).font('Helvetica-Bold').text(business, { align: 'left' });
    doc.moveDown(0.2);
    doc.fontSize(11).font('Helvetica').fillColor('#444').text('PACKING SLIP / SHIPPING LABEL');
    doc.fillColor('#000');
    doc.moveDown(0.6);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke('#ccc');
    doc.moveDown(0.8);

    doc.fontSize(12).font('Helvetica-Bold').text(`Order ${order.orderNumber}`);
    doc.font('Helvetica').fontSize(10).fillColor('#555');
    doc.text(`Placed: ${formatDate(order.createdAt)}`);
    if (pageCount > 1) doc.text(`Slip ${pageIndex} of ${pageCount}`);
    doc.fillColor('#000');
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(11).text('Ship to');
    doc.font('Helvetica').fontSize(10);
    const shipName = order.shippingName || order.customerName || 'Customer';
    doc.text(shipName);
    if (order.shippingAddressLine) doc.text(order.shippingAddressLine);
    const cityLine = [order.shippingCity, order.shippingState].filter(Boolean).join(', ');
    if (cityLine) doc.text(cityLine);
    if (order.shippingPincode) doc.text(`PIN ${order.shippingPincode}`);
    if (order.shippingLandmark) doc.text(`Landmark: ${order.shippingLandmark}`);
    const phone = order.shippingPhone || order.customerPhone;
    if (phone) doc.text(`Phone: ${phone}`);
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(11).text('Items');
    doc.font('Helvetica').fontSize(10);
    doc.text(`${order.quantity} × ${order.productName}`);
    doc.text(`Amount: ₹${Number(order.amountInr).toLocaleString('en-IN')}`);
    doc.moveDown(0.8);

    if (order.trackingNumber || order.courierName) {
      doc.font('Helvetica-Bold').fontSize(11).text('Courier');
      doc.font('Helvetica').fontSize(10);
      if (order.courierName) doc.text(`Courier: ${order.courierName}`);
      if (order.trackingNumber) doc.text(`Tracking / AWB: ${order.trackingNumber}`);
      doc.moveDown(0.8);
    }

    doc.moveDown(1);
    doc.fontSize(9).fillColor('#666').text('Handle with care · Thank you for your order', {
      align: 'center',
    });
    doc.fillColor('#000');
  }
}

function formatDate(d: Date): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d);
  } catch {
    return d.toISOString();
  }
}
