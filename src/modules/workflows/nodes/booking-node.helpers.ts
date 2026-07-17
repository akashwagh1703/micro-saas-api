import { WorkflowExecution, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { JobDispatcher } from '../../queue/job-dispatcher';
import { filterFutureSlotsForToday, type TimeSlot } from '../../availability/slot-engine';
import { localDateStrInTimeZone } from '../../availability/timezone.util';

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

/** Normalize free-text dates (today, tomorrow, YYYY-MM-DD) to YYYY-MM-DD in tenant or local calendar. */
export function normalizePreferredDate(
  raw: unknown,
  referenceDate: Date = new Date(),
  timeZone?: string,
): string | null {
  if (raw == null) return null;
  const text = String(raw).trim().toLowerCase();
  if (!text) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  if (text === 'today') {
    return timeZone
      ? localDateStrInTimeZone(referenceDate, timeZone)
      : formatYmd(startOfLocalDay(referenceDate));
  }
  if (text === 'tomorrow') {
    const base = timeZone
      ? localDateStrInTimeZone(referenceDate, timeZone)
      : formatYmd(startOfLocalDay(referenceDate));
    const [y, m, d] = base.split('-').map(Number);
    const dt = new Date(y, m - 1, d + 1);
    return formatYmd(dt);
  }

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
export function buildQuickDatePickItems(
  nextNodeId: string,
  field = 'preferred_date',
  timeZone?: string,
): DynamicInteractiveItem[] {
  const now = new Date();
  const todayYmd = timeZone
    ? localDateStrInTimeZone(now, timeZone)
    : formatYmd(startOfLocalDay(now));
  const [y, m, d] = todayYmd.split('-').map(Number);
  const tomorrowDate = new Date(y, m - 1, d + 1);
  const tomorrowYmd = formatYmd(tomorrowDate);
  const today = new Date(y, m - 1, d);
  const tomorrow = tomorrowDate;

  return [
    {
      optionText: 'Today',
      description: formatShortDayLabel(today),
      displayOrder: 0,
      nextNodeId,
      metadata: {
        preferred_date: todayYmd,
        context_field: field,
        context_value: todayYmd,
      },
    },
    {
      optionText: 'Tomorrow',
      description: formatShortDayLabel(tomorrow),
      displayOrder: 1,
      nextNodeId,
      metadata: {
        preferred_date: tomorrowYmd,
        context_field: field,
        context_value: tomorrowYmd,
      },
    },
  ];
}

export type TimePeriod = 'morning' | 'afternoon' | 'evening' | 'night';

export const TIME_PERIOD_LABELS: Record<TimePeriod, string> = {
  morning: 'Morning (6 AM – 12 PM)',
  afternoon: 'Afternoon (12 PM – 5 PM)',
  evening: 'Evening (5 PM – 9 PM)',
  night: 'Night (9 PM – 6 AM)',
};

export function normalizeTimePeriod(raw: unknown): TimePeriod | null {
  const text = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!text) return null;
  if (text.includes('morning') || text === 'morning') return 'morning';
  if (text.includes('afternoon') || text === 'afternoon') return 'afternoon';
  if (text.includes('evening') || text === 'evening') return 'evening';
  if (text.includes('night') || text === 'night') return 'night';
  return null;
}

export function slotHourInTimeZone(iso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date(iso));
  const hourPart = parts.find((p) => p.type === 'hour');
  return Number(hourPart?.value ?? 0);
}

export function slotMatchesTimePeriod(hour: number, period: TimePeriod): boolean {
  switch (period) {
    case 'morning':
      return hour >= 6 && hour < 12;
    case 'afternoon':
      return hour >= 12 && hour < 17;
    case 'evening':
      return hour >= 17 && hour < 21;
    case 'night':
      return hour >= 21 || hour < 6;
    default:
      return true;
  }
}

export function filterSlotsByTimePeriod<T extends { starts_at: string }>(
  slots: T[],
  period: TimePeriod | null,
  timeZone: string,
): T[] {
  if (!period) return slots;
  return slots.filter((slot) =>
    slotMatchesTimePeriod(slotHourInTimeZone(slot.starts_at, timeZone), period),
  );
}

export function periodsWithAvailableSlots<T extends { starts_at: string }>(
  slots: T[],
  timeZone: string,
  exclude?: TimePeriod | null,
): TimePeriod[] {
  const found = new Set<TimePeriod>();
  for (const slot of slots) {
    const hour = slotHourInTimeZone(slot.starts_at, timeZone);
    for (const period of ['morning', 'afternoon', 'evening', 'night'] as TimePeriod[]) {
      if (period === exclude) continue;
      if (slotMatchesTimePeriod(hour, period)) found.add(period);
    }
  }
  return ['morning', 'afternoon', 'evening', 'night'].filter((p) =>
    found.has(p as TimePeriod),
  ) as TimePeriod[];
}

