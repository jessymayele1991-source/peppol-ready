import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, CircleAlert, FolderKanban, LoaderCircle, Plus, Search } from 'lucide-react';
import { Link, useSearchParams } from 'wouter';
import {
  CompanyListStatus,
  CompanySort,
  PeppolStatus,
  getListCompaniesQueryKey,
  useListCompanies,
  type ListCompaniesParams,
} from '@workspace/api-client-react';
import { useSession } from '@/auth/session-context';
import { CompanyFormSheet } from '@/components/clients/company-form';
import { Badge, Button, Card, EmptyState, type PeppolStatusCode } from '@/components/peppol-ui';
import { useI18n } from '@/i18n/i18n';
import { initials } from '@/lib/initials';

const PAGE_SIZE = 25;
const SEARCH_DELAY_MS = 300;

function oneOf<T extends string>(allowed: Record<string, T>, value: string | null): T | undefined {
  return value !== null && (Object.values(allowed) as string[]).includes(value) ? (value as T) : undefined;
}

/**
 * The list query lives in the URL, so a filtered view survives a reload and
 * can be shared. Values the API would reject are dropped rather than sent.
 */
function useListQuery() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page'));
  const query: ListCompaniesParams = {
    search: params.get('search')?.slice(0, 100) || undefined,
    status: oneOf(CompanyListStatus, params.get('status')),
    peppolStatus: oneOf(PeppolStatus, params.get('peppolStatus')),
    industry: params.get('industry')?.slice(0, 100) || undefined,
    sort: oneOf(CompanySort, params.get('sort')),
    page: Number.isInteger(page) && page > 1 ? page : undefined,
  };

  const set = (changes: Partial<Record<keyof ListCompaniesParams, string | number | undefined>>) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined || value === '') next.delete(key);
        else next.set(key, String(value));
      }
      // Any change other than paging starts from the first page.
      if (!('page' in changes)) next.delete('page');
      return next;
    }, { replace: true });
  };

  return { query, set };
}

function FilterSelect({ label, value, onChange, children, testId }: {
  label: string; value: string; onChange: (value: string) => void; children: ReactNode; testId: string;
}) {
  return (
    <label className="flex h-9 items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-white px-2.5 text-[hsl(var(--muted-foreground))]">
      <span className="text-[11px] font-semibold">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} data-testid={testId} className="bg-transparent text-xs font-semibold text-[hsl(var(--foreground))] outline-none">
        {children}
      </select>
    </label>
  );
}

