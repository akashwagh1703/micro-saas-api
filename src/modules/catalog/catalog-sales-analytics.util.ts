/** Statuses that count as paid income (payment confirmed / fulfilled). */
export const CATALOG_PAID_ORDER_STATUSES = [
  'confirmed',
  'ready_to_ship',
  'shipped',
  'delivered',
  'completed',
] as const;

export type CatalogSalesOrderRow = {
  orderStatus: string;
  amountInr: number | string;
  productId: number | null;
  productName: string;
  createdAt: Date;
};

export type CatalogSalesAnalyticsResult = {
  days: number;
  from: string;
  to: string;
  summary: {
    orders_total: number;
    orders_paid: number;
    revenue_paid_inr: number;
    revenue_pending_verification_inr: number;
    revenue_awaiting_payment_inr: number;
    avg_order_value_inr: number;
    orders_ready_to_ship: number;
    orders_shipped: number;
    orders_delivered: number;
  };
  previous: {
    orders_paid: number;
    revenue_paid_inr: number;
    revenue_change_pct: number | null;
  };
  by_status: Array<{ status: string; count: number; amount_inr: number }>;
  series: Array<{ date: string; orders: number; revenue_inr: number }>;
  top_products: Array<{
    product_id: number | null;
    product_name: string;
    orders: number;
    revenue_inr: number;
  }>;
};

export function resolveCatalogAnalyticsDays(raw: string | undefined): number {
  const parsed = parseInt(raw ?? '30', 10);
  if (Number.isNaN(parsed)) return 30;
  return Math.min(90, Math.max(1, parsed));
}

function startOfLocalDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dayKey(date: Date): string {
  const d = startOfLocalDay(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function money(value: number | string): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function isPaidStatus(status: string): boolean {
  return (CATALOG_PAID_ORDER_STATUSES as readonly string[]).includes(status);
}

export function buildCatalogDateRange(days: number): {
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
  dates: string[];
} {
  const today = startOfLocalDay(new Date());
  const to = new Date(today);
  to.setDate(to.getDate() + 1);
  const from = new Date(today);
  from.setDate(from.getDate() - (days - 1));
  const prevTo = new Date(from);
  const prevFrom = new Date(from);
  prevFrom.setDate(prevFrom.getDate() - days);

  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    dates.push(dayKey(d));
  }

  return { from, to, prevFrom, prevTo, dates };
}

export function aggregateCatalogSalesAnalytics(
  days: number,
  currentOrders: CatalogSalesOrderRow[],
  previousOrders: CatalogSalesOrderRow[],
): CatalogSalesAnalyticsResult {
  const { from, to, dates } = buildCatalogDateRange(days);

  const byStatusMap = new Map<string, { count: number; amount: number }>();
  const seriesMap = new Map<string, { orders: number; revenue: number }>();
  for (const date of dates) {
    seriesMap.set(date, { orders: 0, revenue: 0 });
  }

  let ordersTotal = 0;
  let ordersPaid = 0;
  let revenuePaid = 0;
  let revenuePending = 0;
  let revenueAwaiting = 0;
  let ready = 0;
  let shipped = 0;
  let delivered = 0;

  const productMap = new Map<
    string,
    { product_id: number | null; product_name: string; orders: number; revenue: number }
  >();

  for (const order of currentOrders) {
    ordersTotal += 1;
    const amount = money(order.amountInr);
    const status = order.orderStatus || 'unknown';
    const bucket = byStatusMap.get(status) || { count: 0, amount: 0 };
    bucket.count += 1;
    bucket.amount += amount;
    byStatusMap.set(status, bucket);

    if (status === 'ready_to_ship') ready += 1;
    if (status === 'shipped') shipped += 1;
    if (status === 'delivered' || status === 'completed') delivered += 1;

    if (status === 'pending_verification') revenuePending += amount;
    else if (status === 'pending_payment') revenueAwaiting += amount;
    else if (isPaidStatus(status)) {
      ordersPaid += 1;
      revenuePaid += amount;
      const key = dayKey(order.createdAt);
      const point = seriesMap.get(key);
      if (point) {
        point.orders += 1;
        point.revenue += amount;
      }
      const pKey = `${order.productId ?? 'x'}:${order.productName}`;
      const prod = productMap.get(pKey) || {
        product_id: order.productId,
        product_name: order.productName,
        orders: 0,
        revenue: 0,
      };
      prod.orders += 1;
      prod.revenue += amount;
      productMap.set(pKey, prod);
    }
  }

  let prevPaidOrders = 0;
  let prevRevenue = 0;
  for (const order of previousOrders) {
    if (!isPaidStatus(order.orderStatus)) continue;
    prevPaidOrders += 1;
    prevRevenue += money(order.amountInr);
  }

  let revenueChangePct: number | null = null;
  if (prevRevenue > 0) {
    revenueChangePct = Math.round(((revenuePaid - prevRevenue) / prevRevenue) * 1000) / 10;
  } else if (revenuePaid > 0) {
    revenueChangePct = 100;
  }

  const avg =
    ordersPaid > 0 ? Math.round((revenuePaid / ordersPaid) * 100) / 100 : 0;

  const byStatus = [...byStatusMap.entries()]
    .map(([status, v]) => ({
      status,
      count: v.count,
      amount_inr: Math.round(v.amount * 100) / 100,
    }))
    .sort((a, b) => b.amount_inr - a.amount_inr || b.count - a.count);

  const series = dates.map((date) => {
    const point = seriesMap.get(date)!;
    return {
      date,
      orders: point.orders,
      revenue_inr: Math.round(point.revenue * 100) / 100,
    };
  });

  const topProducts = [...productMap.values()]
    .map((p) => ({
      product_id: p.product_id,
      product_name: p.product_name,
      orders: p.orders,
      revenue_inr: Math.round(p.revenue * 100) / 100,
    }))
    .sort((a, b) => b.revenue_inr - a.revenue_inr || b.orders - a.orders)
    .slice(0, 8);

  return {
    days,
    from: dayKey(from),
    to: dayKey(new Date(to.getTime() - 1)),
    summary: {
      orders_total: ordersTotal,
      orders_paid: ordersPaid,
      revenue_paid_inr: Math.round(revenuePaid * 100) / 100,
      revenue_pending_verification_inr: Math.round(revenuePending * 100) / 100,
      revenue_awaiting_payment_inr: Math.round(revenueAwaiting * 100) / 100,
      avg_order_value_inr: avg,
      orders_ready_to_ship: ready,
      orders_shipped: shipped,
      orders_delivered: delivered,
    },
    previous: {
      orders_paid: prevPaidOrders,
      revenue_paid_inr: Math.round(prevRevenue * 100) / 100,
      revenue_change_pct: revenueChangePct,
    },
    by_status: byStatus,
    series,
    top_products: topProducts,
  };
}