export function currentHourInTimeZone(timeZone: string, now: Date = new Date()): number {
  return slotHourInTimeZone(now.toISOString(), timeZone);
}

/** Hide time-of-day buckets that have already ended when booking for today (tenant clock). */
export function isTimePeriodStillSelectableToday(period: TimePeriod, hourNow: number): boolean {
  switch (period) {
    case 'morning':
      return hourNow < 12;
    case 'afternoon':
      return hourNow < 17;
    case 'evening':
      return hourNow < 21;
    case 'night':
      return hourNow >= 21 || hourNow < 6;
    default:
      return true;
  }
}

export function filterBookableTimePeriods(params: {
  timeZone: string;
  preferredDate: string;
  slots?: { starts_at: string }[];
  exclude?: TimePeriod | null;
  now?: Date;
}): TimePeriod[] {
  const now = params.now ?? new Date();
  const todayStr = localDateStrInTimeZone(now, params.timeZone);
  const isToday = params.preferredDate === todayStr;
  const hourNow = currentHourInTimeZone(params.timeZone, now);

  let candidates: TimePeriod[] =
    params.slots?.length && params.slots.length > 0
      ? periodsWithAvailableSlots(params.slots, params.timeZone, params.exclude)
      : (['morning', 'afternoon', 'evening', 'night'] as TimePeriod[]);

  candidates = candidates.filter((p) => p !== params.exclude);

  if (!isToday) {
    return candidates;
  }

  return candidates.filter((period) => {
    if (!isTimePeriodStillSelectableToday(period, hourNow)) {
      return false;
    }
    if (!params.slots?.length) {
      return true;
    }
    const inPeriod = filterSlotsByTimePeriod(params.slots, period, params.timeZone);
    const future = filterFutureSlotsForToday(
      inPeriod as TimeSlot[],
      params.preferredDate,
      params.timeZone,
      now,
    );
    return future.length > 0;
  });
}

/** Morning / afternoon / evening / night picker before listing individual slots. */
export function buildTimePeriodPickItems(
  nextNodeId: string,
  field = 'time_period',
  periods?: TimePeriod[],
): DynamicInteractiveItem[] {
  const list =
    periods?.length && periods.length > 0
      ? periods
      : (['morning', 'afternoon', 'evening', 'night'] as TimePeriod[]);
  const rows: { value: TimePeriod; text: string; desc: string }[] = list.map((value) => ({
    value,
    text: value.charAt(0).toUpperCase() + value.slice(1),
    desc: TIME_PERIOD_LABELS[value].split('(')[1]?.replace(')', '').trim() ?? '',
  }));
  return rows.map((row, index) => ({
    optionText: row.text,
    description: row.desc,
    displayOrder: index,
    nextNodeId,
    metadata: {
      [field]: row.value,
      time_period: row.value,
      context_field: field,
      context_value: row.value,
    },
  }));
}

export async function workflowHasNodeId(
  prisma: PrismaService,
  workflowId: number,
  nodeId: string,
): Promise<boolean> {
  const workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });
  const nodes = ((workflow?.definition as { nodes?: { id?: string }[] })?.nodes ?? []) as {
    id?: string;
  }[];
  return nodes.some((n) => n.id === nodeId);
}

/** After resource pick, route to pick-time-period when present (even if edges were stale). */
export async function resolveNextNodeAfterResources(
  prisma: PrismaService,
  workflowId: number,
  currentNodeId: string,
): Promise<string | null> {
  if (await workflowHasNodeId(prisma, workflowId, 'pick-time-period')) {
    return 'pick-time-period';
  }
  return resolveNextNodeIdFromWorkflow(prisma, workflowId, currentNodeId);
}

/** After time-of-day pick, route to list-slots when present (even if edges were stale). */
export async function resolveNextNodeAfterTimePeriod(
  prisma: PrismaService,
  workflowId: number,
  currentNodeId: string,
): Promise<string | null> {
  if (await workflowHasNodeId(prisma, workflowId, 'list-slots')) {
    return 'list-slots';
  }
  return resolveNextNodeIdFromWorkflow(prisma, workflowId, currentNodeId);
}

