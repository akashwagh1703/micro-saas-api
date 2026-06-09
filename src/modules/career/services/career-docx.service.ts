import { Injectable } from '@nestjs/common';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';

/**
 * Builds .docx files from AI-generated plain text (resume sections or cover letter paragraphs).
 */
@Injectable()
export class CareerDocxService {
  async resumeFromText(title: string, body: string): Promise<Buffer> {
    const lines = body.replace(/\r\n/g, '\n').split('\n');
    const children: Paragraph[] = [];

    if (title.trim()) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: title.trim(), bold: true, size: 32 })],
          spacing: { after: 240 },
        }),
      );
    }

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        children.push(new Paragraph({ spacing: { after: 120 } }));
        continue;
      }

      const sectionHeader =
        /^(contact|professional summary|summary|skills|technical skills|experience|work experience|education|certifications|projects|languages)/i.test(
          trimmed.replace(/[:|]/g, '').trim(),
        ) || (/^[A-Z0-9\s|&/-]{4,}$/.test(trimmed) && trimmed.length < 60);

      if (sectionHeader) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: trimmed.replace(/[:|]/g, '').trim(),
                bold: true,
                size: 26,
              }),
            ],
            spacing: { before: 200, after: 120 },
          }),
        );
        continue;
      }

      if (/^[-•*]\s+/.test(trimmed)) {
        children.push(
          new Paragraph({
            text: trimmed.replace(/^[-•*]\s+/, ''),
            bullet: { level: 0 },
          }),
        );
        continue;
      }

      children.push(
        new Paragraph({
          children: [new TextRun({ text: trimmed, size: 22 })],
          spacing: { after: 100 },
        }),
      );
    }

    return this.pack(children);
  }

  async coverLetterFromText(title: string, body: string): Promise<Buffer> {
    const paragraphs = body
      .replace(/\r\n/g, '\n')
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter(Boolean);

    const children: Paragraph[] = [
      new Paragraph({
        children: [new TextRun({ text: title, bold: true, size: 28 })],
        spacing: { after: 240 },
      }),
    ];

    for (const para of paragraphs) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: para, size: 22 })],
          spacing: { after: 200 },
        }),
      );
    }

    return this.pack(children);
  }

  private async pack(children: Paragraph[]): Promise<Buffer> {
    const doc = new Document({
      sections: [{ properties: {}, children }],
    });
    return Packer.toBuffer(doc);
  }
}
