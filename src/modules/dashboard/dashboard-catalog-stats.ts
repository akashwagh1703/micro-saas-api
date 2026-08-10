import { PrismaService } from '../../prisma/prisma.service';

export interface CatalogDashboardStats {
  catalog_site_exists: boolean;
  catalog_payments_configured: boolean;
  catalog_products_total: number;
  catalog_products_active: number;
  catalog_products_in_stock: number;
  catalog_products_out_of_stock: number;
  catalog_orders_pending_payment: number;
  catalog_orders_pending_verification: number;
  catalog_orders_confirmed: number;
  catalog_orders_completed: number;
  catalog_orders_rejected: number;
}

const EMPTY: CatalogDashboardStats = {
  catalog_site_exists: false,
  catalog_payments_configured: false,
  catalog_products_total: 0,
  catalog_products_active: 0,
  catalog_products_in_stock: 0,
  catalog_products_out_of_stock: 0,
  catalog_orders_pending_payment: 0,
  catalog_orders_pending_verification: 0,
  catalog_orders_confirmed: 0,
  catalog_orders_completed: 0,
  catalog_orders_rejected: 0,
};

/**
 * Catalog commerce dashboard counters (Phase 5).
 * Scoped by userId; zeros when the tenant has no CatalogSite.
 */
export async function computeCatalogDashboardStats(
  prisma: PrismaService,
  userId: number,
): Promise<CatalogDashboardStats> {
  const site = await prisma.catalogSite.findUnique({
    where: { userId },
    select: {
      id: true,
      paymentsEnabled: true,
      paymentQrMediaId: true,
    },
  });

  if (!site) return { ...EMPTY };

  const [
    productsTotal,
    productsActive,
    productsInStock,
    productsOutOfStock,
    ordersPendingPayment,
    ordersPendingVerification,
    ordersConfirmed,
    ordersCompleted,
    ordersRejected,
  ] = await prisma.$transaction([
    prisma.catalogProduct.count({ where: { siteId: site.id } }),
    prisma.catalogProduct.count({ where: { siteId: site.id, isActive: true } }),
    prisma.catalogProduct.count({
      where: { siteId: site.id, isActive: true, stockQuantity: { gt: 0 } },
    }),
    prisma.catalogProduct.count({
      where: { siteId: site.id, isActive: true, stockQuantity: { lte: 0 } },
    }),
    prisma.catalogOrder.count({
      where: { userId, orderStatus: 'pending_payment' },
    }),
    prisma.catalogOrder.count({
      where: { userId, orderStatus: 'pending_verification' },
    }),
    prisma.catalogOrder.count({
      where: { userId, orderStatus: 'confirmed' },
    }),
    prisma.catalogOrder.count({
      where: { userId, orderStatus: 'completed' },
    }),
    prisma.catalogOrder.count({
      where: { userId, orderStatus: 'rejected' },
    }),
  ]);

  return {
    catalog_site_exists: true,
    catalog_payments_configured: site.paymentsEnabled === true && site.paymentQrMediaId != null,
    catalog_products_total: productsTotal,
    catalog_products_active: productsActive,
    catalog_products_in_stock: productsInStock,
    catalog_products_out_of_stock: productsOutOfStock,
    catalog_orders_pending_payment: ordersPendingPayment,
    catalog_orders_pending_verification: ordersPendingVerification,
    catalog_orders_confirmed: ordersConfirmed,
    catalog_orders_completed: ordersCompleted,
    catalog_orders_rejected: ordersRejected,
  };
}
