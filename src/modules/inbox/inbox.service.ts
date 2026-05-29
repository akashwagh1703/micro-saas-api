import { Injectable, NotFoundException } from '@nestjs/common';
import { Contact, Conversation, Message } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { WhatsAppApiService } from '../integrations/whatsapp-api.service';

export interface SendResult {
  success: boolean;
  message: Message | null;
  error: string | null;
}

@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
    private readonly api: WhatsAppApiService,
  ) {}

  async findOrCreateContact(userId: number, phone: string, name?: string | null): Promise<Contact> {
    const normalized = (phone ?? '').replace(/\D/g, '');
    const existing = await this.prisma.contact.findUnique({
      where: { userId_phone: { userId, phone: normalized } },
    });
    if (existing) {
      return existing;
    }
    return this.prisma.contact.create({
      data: { userId, phone: normalized, name: name ?? normalized },
    });
  }

  async findOrCreateConversation(
    userId: number,
    contact: Contact,
    whatsAppAccountId?: number | null,
  ): Promise<Conversation> {
    const existing = await this.prisma.conversation.findUnique({
      where: { contactId: contact.id },
    });
    if (existing) {
      return existing;
    }
    return this.prisma.conversation.create({
      data: { userId, contactId: contact.id, whatsAppAccountId: whatsAppAccountId ?? null, unreadCount: 0 },
    });
  }

  async storeIncomingMessage(
    userId: number,
    contact: Contact,
    conversation: Conversation,
    content: string,
    waMessageId?: string | null,
    metadata?: Record<string, any> | null,
  ): Promise<Message> {
    return this.prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          userId,
          conversationId: conversation.id,
          contactId: contact.id,
          direction: 'incoming',
          content,
          waMessageId: waMessageId ?? null,
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
          title: `New message from ${contact.phone}`,
          description: content,
        },
      });

      return message;
    });
  }

  async sendOutgoingMessage(
    userId: number,
    conversationId: number,
    content: string,
  ): Promise<SendResult> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { userId, id: conversationId },
      include: { contact: true },
    });
    if (!conversation) {
      throw new NotFoundException();
    }

    const creds = await this.whatsapp.credentials(userId);
    if (!creds?.account.isConnected) {
      return { success: false, message: null, error: 'WhatsApp not connected' };
    }

    const result = await this.api.sendTextMessage(
      creds.accessToken ?? '',
      creds.phoneNumberId ?? '',
      conversation.contact.phone,
      content,
    );

    const message = await this.prisma.message.create({
      data: {
        userId,
        conversationId: conversation.id,
        contactId: conversation.contactId,
        direction: 'outgoing',
        content,
        waMessageId: result.data?.messages?.[0]?.id ?? null,
        status: result.success ? 'sent' : 'failed',
        metadata: result as any,
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
        userId,
        type: 'message_sent',
        title: `Message sent to ${conversation.contact.phone}`,
      },
    });

    return { success: result.success, message, error: result.message ?? null };
  }
}
