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

export async function resolveContactPhone(
  prisma: PrismaService,
  execution: WorkflowExecution,
  context: Record<string, any>,
): Promise<string | null> {
  const fromContext = context.contact_phone;
  if (fromContext) return String(fromContext);

  if (execution.contactId) {
    const contact = await prisma.contact.findUnique({ where: { id: execution.contactId } });
    if (contact?.phone) return contact.phone;
  }
  return null;
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
  const typeName = params.useButtons ? 'QUICK_REPLY' : 'LIST_MESSAGE';
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

function formatYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
