import { CHANNEL_INSTAGRAM, CHANNEL_WHATSAPP } from '../../common/channels';

export interface AnalyticsDayPoint {
  date: string;
  whatsapp_inbound: number;
  instagram_inbound: number;
  whatsapp_outbound: number;
  instagram_outbound: number;
  whatsapp_leads: number;
  instagram_leads: number;
}

export interface ChannelAnalyticsResult {
  days: number;
  series: AnalyticsDayPoint[];
  totals: {
    whatsapp_inbound: number;
    instagram_inbound: number;
    whatsapp_outbound: number;
    instagram_outbound: number;
    whatsapp_leads: number;
    instagram_leads: number;
  };
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function resolveAnalyticsDays(raw: string | undefined): number {
  const parsed = parseInt(raw ?? '7', 10);
  if (Number.isNaN(parsed)) {
    return 7;
  }
  return Math.min(30, Math.max(1, parsed));
}

export function buildAnalyticsDateRange(days: number): Array<{ start: Date; end: Date; date: string }> {
  const today = startOfDay(new Date());
  const ranges: Array<{ start: Date; end: Date; date: string }> = [];

  for (let i = days - 1; i >= 0; i--) {
    const start = new Date(today);
    start.setDate(start.getDate() - i);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    ranges.push({ start, end, date: start.toISOString().slice(0, 10) });
  }

  return ranges;
}

export async function buildChannelAnalytics(
  prisma: {
    message: {
      count: (args: { where: Record<string, unknown> }) => Promise<number>;
    };
    lead: {
      count: (args: { where: Record<string, unknown> }) => Promise<number>;
    };
  },
  userId: number,
  days: number,
): Promise<ChannelAnalyticsResult> {
  const ranges = buildAnalyticsDateRange(days);
  const series: AnalyticsDayPoint[] = [];

  for (const range of ranges) {
    const window = { gte: range.start, lt: range.end };
    const [
      whatsappInbound,
      instagramInbound,
      whatsappOutbound,
      instagramOutbound,
      whatsappLeads,
      instagramLeads,
    ] = await Promise.all([
      prisma.message.count({
        where: {
          userId,
          channel: CHANNEL_WHATSAPP,
          direction: 'incoming',
          createdAt: window,
        },
      }),
      prisma.message.count({
        where: {
          userId,
          channel: CHANNEL_INSTAGRAM,
          direction: 'incoming',
          createdAt: window,
        },
      }),
      prisma.message.count({
        where: {
          userId,
          channel: CHANNEL_WHATSAPP,
          direction: 'outgoing',
          createdAt: window,
        },
      }),
      prisma.message.count({
        where: {
          userId,
          channel: CHANNEL_INSTAGRAM,
          direction: 'outgoing',
          createdAt: window,
        },
      }),
      prisma.lead.count({
        where: { userId, channel: CHANNEL_WHATSAPP, createdAt: window },
      }),
      prisma.lead.count({
        where: { userId, channel: CHANNEL_INSTAGRAM, createdAt: window },
      }),
    ]);

    series.push({
      date: range.date,
      whatsapp_inbound: whatsappInbound,
      instagram_inbound: instagramInbound,
      whatsapp_outbound: whatsappOutbound,
      instagram_outbound: instagramOutbound,
      whatsapp_leads: whatsappLeads,
      instagram_leads: instagramLeads,
    });
  }

  const totals = series.reduce(
    (acc, day) => ({
      whatsapp_inbound: acc.whatsapp_inbound + day.whatsapp_inbound,
      instagram_inbound: acc.instagram_inbound + day.instagram_inbound,
      whatsapp_outbound: acc.whatsapp_outbound + day.whatsapp_outbound,
      instagram_outbound: acc.instagram_outbound + day.instagram_outbound,
      whatsapp_leads: acc.whatsapp_leads + day.whatsapp_leads,
      instagram_leads: acc.instagram_leads + day.instagram_leads,
    }),
    {
      whatsapp_inbound: 0,
      instagram_inbound: 0,
      whatsapp_outbound: 0,
      instagram_outbound: 0,
      whatsapp_leads: 0,
      instagram_leads: 0,
    },
  );

  return { days, series, totals };
}
