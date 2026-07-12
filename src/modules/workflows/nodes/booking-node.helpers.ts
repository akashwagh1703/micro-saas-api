import { WorkflowExecution, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { JobDispatcher } from '../../queue/job-dispatcher';

export interface DynamicInteractiveItem {
  optionText: string;
  description?: string;
  displayOrder: number;
  nextNodeId: string;
  metadata?: Record<string, unknown>;
}

/** Digits-only phone — must match inbox contacts and WhatsApp webhook `from`. */
export function normalizeWhatsAppPhone(phone: string | null | undefined): string {
  return (phone ?? '').replace(/\D/g, '');
}

export async function resolveContactPhone(
  prisma: PrismaService,
  execution: WorkflowExecution,
  context: Record<string, any>,
): Promise<string | null> {
  const fromContext = normalizeWhatsAppPhone(context.contact_phone);
  if (fromContext) return fromContext;

  if (execution.contactId) {
    const contact = await prisma.contact.findUnique({ where: { id: execution.contactId } });
    if (contact?.phone) return normalizeWhatsAppPhone(contact.phone);
  }
  return null;
}

const INTERACTIVE_MESSAGE_TYPES = [
  { name: 'QUICK_REPLY', description: 'Up to 3 quick reply buttons', maxOptions: 3 },
  { name: 'LIST_MESSAGE', description: 'Dropdown list with up to 10 options', maxOptions: 10 },
  { name: 'FLOW_BUTTON', description: 'Single action button', maxOptions: 1 },
] as const;

/** Ensures DB has interactive message types (seed may not have run in production). */
export async function ensureInteractiveMessageTypes(prisma: PrismaService): Promise<void> {
  try {
    for (const row of INTERACTIVE_MESSAGE_TYPES) {
      await prisma.interactiveMessageType.upsert({
        where: { name: row.name },
        update: {},
        create: row,
      });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('interactive_message_types') && message.includes('does not exist')) {
      throw new Error(
        'Database missing interactive_message_types table. Run: npx prisma migrate deploy',
      );
    }
    throw error;
  }
}

export async function resolveNextNodeIdFromWorkflow(
  prisma: PrismaService,
  workflowId: number,
  nodeId: string,
): Promise<string | null> {
  const workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });
  const edges = ((workflow?.definition as { edges?: { source?: string; target?: string }[] })?.edges ??
    []) as { source?: string; target?: string }[];
  return edges.find((e) => e.source === nodeId)?.target ?? null;
}

export function substituteContext(template: string, context: Record<string, any>): string {
  let message = template;
  for (const [key, value] of Object.entries(context)) {
    if (key.startsWith('__')) continue;
    message = message.split(`{{${key}}}`).join(String(value ?? ''));
  }
  return message;
}

/** Normalize free-text dates (today, tomorrow, YYYY-MM-DD) to YYYY-MM-DD in local calendar. */
export function normalizePreferredDate(
  raw: unknown,
  referenceDate: Date = new Date(),
): string | null {
  if (raw == null) return null;
  const text = String(raw).trim().toLowerCase();
  if (!text) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const today = startOfLocalDay(referenceDate);
  if (text === 'today') return formatYmd(today);
  if (text === 'tomorrow') return formatYmd(addDays(today, 1));

  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) {
    return formatYmd(new Date(parsed));
  }

  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]) - 1;
    const year = dmy[3] ? Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]) : referenceDate.getFullYear();
    const dt = new Date(year, month, day);
    if (!Number.isNaN(dt.getTime())) return formatYmd(dt);
  }

  return null;
}

export function formatSlotLabel(iso: string, timeZone = 'Asia/Kolkata'): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

