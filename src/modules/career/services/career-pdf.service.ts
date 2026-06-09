import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

/**
 * Builds PDF files from plain text (resume sections or cover letter paragraphs).
 */
@Injectable()
export class CareerPdfService {
  async fromText(title: string, body: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const trimmedTitle = title.trim();
      if (trimmedTitle) {
        doc.font('Helvetica-Bold').fontSize(16).text(trimmedTitle);
        doc.moveDown(0.6);
      }

      doc.font('Helvetica').fontSize(11);

      for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) {
          doc.moveDown(0.4);
          continue;
        }

        const sectionHeader =
          /^(contact|professional summary|summary|skills|technical skills|experience|work experience|education|certifications|projects|languages)/i.test(
            trimmed.replace(/[:|]/g, '').trim(),
          ) || (/^[A-Z0-9\s|&/-]{4,}$/.test(trimmed) && trimmed.length < 60);

        if (sectionHeader) {
          doc.moveDown(0.3);
          doc.font('Helvetica-Bold').fontSize(12).text(trimmed.replace(/[:|]/g, '').trim());
          doc.font('Helvetica').fontSize(11);
          continue;
        }

        const bullet = trimmed.replace(/^[-•*]\s+/, '');
        doc.text(bullet, { indent: /^[-•*]\s+/.test(trimmed) ? 12 : 0 });
      }

      doc.end();
    });
  }
}
