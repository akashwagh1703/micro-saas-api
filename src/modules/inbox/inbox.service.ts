import { Injectable, NotFoundException } from '@nestjs/common';
import { Contact, Conversation, Message, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CHANNEL_INSTAGRAM, CHANNEL_WHATSAPP } from '../../common/channels';
import { contactDisplayLabel } from '../../common/contact-display';
import {
  INSTAGRAM_MESSAGING_WINDOW_ERROR,
  isWithinInstagramMessagingWindow,
} from '../../common/instagram-messaging-window';
import { ActivityLogger } from '../../common/activity-logger.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { InstagramService } from '../instagram/instagram.service';
import { WhatsAppApiService, WhatsAppReplyButton } from '../integrations/whatsapp-api.service';
import { InstagramApiService } from '../integrations/instagram-api.service';

export interface SendResult {
  success: boolean;
  message: Message | null;
  error: string | null;
}

type ConversationWithContact = Conversation & { contact: Contact };

@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
    private readonly instagram: InstagramService,
    private readonly whatsAppApi: WhatsAppApiService,
    private readonly instagramApi: InstagramApiService,
    private readonly activity: ActivityLogger,
  ) {}

  async findOrCreateInstagramContact(
    userId: number,
    instagramUserId: string,
    name?: string | null,
    username?: string | null,
  ): Promise<Contact> {
    const scopedId = String(instagramUserId).trim();
    const existing = await this.prisma.contact.findUnique({
      where: { userId_instagramUserId: { userId, instagramUserId: scopedId } },
    });

    if (existing) {
      const updates: { name?: string; username?: string } = {};
      if (name && !existing.name) updates.name = name;
      if (username && !existing.username) updates.username = username;
      if (Object.keys(updates).length > 0) {
        return this.prisma.contact.update({ where: { id: existing.id }, data: updates });
      }
      return existing;
    }

    return this.prisma.contact.create({
      data: {
        userId,
        channel: CHANNEL_INSTAGRAM,
        instagramUserId: scopedId,
        username: username ?? null,
        name: name ?? username ?? null,
        phone: null,
      },
    });
  }

  async findMessageByWaId(userId: number, waMessageId: string): Promise<Message | null> {
    if (!waMessageId) {
      return null;
    }
    return this.prisma.message.findFirst({
      where: { userId, waMessageId },
    });
  }

  async findMessageByExternalId(userId: number, externalMessageId: string): Promise<Message | null> {
    if (!externalMessageId) {
      return null;
    }
    return this.prisma.message.findFirst({
      where: { userId, externalMessageId },
    });
  }

  async findOrCreateContact(userId: number, phone: string, name?: string | null): Promise<Contact> {
    const normalized = (phone ?? '').replace(/\D/g, '');
    const existing = await this.prisma.contact.findUnique({
      where: { userId_phone: { userId, phone: normalized } },
    });
    if (existing) {
      return existing;
    }
    return this.prisma.contact.create({
      data: {
        userId,
        channel: CHANNEL_WHATSAPP,
        phone: normalized,
        name: name ?? normalized,
      },
    });
  }

  async findOrCreateConversation(
    userId: number,
    contact: Contact,
    whatsAppAccountId?: number | null,
    instagramAccountId?: number | null,
  ): Promise<Conversation> {
    const existing = await this.prisma.conversation.findUnique({
      where: { contactId: contact.id },
    });
    if (existing) {
      return existing;
    }
    return this.prisma.conversation.create({
      data: {
        userId,
        contactId: contact.id,
        channel: contact.channel,
        whatsAppAccountId: whatsAppAccountId ?? null,
        instagramAccountId: instagramAccountId ?? null,
        unreadCount: 0,
      },
    });
  }

  /**
   * Persists an inbound message idempotently. Returns `isNew: false` when the
   * provider message id was already stored (e.g. a Meta webhook retry), so the
   * caller can skip re-enqueuing bot/workflow processing.
   */
  async storeIncomingMessage(
    userId: number,
    contact: Contact,
    conversation: Conversation,
    content: string,
    ids?: { waMessageId?: string | null; externalMessageId?: string | null },
    metadata?: Record<string, any> | null,
  ): Promise<{ message: Message; isNew: boolean }> {
    const waMessageId = ids?.waMessageId ?? null;
    const externalMessageId = ids?.externalMessageId ?? null;

    try {
      const message = await this.prisma.$transaction(async (tx) => {
        const created = await tx.message.create({
          data: {
            userId,
            conversationId: conversation.id,
            contactId: contact.id,
            channel: contact.channel,
            direction: 'incoming',
            content,
            waMessageId,
            externalMessageId,
            status: 'received',
            metadata: metadata ?? undefined,
          },
        });

        const now = new Date();
        await tx.contact.update({ where: { id: contact.id }, data: { lastMessageAt: now } });
        await tx.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: now, unreadCount: { increment: 1 } },
        });
        await tx.activity.create({
          data: {
            userId,
            type: 'message_received',
            title: `New message from ${contactDisplayLabel(contact)}`,
            description: content,
          },
        });

        return created;
      });

      return { message, isNew: true };
    } catch (e) {
      // Unique violation on (userId, waMessageId|externalMessageId): a concurrent
      // webhook retry already stored this message. Return the existing row.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = waMessageId
          ? await this.findMessageByWaId(userId, waMessageId)
          : externalMessageId
            ? await this.findMessageByExternalId(userId, externalMessageId)
            : null;
        if (existing) {
          return { message: existing, isNew: false };
        }
      }
      throw e;
    }
  }

  async sendOutgoingMessage(
    userId: number,
    conversationId: number,
    content: string,
    options?: { source?: string },
  ): Promise<SendResult> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { userId, id: conversationId },
      include: { contact: true },
    });
    if (!conversation) {
      throw new NotFoundException();
    }

    if (conversation.channel === CHANNEL_INSTAGRAM) {
      return this.sendInstagramMessage(userId, conversation, content);
    }

    return this.sendWhatsAppMessage(userId, conversation, content, options);
  }

  async sendOutgoingDocument(
    userId: number,
    conversationId: number,
    buffer: Buffer,
    fileName: string,
    mimeType: string,
    caption?: string,
    options?: { source?: string },
  ): Promise<SendResult> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { userId, id: conversationId },
      include: { contact: true },
    });
    if (!conversation) {
      throw new NotFoundException();
    }

    if (conversation.channel !== CHANNEL_WHATSAPP) {
      return {
        success: false,
        message: null,
        error: 'Document messages are only supported on WhatsApp',
      };
    }

    const creds = await this.whatsapp.credentials(userId);
    if (!creds?.account.isConnected) {
      return { success: false, message: null, error: 'WhatsApp not connected' };
    }

    const token = creds.accessToken ?? '';
    const phoneNumberId = creds.phoneNumberId ?? '';

    const upload = await this.whatsAppApi.uploadMedia(
      token,
      phoneNumberId,
      buffer,
      mimeType,
      fileName,
    );
    if (!upload.success || !upload.mediaId) {
      return {
        success: false,
        message: null,
        error: upload.message ?? 'Failed to upload document to WhatsApp',
      };
    }

    const result = await this.whatsAppApi.sendDocumentMessage(
      token,
      phoneNumberId,
      conversation.contact.phone ?? '',
      upload.mediaId,
      fileName,
      caption,
    );

    const label = `[Document: ${fileName}]${caption ? `\n${caption}` : ''}`;
    return this.persistOutgoingMessage(conversation, label, {
      success: result.success,
      waMessageId: result.data?.messages?.[0]?.id ?? null,
      metadata: this.mergeOutgoingMetadata(
        { uploadMediaId: upload.mediaId, fileName, mimeType, api: result.data },
        options?.source,
      ),
      error: result.message ?? null,
    });
  }

  async sendInteractiveButtons(
    userId: number,
    conversationId: number,
    bodyText: string,
    buttons: WhatsAppReplyButton[],
    options?: { source?: string },
  ): Promise<SendResult> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { userId, id: conversationId },
      include: { contact: true },
    });
    if (!conversation) {
      throw new NotFoundException();
    }

    if (conversation.channel !== CHANNEL_WHATSAPP) {
      return this.sendOutgoingMessage(userId, conversationId, bodyText, options);
    }

    const creds = await this.whatsapp.credentials(userId);
    if (!creds?.account.isConnected) {
      return { success: false, message: null, error: 'WhatsApp not connected' };
    }

    const label = [
      bodyText.trim(),
      ...buttons.map((b) => `[${b.title}]`),
    ]
      .filter(Boolean)
      .join('\n');

    const result = await this.whatsAppApi.sendReplyButtons(
      creds.accessToken ?? '',
      creds.phoneNumberId ?? '',
      conversation.contact.phone ?? '',
      bodyText,
      buttons,
    );

    return this.persistOutgoingMessage(conversation, label, {
      success: result.success,
      waMessageId: result.data?.messages?.[0]?.id ?? null,
      metadata: this.mergeOutgoingMetadata(result, options?.source),
      error: result.message ?? null,
    });
  }

  private async sendWhatsAppMessage(
    userId: number,
    conversation: ConversationWithContact,
    content: string,
    options?: { source?: string },
  ): Promise<SendResult> {
    const creds = await this.whatsapp.credentials(userId);
    if (!creds?.account.isConnected) {
      return { success: false, message: null, error: 'WhatsApp not connected' };
    }

    const result = await this.whatsAppApi.sendTextMessage(
      creds.accessToken ?? '',
      creds.phoneNumberId ?? '',
      conversation.contact.phone ?? '',
      content,
    );

    return this.persistOutgoingMessage(conversation, content, {
      success: result.success,
      waMessageId: result.data?.messages?.[0]?.id ?? null,
      metadata: this.mergeOutgoingMetadata(result, options?.source),
      error: result.message ?? null,
    });
  }

  private mergeOutgoingMetadata(apiResult: unknown, source?: string): Record<string, unknown> {
    const base =
      apiResult && typeof apiResult === 'object' ? { ...(apiResult as Record<string, unknown>) } : {};
    if (source) {
      base.source = source;
    }
    return base;
  }

  private async sendInstagramMessage(
    userId: number,
    conversation: ConversationWithContact,
    content: string,
  ): Promise<SendResult> {
    const creds = await this.instagram.credentials(userId);
    if (!creds?.account.isConnected) {
      return { success: false, message: null, error: 'Instagram not connected' };
    }

    const recipientId = conversation.contact.instagramUserId;
    if (!recipientId) {
      return { success: false, message: null, error: 'Contact has no Instagram user id' };
    }

    const lastIncoming = await this.prisma.message.findFirst({
      where: { conversationId: conversation.id, direction: 'incoming' },
      orderBy: { createdAt: 'desc' },
    });

    if (!isWithinInstagramMessagingWindow(lastIncoming?.createdAt)) {
      await this.logIntegrationError(userId, CHANNEL_INSTAGRAM, INSTAGRAM_MESSAGING_WINDOW_ERROR, {
        conversation_id: conversation.id,
        contact_id: conversation.contactId,
      });
      return { success: false, message: null, error: INSTAGRAM_MESSAGING_WINDOW_ERROR };
    }

    const result = await this.instagramApi.sendTextMessage(
      creds.accessToken ?? '',
      creds.account.instagramUserId,
      recipientId,
      content,
    );

    return this.persistOutgoingMessage(conversation, content, {
      success: result.success,
      externalMessageId: result.data?.message_id ?? null,
      metadata: result,
      error: result.message ?? null,
    });
  }

  private async logIntegrationError(
    userId: number,
    channel: string,
    error: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.activity.log(
      userId,
      'integration_error',
      `${channel === CHANNEL_INSTAGRAM ? 'Instagram' : 'WhatsApp'} delivery issue`,
      error,
      { channel, ...(metadata ?? {}) },
    );
  }

  private async persistOutgoingMessage(
    conversation: ConversationWithContact,
    content: string,
    send: {
      success: boolean;
      waMessageId?: string | null;
      externalMessageId?: string | null;
      metadata?: unknown;
      error?: string | null;
    },
  ): Promise<SendResult> {
    const message = await this.prisma.message.create({
      data: {
        userId: conversation.userId,
        conversationId: conversation.id,
        contactId: conversation.contactId,
        channel: conversation.channel,
        direction: 'outgoing',
        content,
        waMessageId: send.waMessageId ?? null,
        externalMessageId: send.externalMessageId ?? null,
        status: send.success ? 'sent' : 'failed',
        metadata: (send.metadata ?? null) as any,
      },
    });

    const now = new Date();
    await this.prisma.contact.update({
      where: { id: conversation.contactId },
      data: { lastMessageAt: now },
    });
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: now },
    });
    await this.prisma.activity.create({
      data: {
        userId: conversation.userId,
        type: 'message_sent',
        title: `Message sent to ${contactDisplayLabel(conversation.contact)}`,
      },
    });

    if (!send.success && send.error) {
      await this.logIntegrationError(
        conversation.userId,
        conversation.channel,
        send.error,
        {
          conversation_id: conversation.id,
          contact_id: conversation.contactId,
          message_id: message.id,
        },
      );
    }

    return {
      success: send.success,
      message,
      error: send.error ?? null,
    };
  }
}
