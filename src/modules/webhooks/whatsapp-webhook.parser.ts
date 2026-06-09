/** Maps CareerAI WhatsApp button ids to text commands the bot already understands. */
const CAREER_BUTTON_REPLY_MAP: Record<string, string> = {
  work_remote: 'Remote',
  work_hybrid: 'Hybrid',
  work_onsite: 'Onsite',
  emp_fulltime: 'Full-time',
  emp_parttime: 'Part-time',
  emp_contract: 'Contract',
  int_hr: 'HR Interview',
  int_technical: 'Technical Interview',
  int_behavioral: 'Behavioral Interview',
  apply_1: 'APPLY 1',
  apply_2: 'APPLY 2',
  apply_3: 'APPLY 3',
  resume_1: 'RESUME 1',
  resume_2: 'RESUME 2',
  resume_3: 'RESUME 3',
  cover_1: 'COVER LETTER 1',
  cover_2: 'COVER LETTER 2',
  cover_3: 'COVER LETTER 3',
};

export function mapCareerButtonReply(buttonId: string | undefined): string | null {
  if (!buttonId) {
    return null;
  }
  return CAREER_BUTTON_REPLY_MAP[buttonId] ?? null;
}

/** Extracts display text from inbound WhatsApp Cloud API message objects. */
export function extractWhatsAppInboundText(message: Record<string, unknown>): string | null {
  const type = String(message.type ?? 'text');

  if (type === 'interactive') {
    const interactive = message.interactive as
      | {
          type?: string;
          button_reply?: { id?: string; title?: string };
          list_reply?: { id?: string; title?: string };
        }
      | undefined;

    if (interactive?.type === 'button_reply') {
      const mapped = mapCareerButtonReply(interactive.button_reply?.id);
      if (mapped) {
        return mapped;
      }
      return interactive.button_reply?.title?.trim() || null;
    }

    if (interactive?.type === 'list_reply') {
      const mapped = mapCareerButtonReply(interactive.list_reply?.id);
      if (mapped) {
        return mapped;
      }
      return interactive.list_reply?.title?.trim() || null;
    }

    return null;
  }

  if (type === 'text') {
    const body = (message.text as { body?: string } | undefined)?.body?.trim();
    return body || null;
  }

  if (type === 'image') {
    const caption = (message.image as { caption?: string } | undefined)?.caption?.trim();
    return caption || '[Image]';
  }

  if (type === 'video') {
    const caption = (message.video as { caption?: string } | undefined)?.caption?.trim();
    return caption || '[Video]';
  }

  if (type === 'audio') {
    return '[Voice message]';
  }

  if (type === 'document') {
    const caption = message.document as { caption?: string; filename?: string } | undefined;
    return caption?.caption?.trim() || caption?.filename?.trim() || '[Document]';
  }

  if (type === 'sticker') {
    return '[Sticker]';
  }

  if (type === 'location') {
    return '[Location]';
  }

  return null;
}