/** Retry menu when no slots match — loops back to date, resource, or time period nodes. */
export function buildBookingRetryItems(params: {
  pickDateNodeId: string | null;
  listResourcesNodeId: string | null;
  pickTimePeriodNodeId: string | null;
  listSlotsNodeId?: string | null;
  alternatePeriods?: TimePeriod[];
}): DynamicInteractiveItem[] {
  const items: DynamicInteractiveItem[] = [];
  let order = 0;
  const slotsNode = params.listSlotsNodeId ?? params.pickTimePeriodNodeId;

  for (const period of params.alternatePeriods ?? []) {
    items.push({
      optionText: period.charAt(0).toUpperCase() + period.slice(1),
      description: TIME_PERIOD_LABELS[period].split('(')[1]?.replace(')', '') ?? '',
      displayOrder: order++,
      nextNodeId: slotsNode ?? params.listResourcesNodeId ?? params.pickDateNodeId ?? '',
      metadata: {
        time_period: period,
        context_field: 'time_period',
        context_value: period,
      },
    });
  }

  if (params.pickTimePeriodNodeId) {
    items.push({
      optionText: 'Other time',
      description: 'Morning / afternoon / evening',
      displayOrder: order++,
      nextNodeId: params.pickTimePeriodNodeId,
      metadata: { retry: 'time_period' },
    });
  }

  if (params.listResourcesNodeId) {
    items.push({
      optionText: 'Other stylist',
      description: 'Try someone else',
      displayOrder: order++,
      nextNodeId: params.listResourcesNodeId,
      metadata: { retry: 'resource' },
    });
  }

  if (params.pickDateNodeId) {
    items.push({
      optionText: 'Another day',
      description: 'Today or tomorrow',
      displayOrder: order++,
      nextNodeId: params.pickDateNodeId,
      metadata: { retry: 'date' },
    });
  }

  return items.filter((item) => item.nextNodeId);
}

export interface BookingFlowNodeIds {
  pickDateNodeId: string;
  listResourcesNodeId: string;
  pickTimePeriodNodeId: string;
  listSlotsNodeId: string;
}

/** Resolve booking node ids from workflow definition (fallback to salon template ids). */
export async function resolveBookingFlowNodeIds(
  prisma: PrismaService,
  workflowId: number,
): Promise<BookingFlowNodeIds> {
  const workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });
  const nodes = ((workflow?.definition as { nodes?: { id?: string; type?: string; data?: Record<string, unknown> }[] })
    ?.nodes ?? []) as { id?: string; type?: string; data?: Record<string, unknown> }[];

  const pickDate =
    nodes.find((n) => n.type === 'pick_options' && n.data?.mode === 'date_quick_pick')?.id ??
    'pick-date';
  const pickTimePeriod =
    nodes.find((n) => n.type === 'pick_options' && n.data?.mode === 'time_period_pick')?.id ??
    'pick-time-period';
  const listResources = nodes.find((n) => n.type === 'list_resources')?.id ?? 'list-resources';
  const listSlots = nodes.find((n) => n.type === 'list_slots')?.id ?? 'list-slots';

  return {
    pickDateNodeId: pickDate,
    listResourcesNodeId: listResources,
    pickTimePeriodNodeId: pickTimePeriod,
    listSlotsNodeId: listSlots,
  };
}

const SLOT_CONTEXT_KEYS = [
  'slot_starts_at',
  'slot_ends_at',
  'selected_slot_starts_at',
] as const;

/** Clear stale booking fields when customer picks a retry menu option. */
export function applyBookingRetryContext(
  context: Record<string, unknown>,
  metadata: Record<string, unknown> | null | undefined,
): void {
  if (!metadata || typeof metadata !== 'object') return;
  const retry = metadata.retry;
  if (retry === 'date') {
    delete context.time_period;
    for (const key of SLOT_CONTEXT_KEYS) delete context[key];
  } else if (retry === 'resource') {
    delete context.time_period;
    delete context.resource_id;
    delete context.selected_resource_id;
    delete context.resource_name;
    for (const key of SLOT_CONTEXT_KEYS) delete context[key];
  } else if (retry === 'time_period') {
    for (const key of SLOT_CONTEXT_KEYS) delete context[key];
  }
}

export async function scheduleWorkflowResume(
  prisma: PrismaService,
  jobs: JobDispatcher,
  executionId: number,
  nextNodeId: string,
  contextPatch: Record<string, unknown> = {},
  clearKeys: string[] = [],
): Promise<void> {
  const execution = await prisma.workflowExecution.findUnique({ where: { id: executionId } });
  if (!execution) return;

  const context: Record<string, unknown> = {
    ...((execution.context as Record<string, unknown>) ?? {}),
    ...contextPatch,
    __resume_at_node_id: nextNodeId,
    __resuming: true,
    __interactive_response_received: true,
  };
  for (const key of clearKeys) {
    delete context[key];
  }
  delete context.__paused_at_node_id;

  await prisma.workflowExecution.update({
    where: { id: executionId },
    data: { status: 'running', context: context as Prisma.InputJsonValue },
  });
  await jobs.enqueueExecuteWorkflow(executionId);
}
