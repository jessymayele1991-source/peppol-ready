import { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, CircleAlert, LoaderCircle, Search, ShieldCheck, SlidersHorizontal, UsersRound } from 'lucide-react';
import { getGetReadinessDashboardQueryKey, useGetReadinessDashboard, type DashboardCompany } from '@workspace/api-client-react';
import { Badge, Button, Card, SelectPill, SeverityIcon, StatCard, ViewAll, type PeppolStatusCode } from '@/components/peppol-ui';
import { useI18n } from '@/i18n/i18n';
import type { Severity } from '@/lib/mock-data';

const ORGANIZATION_ID = 'org_northstar_accounting';

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

function Donut({ ready, configuring, atRisk, total, averageScore }: {
  ready: number; configuring: number; atRisk: number; total: number; averageScore: number;
}) {
  const { formatNumber, t } = useI18n();
  const circumference = 2 * Math.PI * 61;
  const arc = (count: number) => circumference * (total > 0 ? count / total : 0);
  const first = arc(ready);
  const second = arc(configuring);
  const third = arc(atRisk);
  return (
    <div className="relative h-[190px] w-[190px] shrink-0 animate-draw">
      <svg viewBox="0 0 150 150" className="-rotate-90">
        <circle cx="75" cy="75" r="61" fill="none" stroke="hsl(214 34% 94%)" strokeWidth="14" />
        <circle cx="75" cy="75" r="61" fill="none" stroke="hsl(221 83% 53%)" strokeWidth="14" strokeDasharray={`${first} ${circumference}`} />
        <circle cx="75" cy="75" r="61" fill="none" stroke="hsl(39 92% 57%)" strokeWidth="14" strokeDasharray={`${second} ${circumference}`} strokeDashoffset={-first} />
        <circle cx="75" cy="75" r="61" fill="none" stroke="hsl(3 73% 54%)" strokeWidth="14" strokeDasharray={`${third} ${circumference}`} strokeDashoffset={-(first + second)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="mono text-[31px] font-bold leading-none tracking-[-.08em]">{formatNumber(averageScore)}%</span>
        <span className="mt-2 text-[10px] font-semibold text-[hsl(var(--muted-foreground))]">{t('dashboard.distribution.averageScore')}</span>
      </div>
    </div>
  );
}

function TrendChart({ trend }: { trend: Array<{ period: string; averageScore: number }> }) {
  const { formatDate } = useI18n();
  const pointX = (index: number) => 4 + (index * 100) / Math.max(trend.length - 1, 1);
  const pointY = (score: number) => 116 - (score / 100) * 88;
  const points = trend.map((item, index) => `${pointX(index)},${pointY(item.averageScore)}`).join(' ');
  return (
    <div className="relative h-[214px] w-full min-w-0">
      <div className="absolute inset-x-0 top-0 flex justify-between text-[10px] text-[hsl(var(--muted-foreground))]"><span>100%</span><span>75%</span><span>50%</span><span>25%</span></div>
      <svg viewBox="0 0 108 132" preserveAspectRatio="none" className="absolute inset-x-0 top-5 h-[153px] w-full overflow-visible">
        {[24, 47, 70, 93, 116].map((y) => <line key={y} x1="4" x2="104" y1={y} y2={y} stroke="hsl(214 26% 89%)" strokeDasharray="1.5 1.5" />)}
        {points && <polygon points={`4,116 ${points} 104,116`} fill="hsl(221 83% 53% / .08)" />}
        {points && <polyline points={points} fill="none" stroke="hsl(221 83% 53%)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
        {trend.map((item, index) => <circle key={item.period} cx={pointX(index)} cy={pointY(item.averageScore)} r="2.3" fill="white" stroke="hsl(221 83% 53%)" strokeWidth="1.5" />)}
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex justify-between text-[10px] font-semibold text-[hsl(var(--muted-foreground))]">{trend.map((item) => <span key={item.period}>{formatDate(`${item.period}-01T00:00:00Z`, { month: 'short', timeZone: 'UTC' })}</span>)}</div>
    </div>
  );
}

function DashboardState({ error, onRetry }: { error?: boolean; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <Card>
      <div className="flex min-h-[460px] flex-col items-center justify-center gap-4 px-6 text-center text-[hsl(var(--muted-foreground))]">
        {error ? <CircleAlert className="text-[hsl(var(--destructive))]" size={32} /> : <LoaderCircle className="animate-spin text-[hsl(var(--primary))]" size={28} />}
        <div>{error && <h2 className="font-bold text-[hsl(var(--foreground))]">{t('dashboard.errorTitle')}</h2>}<p className="mt-1 text-sm font-semibold">{t(error ? 'dashboard.errorDescription' : 'dashboard.loading')}</p></div>
        {error && <Button onClick={onRetry}>{t('common.retry')}</Button>}
      </div>
    </Card>
  );
}

export function Dashboard() {
  const { formatDate, formatNumber, t } = useI18n();
  const [activeStatus, setActiveStatus] = useState<PeppolStatusCode | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [showStored, setShowStored] = useState(false);
  const { data, isLoading, isError, refetch } = useGetReadinessDashboard(
    { organizationId: ORGANIZATION_ID },
    { query: { queryKey: getGetReadinessDashboardQueryKey({ organizationId: ORGANIZATION_ID }), staleTime: 30_000, refetchOnWindowFocus: true } },
  );

  const clients = useMemo(() => (data?.companies ?? []).map((company: DashboardCompany) => ({
    ...company,
    initials: initials(company.name),
    actionLabelKey: company.risks.length > 0 ? 'dashboard.clients.reviewRisks' : 'dashboard.clients.view',
  })), [data]);
  const filteredClients = useMemo(() => clients.filter((client) =>
    client.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
    (activeStatus === 'ALL' || client.status === activeStatus),
  ), [activeStatus, clients, search]);

  if (isLoading) return <DashboardState />;
  if (isError || !data) return <DashboardState error onRetry={() => void refetch()} />;

  const total = data.kpis.totalCompanies;
  const percentage = (value: number) => total > 0 ? Math.round((value / total) * 100) : 0;
  const latestTrend = data.trend.at(-1)?.averageScore ?? 0;
  const firstTrend = data.trend[0]?.averageScore ?? latestTrend;
  const trendDelta = latestTrend - firstTrend;
  const tabs: Array<{ status: PeppolStatusCode | 'ALL'; count: number; label: string }> = [
    { status: 'ALL', count: total, label: t('dashboard.clients.all') },
    { status: 'READY', count: data.breakdown.ready, label: t('status.READY') },
    { status: 'CONFIGURING', count: data.breakdown.configuring, label: t('status.CONFIGURING') },
    { status: 'AT_RISK', count: data.breakdown.atRisk, label: t('status.AT_RISK') },
    { status: 'NOT_REGISTERED', count: data.breakdown.notRegistered, label: t('status.NOT_REGISTERED') },
  ];

  return (
    <div className="space-y-6">
      <div className="animate-rise flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--primary))]">{t('dashboard.pulse')} / {formatDate(data.generatedAt, { day: '2-digit', month: 'short' })}</p><h1 className="mt-2 text-[28px] font-bold tracking-[-.045em] sm:text-[32px]">{t('dashboard.title')}</h1><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{t('dashboard.subtitle', { organization: data.organization.name })}</p></div>
        <Button variant="secondary" onClick={() => window.print()} data-testid="button-export-report"><ArrowDownRight size={15} /> {t('dashboard.exportReport')}</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label={t('dashboard.kpi.totalClients')} value={formatNumber(total)} note={t('dashboard.kpi.totalClientsNote')} icon={<UsersRound size={17} />} accent="navy" />
        <StatCard label={t('dashboard.kpi.ready')} value={formatNumber(data.kpis.peppolReady)} note={t('dashboard.kpi.networkShare', { percent: formatNumber(percentage(data.kpis.peppolReady)) })} icon={<ShieldCheck size={17} />} />
        <StatCard label={t('dashboard.kpi.actionRequired')} value={formatNumber(data.kpis.actionRequired)} note={t('dashboard.kpi.actionRequiredNote')} icon={<CircleAlert size={17} />} accent="amber" />
        <StatCard label={t('dashboard.kpi.highRisk')} value={formatNumber(data.kpis.highRisk)} note={t('dashboard.kpi.highRiskNote')} icon={<ArrowUpRight size={17} />} accent="red" />
        <StatCard label={t('dashboard.kpi.notRegistered')} value={formatNumber(data.kpis.notRegistered)} note={t('dashboard.kpi.notRegisteredNote')} icon={<CircleAlert size={17} />} accent="navy" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.05fr_1.25fr_.9fr]">
        <Card title={t('dashboard.distribution.title')} eyebrow={t('dashboard.distribution.eyebrow')} action={<SelectPill>{formatDate(data.generatedAt, { day: '2-digit', month: 'short' })}</SelectPill>}>
          <div className="flex flex-col items-center gap-4 px-5 py-6 sm:flex-row sm:justify-between">
            <Donut ready={data.breakdown.ready} configuring={data.breakdown.configuring} atRisk={data.breakdown.atRisk} total={total} averageScore={data.kpis.averageScore} />
            <div className="w-full space-y-4 sm:max-w-[160px]">{[
              ['READY', data.breakdown.ready, 'hsl(221 83% 53%)'],
              ['CONFIGURING', data.breakdown.configuring, 'hsl(39 92% 57%)'],
              ['AT_RISK', data.breakdown.atRisk, 'hsl(3 73% 54%)'],
              ['NOT_REGISTERED', data.breakdown.notRegistered, 'hsl(214 24% 67%)'],
            ].map(([status, count, color]) => <div key={status as string} className="flex items-center justify-between text-xs"><span className="flex items-center gap-2 text-[hsl(var(--muted-foreground))]"><i className="h-2 w-2 rounded-full" style={{ background: color as string }} />{t(`status.${status}`)}</span><strong className="mono">{formatNumber(count as number)}</strong></div>)}</div>
          </div>
        </Card>
        <Card title={t('dashboard.trend.title')} eyebrow={t('dashboard.trend.eyebrow')} action={<SelectPill onClick={() => setShowStored(!showStored)}>{t(showStored ? 'dashboard.trend.storedAssessments' : 'dashboard.trend.lastSixMonths')}</SelectPill>}>
          <div className="px-5 pb-4 pt-5"><div className="mb-1 flex items-center gap-2"><span className="mono text-[27px] font-bold tracking-[-.06em]">{formatNumber(latestTrend)}%</span><span className="flex items-center gap-1 text-xs font-bold text-[hsl(var(--primary))]"><ArrowUpRight size={13} /> {t('dashboard.trend.points', { value: `${trendDelta >= 0 ? '+' : ''}${formatNumber(trendDelta)}` })}</span></div><p className="text-xs text-[hsl(var(--muted-foreground))]">{t('dashboard.trend.calculatedFrom')}</p><TrendChart trend={data.trend} /></div>
        </Card>
        <Card title={t('dashboard.actions.title')} eyebrow={t('dashboard.actions.eyebrow')} action={<ViewAll onClick={() => setActiveStatus('AT_RISK')}>{t('common.viewAll')}</ViewAll>}>
          <div className="divide-y divide-[hsl(var(--border)/.7)] px-5">{data.actions.slice(0, 5).map((action) => <button onClick={() => setActiveStatus(action.code === 'NOT_REGISTERED' ? 'NOT_REGISTERED' : 'AT_RISK')} key={action.code} className="flex w-full items-center gap-3 py-3 text-left"><SeverityIcon severity={action.severity as Severity} size={13} /><span className="min-w-0 flex-1 truncate text-xs font-semibold">{t(`risk.${action.code}`)}</span><span className="mono rounded-md bg-[hsl(var(--muted))] px-2 py-1 text-[10px] font-bold">{formatNumber(action.count)}</span></button>)}</div>
          <div className="px-5 pb-5 pt-3"><Button className="w-full" onClick={() => setActiveStatus('AT_RISK')}>{t('dashboard.actions.openQueue')} <ArrowUpRight size={14} /></Button></div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.55fr_.9fr]">
        <Card title={t('dashboard.clients.title')} eyebrow={t('dashboard.clients.eyebrow', { count: formatNumber(total) })} action={<Button variant="quiet" onClick={() => setSearch('')}><SlidersHorizontal size={13} /> {t('dashboard.clients.filters')}</Button>}>
          <div className="overflow-x-auto">
            <div className="flex min-w-[680px] items-center gap-1 border-b border-[hsl(var(--border)/.7)] px-5 pt-1">{tabs.map((tab) => <button key={tab.status} onClick={() => setActiveStatus(tab.status)} className={`relative whitespace-nowrap px-2.5 py-3 text-[11px] font-bold ${activeStatus === tab.status ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))]'}`}>{tab.label} <span className="ml-1 opacity-60">{formatNumber(tab.count)}</span>{activeStatus === tab.status && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[hsl(var(--primary))]" />}</button>)}</div>
            <div className="flex min-w-[680px] items-center justify-between gap-4 px-5 py-3"><p className="text-xs text-[hsl(var(--muted-foreground))]">{t('dashboard.clients.sorted')}</p><label className="flex h-8 w-[190px] items-center gap-2 rounded-md border border-[hsl(var(--border))] px-2.5 text-[hsl(var(--muted-foreground))]"><Search size={13} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('dashboard.clients.search')} className="w-full bg-transparent text-xs outline-none" /></label></div>
            <table className="w-full min-w-[680px] text-left"><thead className="bg-[hsl(210_43%_98%)] text-[10px] font-bold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]"><tr><th className="px-5 py-2.5">{t('dashboard.clients.client')}</th><th className="px-3 py-2.5">{t('dashboard.clients.package')}</th><th className="px-3 py-2.5">{t('dashboard.clients.status')}</th><th className="px-3 py-2.5">{t('dashboard.clients.score')}</th><th className="px-3 py-2.5">{t('dashboard.clients.checked')}</th><th className="px-5 py-2.5 text-right">{t('dashboard.clients.action')}</th></tr></thead>
              <tbody>{filteredClients.map((client) => <tr key={client.id} className="border-t border-[hsl(var(--border)/.55)] hover:bg-[hsl(173_76%_34%/.025)]"><td className="px-5 py-3"><div className="flex items-center gap-2.5"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-[hsl(222_45%_17%)] text-[9px] font-bold text-white">{client.initials}</span><div><p className="text-xs font-bold">{client.name}</p><p className="mt-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">{client.email ?? t('common.noBillingContact')}</p></div></div></td><td className="px-3 py-3 text-xs text-[hsl(var(--muted-foreground))]">{client.accountingPackage ?? t('common.notConfigured')}</td><td className="px-3 py-3"><Badge status={client.status as PeppolStatusCode} /></td><td className="px-3 py-3"><div className="flex items-center gap-2"><span className="mono w-8 text-[10px] font-bold">{formatNumber(client.score)}</span><span className="h-1.5 w-14 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><span className={`block h-full rounded-full ${client.score >= 90 ? 'bg-[hsl(var(--primary))]' : client.score >= 60 ? 'bg-[hsl(var(--accent))]' : 'bg-[hsl(var(--destructive))]'}`} style={{ width: `${client.score}%` }} /></span></div></td><td className="whitespace-nowrap px-3 py-3 text-[11px] text-[hsl(var(--muted-foreground))]">{client.lastCheckedAt ? formatDate(client.lastCheckedAt, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : t('common.notConfigured')}</td><td className="px-5 py-3 text-right"><button onClick={() => setSearch(client.name)} className="text-[11px] font-bold text-[hsl(var(--primary))] hover:underline">{t(client.actionLabelKey)}</button></td></tr>)}</tbody>
            </table>
            {filteredClients.length === 0 && <p className="px-5 py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">{t('dashboard.clients.emptySearch')}</p>}
          </div>
          <div className="flex items-center justify-between border-t border-[hsl(var(--border)/.7)] px-5 py-3 text-[11px] text-[hsl(var(--muted-foreground))]"><span>{t('dashboard.clients.showing', { visible: formatNumber(filteredClients.length), total: formatNumber(clients.length) })}</span><ViewAll onClick={() => setSearch('')}>{t('dashboard.clients.clearSearch')}</ViewAll></div>
        </Card>
        <Card title={t('dashboard.incidents.title')} eyebrow={t('dashboard.incidents.eyebrow')} action={<ViewAll>{t('common.viewAll')}</ViewAll>}>
          <div className="divide-y divide-[hsl(var(--border)/.7)] px-5">{data.incidents.map((incident) => <button key={incident.id} className="flex w-full items-center gap-3 py-3 text-left"><SeverityIcon severity={incident.severity as Severity} size={13} /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold">{t(`incident.${incident.id}`)}</span><span className="mt-0.5 block text-[10px] text-[hsl(var(--muted-foreground))]">{incident.companyName ?? t('common.workspaceIncident')}</span></span><span className="whitespace-nowrap text-[10px] text-[hsl(var(--muted-foreground))]">{formatDate(incident.occurredAt, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></button>)}</div>
          <div className="px-5 pb-5 pt-3"><Button variant="secondary" className="w-full">{t('dashboard.incidents.openMonitor')} <ArrowUpRight size={14} /></Button></div>
        </Card>
      </div>
    </div>
  );
}