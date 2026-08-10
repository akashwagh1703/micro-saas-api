import type { WorkflowDefinition } from './workflow-templates';

/**
 * Fingerprint for Phase 4+ catalog commerce graph.
 * Used by upgradeCatalogWorkflowIfNeeded and Phase 6 tests.
 */
export function isCatalogCommerceWorkflowDefinitionCurrent(
  definition: WorkflowDefinition | null | undefined,
): boolean {
  const nodes = definition?.nodes ?? [];
  const nodeIds = nodes.map((n) => n.id);
  const nodeTypes = new Set(nodes.map((n) => n.type));
  const pickMenu = nodes.find((n) => n.id === 'pick-menu');
  const menuOptions = Array.isArray(pickMenu?.data?.options) ? pickMenu.data.options : [];

  const menuHasWebsiteAndCatalog =
    menuOptions.some((o: { value?: string; text?: string }) =>
      /website/i.test(String(o?.value ?? o?.text ?? '')),
    ) &&
    menuOptions.some((o: { value?: string; text?: string }) =>
      /catalog/i.test(String(o?.value ?? o?.text ?? '')),
    );

  const menuHasTopLevelOrder = menuOptions.some((o: { value?: string; text?: string }) => {
    const value = String(o?.value ?? '').trim();
    const text = String(o?.text ?? '').trim();
    return /^order$/i.test(value) || text === 'Order';
  });

  const catalogMenuGoesToCategories = menuOptions.some(
    (o: { value?: string; next_node_id?: string }) =>
      /catalog/i.test(String(o?.value ?? '')) &&
      String(o?.next_node_id ?? '') === 'list-catalog-categories',
  );

  return (
    nodeIds.includes('pick-menu') &&
    nodeIds.includes('list-catalog-categories') &&
    nodeIds.includes('list-catalog-products') &&
    nodeIds.includes('create-catalog-order') &&
    nodeIds.includes('send-payment-qr') &&
    nodeIds.includes('collect-payment-screenshot') &&
    nodeIds.includes('send-payment-received') &&
    nodeTypes.has('list_catalog_categories') &&
    nodeTypes.has('list_catalog_products') &&
    nodeTypes.has('create_catalog_order') &&
    nodeTypes.has('collect_payment_screenshot') &&
    menuHasWebsiteAndCatalog &&
    catalogMenuGoesToCategories &&
    !menuHasTopLevelOrder &&
    !nodeIds.includes('save-lead-order') &&
    !nodeIds.includes('send-image-1')
  );
}

/** Pure stock-claim helper for concurrent confirm races (Phase 6). */
export function canClaimStockDecrement(stockQuantity: number, quantity: number): boolean {
  return Number.isFinite(stockQuantity) && Number.isFinite(quantity) && quantity > 0 && stockQuantity >= quantity;
}
