export type MailDriver = 'brevo' | 'smtp' | 'log';

export interface SendMailInput {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

export interface SendMailResult {
  success: boolean;
  /** Present when send was skipped or failed. */
  error?: string;
  driver: MailDriver;
}
