/**
 * Reproduces Laravel's LengthAwarePaginator JSON shape so the existing React
 * frontend (which reads `res.data.data`, `current_page`, `last_page`, etc.)
 * works without changes.
 */
export interface Paginated<T> {
  current_page: number;
  data: T[];
  first_page_url: string;
  from: number | null;
  last_page: number;
  last_page_url: string;
  links: Array<{ url: string | null; label: string; active: boolean }>;
  next_page_url: string | null;
  path: string;
  per_page: number;
  prev_page_url: string | null;
  to: number | null;
  total: number;
}

/** Simple `{ data, meta }` shape used by website leads and similar endpoints. */
export interface PaginatedMeta {
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface PaginatedMetaResponse<T> {
  data: T[];
  meta: PaginatedMeta;
}

export function paginatedMeta<T>(
  data: T[],
  total: number,
  page: number,
  perPage: number,
): PaginatedMetaResponse<T> {
  return {
    data,
    meta: {
      total,
      page,
      perPage,
      totalPages: total === 0 ? 0 : Math.ceil(total / perPage),
    },
  };
}

export function paginate<TModel, TOut>(
  items: TModel[],
  total: number,
  page: number,
  perPage: number,
  path: string,
  serialize: (item: TModel) => TOut,
): Paginated<TOut> {
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  const from = total === 0 ? null : (page - 1) * perPage + 1;
  const to = total === 0 ? null : from! + items.length - 1;
  const pageUrl = (p: number) => `${path}?page=${p}`;

  const links: Paginated<TOut>['links'] = [
    { url: page > 1 ? pageUrl(page - 1) : null, label: '&laquo; Previous', active: false },
  ];
  for (let p = 1; p <= lastPage; p++) {
    links.push({ url: pageUrl(p), label: String(p), active: p === page });
  }
  links.push({
    url: page < lastPage ? pageUrl(page + 1) : null,
    label: 'Next &raquo;',
    active: false,
  });

  return {
    current_page: page,
    data: items.map(serialize),
    first_page_url: pageUrl(1),
    from,
    last_page: lastPage,
    last_page_url: pageUrl(lastPage),
    links,
    next_page_url: page < lastPage ? pageUrl(page + 1) : null,
    path,
    per_page: perPage,
    prev_page_url: page > 1 ? pageUrl(page - 1) : null,
    to,
    total,
  };
}

/** Parses a `?page=` query value into a positive integer (defaults to 1). */
export function resolvePage(raw: unknown): number {
  const n = parseInt(String(raw ?? '1'), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