export async function createDynamicInteractiveTemplate(
  prisma: PrismaService,
  userId: number,
  params: {
    name: string;
    header?: string;
    body: string;
    footer?: string;
    items: DynamicInteractiveItem[];
    useButtons: boolean;
  },
) {
  await ensureInteractiveMessageTypes(prisma);
  const typeName = params.useButtons && params.items.length <= 3 ? 'QUICK_REPLY' : 'LIST_MESSAGE';
  const messageType = await prisma.interactiveMessageType.findUnique({ where: { name: typeName } });
  if (!messageType) {
    throw new Error(`Interactive message type ${typeName} not found`);
  }

  return prisma.interactiveMessageTemplate.create({
    data: {
      userId,
      name: params.name,
      messageTypeId: messageType.id,
      headerText: params.header ?? null,
      bodyText: params.body,
      footerText: params.footer ?? null,
      options: {
        create: params.items.map((item) => ({
          optionText: item.optionText.slice(0, 20),
          description: item.description?.slice(0, 72) ?? null,
          displayOrder: item.displayOrder,
          nextNodeId: item.nextNodeId,
          metadata: (item.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        })),
      },
    },
    include: { options: { orderBy: { displayOrder: 'asc' } } },
  });
}

export async function enqueueWorkflowText(
  jobs: JobDispatcher,
  execution: WorkflowExecution,
  message: string,
): Promise<void> {
  if (!execution.conversationId) {
    throw new Error('No conversation for outbound message');
  }
  await jobs.enqueueSendMessage({
    userId: execution.userId,
    conversationId: execution.conversationId,
    content: message,
  });
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function formatYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatShortDayLabel(date: Date): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(date);
  } catch {
    return formatYmd(date);
  }
}

export const DEFAULT_BOOKING_CONFIRMED_MESSAGE =
  '✅ *Appointment confirmed!*\n\n*{{business_name}}* has confirmed your booking.\n\nWith: *{{resource_name}}*\nWhen: *{{booking_time}}*\nService: *{{service_type}}*\n\nSee you then!';

export const DEFAULT_BOOKING_CONFIRMED_BUTTON = 'Thank you!';

/** Loads book_slot node data from the workflow that created this booking. */
export async function resolveBookSlotNodeData(
  prisma: PrismaService,
  userId: number,
  workflowExecutionId: number | null | undefined,
): Promise<Record<string, unknown>> {
  if (!workflowExecutionId) return {};

  const execution = await prisma.workflowExecution.findFirst({
    where: { id: workflowExecutionId, userId },
    select: { workflowId: true },
  });
  if (!execution) return {};

  const workflow = await prisma.workflow.findFirst({
    where: { id: execution.workflowId, userId },
    select: { definition: true },
  });

  const nodes =
    (workflow?.definition as { nodes?: { type?: string; data?: Record<string, unknown> }[] })
      ?.nodes ?? [];
  const bookSlot = nodes.find((n) => n.type === 'book_slot');
  return (bookSlot?.data ?? {}) as Record<string, unknown>;
}

export function buildBookingMessageContext(params: {
  businessName: string;
  contactName?: string | null;
  resourceName?: string | null;
  serviceType?: string | null;
  bookingTime: string;
  preferredDate?: string;
  bookingId?: number;
}): Record<string, string> {
  return {
    business_name: params.businessName,
    contact_name: params.contactName?.trim() || 'there',
    resource_name: params.resourceName ?? '',
    service_type: params.serviceType ?? '',
    booking_time: params.bookingTime,
    preferred_date: params.preferredDate ?? '',
    booking_id: String(params.bookingId ?? ''),
  };
}

/** Today / Tomorrow quick-pick buttons with normalized YYYY-MM-DD values. */
export function buildQuickDatePickItems(nextNodeId: string, field = 'preferred_date'): DynamicInteractiveItem[] {
  const today = startOfLocalDay(new Date());
  const tomorrow = addDays(today, 1);

  return [
    {
      optionText: 'Today',
      description: formatShortDayLabel(today),
      displayOrder: 0,
      nextNodeId,
      metadata: {
        preferred_date: formatYmd(today),
        context_field: field,
        context_value: formatYmd(today),
      },
    },
    {
      optionText: 'Tomorrow',
      description: formatShortDayLabel(tomorrow),
      displayOrder: 1,
      nextNodeId,
      metadata: {
        preferred_date: formatYmd(tomorrow),
        context_field: field,
        context_value: formatYmd(tomorrow),
      },
    },
  ];
}