export function Clients() {
  const { formatDate, formatNumber, t } = useI18n();
  const { can, session } = useSession();
  const { query, set } = useListQuery();
  const [creating, setCreating] = useState(false);
  const [searchInput, setSearchInput] = useState(query.search ?? '');
  const [industryInput, setIndustryInput] = useState(query.industry ?? '');

  // The URL can change without typing: back, forward, or a shared link.
  useEffect(() => {
    if ((searchInput.trim() || undefined) !== query.search) setSearchInput(query.search ?? '');
  }, [query.search]);
  useEffect(() => {
    if ((industryInput.trim() || undefined) !== query.industry) setIndustryInput(query.industry ?? '');
  }, [query.industry]);

  // Typing updates the URL after a pause, not on every keystroke.
  useEffect(() => {
    const search = searchInput.trim() || undefined;
    const industry = industryInput.trim() || undefined;
    if (search === query.search && industry === query.industry) return;
    const timer = setTimeout(() => set({ search, industry }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchInput, industryInput]);

  const params: ListCompaniesParams = { ...query, pageSize: PAGE_SIZE };
  const { data, isLoading, isError, isFetching, refetch } = useListCompanies(params, {
    query: { queryKey: getListCompaniesQueryKey(params), placeholderData: (previous) => previous },
  });

  const filtered = Boolean(query.search || query.industry || query.peppolStatus || (query.status && query.status !== 'active'));
  const page = data?.page ?? query.page ?? 1;
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const clearFilters = () => {
    setSearchInput('');
    setIndustryInput('');
    set({ search: undefined, industry: undefined, peppolStatus: undefined, status: undefined });
  };

  return (
    <div className="space-y-6">
      <div className="animate-rise flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--primary))]">{t('clients.eyebrow')}{session && <> / {session.organization.name.toLocaleUpperCase()}</>}</p>
          <h1 className="mt-2 text-[28px] font-bold tracking-[-.045em] sm:text-[32px]">{t('clients.title')}</h1>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{t('clients.subtitle')}</p>
        </div>
        {can('clients.write') && <Button onClick={() => setCreating(true)} data-testid="button-create-client"><Plus size={15} /> {t('clients.create')}</Button>}
      </div>

      <Card className="animate-rise delay-1">
        <div className="flex flex-wrap items-center gap-2 border-b border-[hsl(var(--border)/.7)] px-5 py-3">
          <label className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-[hsl(var(--border))] px-3 text-[hsl(var(--muted-foreground))]">
            <Search size={14} />
            <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} maxLength={100} placeholder={t('clients.filters.search')} aria-label={t('clients.filters.search')} data-testid="input-client-search" className="w-full bg-transparent text-xs text-[hsl(var(--foreground))] outline-none" />
          </label>
          <FilterSelect label={t('clients.filters.status')} value={query.status ?? 'active'} onChange={(value) => set({ status: value === 'active' ? undefined : value })} testId="select-client-status">
            {Object.values(CompanyListStatus).map((status) => <option key={status} value={status}>{t(`clients.filters.statusOptions.${status}`)}</option>)}
          </FilterSelect>
          <FilterSelect label={t('clients.filters.peppolStatus')} value={query.peppolStatus ?? ''} onChange={(value) => set({ peppolStatus: value })} testId="select-client-peppol-status">
            <option value="">{t('clients.filters.any')}</option>
            {Object.values(PeppolStatus).map((status) => <option key={status} value={status}>{t(`status.${status}`)}</option>)}
          </FilterSelect>
          <label className="flex h-9 w-[160px] items-center rounded-lg border border-[hsl(var(--border))] px-3">
            <input value={industryInput} onChange={(event) => setIndustryInput(event.target.value)} maxLength={100} placeholder={t('clients.filters.industry')} aria-label={t('clients.filters.industry')} data-testid="input-client-industry" className="w-full bg-transparent text-xs outline-none" />
          </label>
          <FilterSelect label={t('clients.filters.sort')} value={query.sort ?? 'name'} onChange={(value) => set({ sort: value === 'name' ? undefined : value })} testId="select-client-sort">
            {Object.values(CompanySort).map((sort) => <option key={sort} value={sort}>{t(`clients.sort.${sort}`)}</option>)}
          </FilterSelect>
          {isFetching && !isLoading && <LoaderCircle size={15} className="animate-spin text-[hsl(var(--primary))]" aria-label={t('common.loading')} />}
        </div>

        {isLoading ? (
          <div className="flex min-h-[320px] items-center justify-center"><LoaderCircle className="animate-spin text-[hsl(var(--primary))]" size={26} /></div>
        ) : isError || !data ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-center">
            <CircleAlert className="text-[hsl(var(--destructive))]" size={28} />
            <p className="text-sm font-semibold text-[hsl(var(--muted-foreground))]">{t('clients.loadError')}</p>
            <Button onClick={() => void refetch()}>{t('common.retry')}</Button>
          </div>
        ) : data.total === 0 && !filtered ? (
          <EmptyState
            icon={<FolderKanban size={25} />}
            title={t('clients.empty.title')}
            description={t(can('clients.write') ? 'clients.empty.description' : 'clients.empty.readOnly')}
            action={can('clients.write') ? <Button onClick={() => setCreating(true)} data-testid="button-create-first-client"><Plus size={15} /> {t('clients.create')}</Button> : undefined}
          />
        ) : data.items.length === 0 ? (
          <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-[hsl(var(--muted-foreground))]">{t('clients.empty.filtered')}</p>
            <Button variant="secondary" onClick={clearFilters} data-testid="button-clear-client-filters">{t('clients.filters.clear')}</Button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left">
                <thead className="bg-[hsl(210_43%_98%)] text-[10px] font-bold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">
                  <tr>
                    <th className="px-5 py-2.5">{t('clients.table.client')}</th>
                    <th className="px-3 py-2.5">{t('clients.table.vatNumber')}</th>
                    <th className="px-3 py-2.5">{t('clients.table.status')}</th>
                    <th className="px-3 py-2.5">{t('clients.table.score')}</th>
                    <th className="px-3 py-2.5">{t('clients.table.industry')}</th>
                    <th className="px-5 py-2.5">{t('clients.table.checked')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((company) => (
                    <tr key={company.id} className="border-t border-[hsl(var(--border)/.55)] hover:bg-[hsl(173_76%_34%/.025)]">
                      <td className="px-5 py-3">
                        <Link href={`/clients/${company.id}`} data-testid={`link-client-${company.id}`} className="flex items-center gap-2.5">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[hsl(222_45%_17%)] text-[9px] font-bold text-white">{initials(company.name)}</span>
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-bold hover:text-[hsl(var(--primary))]">{company.name}</span>
                            <span className="mt-0.5 block truncate text-[10px] text-[hsl(var(--muted-foreground))]">{company.email ?? t('common.noBillingContact')}</span>
                          </span>
                          {company.archivedAt && <Badge>{t('clients.archived')}</Badge>}
                        </Link>
                      </td>
                      <td className="mono px-3 py-3 text-[11px] text-[hsl(var(--muted-foreground))]">{company.vatNumber ?? '—'}</td>
                      <td className="px-3 py-3"><Badge status={company.peppolStatus as PeppolStatusCode} /></td>
                      <td className="mono px-3 py-3 text-[11px] font-bold">{formatNumber(company.readinessScore)}</td>
                      <td className="px-3 py-3 text-xs text-[hsl(var(--muted-foreground))]">{company.industry ?? '—'}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-[11px] text-[hsl(var(--muted-foreground))]">{company.lastCheckedAt ? formatDate(company.lastCheckedAt, { day: '2-digit', month: 'short', year: 'numeric' }) : t('clients.neverChecked')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--border)/.7)] px-5 py-3 text-[11px] text-[hsl(var(--muted-foreground))]">
              <span data-testid="text-client-count">{t('clients.pagination.summary', { from: formatNumber((page - 1) * data.pageSize + 1), to: formatNumber((page - 1) * data.pageSize + data.items.length), total: formatNumber(data.total) })}</span>
              <div className="flex items-center gap-2">
                <Button variant="secondary" className="h-8 px-2.5" disabled={page <= 1} onClick={() => set({ page: page - 1 > 1 ? page - 1 : undefined })} aria-label={t('common.previousPage')} data-testid="button-clients-previous"><ChevronLeft size={14} /></Button>
                <span className="mono">{t('clients.pagination.page', { page: formatNumber(page), pages: formatNumber(pageCount) })}</span>
                <Button variant="secondary" className="h-8 px-2.5" disabled={page >= pageCount} onClick={() => set({ page: page + 1 })} aria-label={t('common.nextPage')} data-testid="button-clients-next"><ChevronRight size={14} /></Button>
              </div>
            </div>
          </>
        )}
      </Card>

      {can('clients.write') && <CompanyFormSheet open={creating} onOpenChange={setCreating} />}
    </div>
  );
}
