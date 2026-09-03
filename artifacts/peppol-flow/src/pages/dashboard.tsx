import { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, CircleAlert, Search, ShieldCheck, SlidersHorizontal, UsersRound } from 'lucide-react';
import { actions, clients, incidents, readiness, trend } from '@/lib/mock-data';
import { Badge, Button, Card, SelectPill, SeverityIcon, StatCard, ViewAll } from '@/components/peppol-ui';

function Donut() {
  const circumference = 2 * Math.PI * 61;
  const ready = readiness.ready / readiness.total;
  const configuring = readiness.configuring / readiness.total;
  const risk = readiness.atRisk / readiness.total;
  const first = circumference * ready;
  const second = circumference * configuring;
  return (
    <div className="relative h-[190px] w-[190px] shrink-0 animate-draw">
      <svg viewBox="0 0 150 150" className="-rotate-90">
        <circle cx="75" cy="75" r="61" fill="none" stroke="hsl(214 34% 94%)" strokeWidth="14" />
        <circle cx="75" cy="75" r="61" fill="none" stroke="hsl(173 76% 40%)" strokeWidth="14" strokeDasharray={`${first} ${circumference}`} strokeLinecap="butt" />
        <circle cx="75" cy="75" r="61" fill="none" stroke="hsl(39 92% 57%)" strokeWidth="14" strokeDasharray={`${second} ${circumference}`} strokeDashoffset={-first} strokeLinecap="butt" />
        <circle cx="75" cy="75" r="61" fill="none" stroke="hsl(3 73% 54%)" strokeWidth="14" strokeDasharray={`${circumference * risk} ${circumference}`} strokeDashoffset={-(first + second)} strokeLinecap="butt" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="mono text-[31px] font-bold leading-none tracking-[-.08em] text-[hsl(var(--foreground))]">59%</span>
        <span className="mt-2 text-[10px] font-semibold text-[hsl(var(--muted-foreground))]">ready score</span>
      </div>
    </div>
  );
}

function TrendChart() {
  const max = 100;
  const points = trend.map((item, index) => `${index * 20 + 4},${116 - (item.score / max) * 88}`).join(' ');
  return (
    <div className="relative h-[214px] w-full min-w-0">
      <div className="absolute inset-x-0 top-0 flex justify-between text-[10px] text-[hsl(var(--muted-foreground))]"><span>100%</span><span>75%</span><span>50%</span><span>25%</span></div>
      <svg viewBox="0 0 108 132" preserveAspectRatio="none" className="absolute inset-x-0 top-5 h-[153px] w-full overflow-visible">
        {[24, 47, 70, 93, 116].map((y) => <line key={y} x1="4" x2="104" y1={y} y2={y} stroke="hsl(214 26% 89%)" strokeDasharray="1.5 1.5" />)}
        <polygon points={`4,116 ${points} 104,116`} fill="hsl(173 76% 40% / .08)" />
        <polyline points={points} fill="none" stroke="hsl(173 76% 38%)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        {trend.map((item, index) => <circle key={item.month} cx={index * 20 + 4} cy={116 - (item.score / max) * 88} r="2.3" fill="hsl(0 0% 100%)" stroke="hsl(173 76% 38%)" strokeWidth="1.5" />)}
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex justify-between text-[10px] font-semibold text-[hsl(var(--muted-foreground))]">{trend.map((item) => <span key={item.month}>{item.month}</span>)}</div>
    </div>
  );
}

export function Dashboard() {
  const [activeTab, setActiveTab] = useState('All clients');
  const [search, setSearch] = useState('');
  const [range, setRange] = useState('Last 6 months');
  const filteredClients = useMemo(() => clients.filter((client) => client.name.toLowerCase().includes(search.toLowerCase()) && (activeTab === 'All clients' || client.peppolStatus === activeTab)), [activeTab, search]);
  const tabCounts: Record<string, number> = { 'All clients': 369, Ready: 218, Configuring: 89, 'At risk': 35, 'Not registered': 27 };
  return (
    <div className="space-y-6">
      <div className="animate-rise flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--primary))]">Workspace pulse / 30 Jun 2024</p><h1 className="mt-2 text-[28px] font-bold tracking-[-.045em] text-[hsl(var(--foreground))] sm:text-[32px]">Peppol readiness at a glance</h1><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">The operational view of your client network.</p></div>
        <Button variant="secondary" onClick={() => window.print()} data-testid="button-export-report"><ArrowDownRight size={15} /> Export report</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4">
        <StatCard label="Total clients" value="369" note="12 added this month" trend="+3.4%" icon={<UsersRound size={17} />} accent="navy" className="animate-rise delay-1" />
        <StatCard label="Peppol ready" value="218" note="59% of total network" trend="+6.1%" icon={<ShieldCheck size={17} />} accent="teal" className="animate-rise delay-2" />
        <StatCard label="Needs attention" value="89" note="24% of total network" trend="+8.2%" icon={<CircleAlert size={17} />} accent="amber" className="animate-rise delay-3" />
        <StatCard label="High risk" value="35" note="9% of total network" trend="+2.7%" icon={<ArrowUpRight size={17} />} accent="red" className="animate-rise delay-4" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.05fr_1.25fr_.9fr]">
        <Card title="Readiness distribution" eyebrow="Current network" action={<SelectPill>{readiness.label}</SelectPill>} className="animate-rise delay-2">
          <div className="flex flex-col items-center gap-4 px-5 py-6 sm:flex-row sm:justify-between">
            <Donut />
            <div className="w-full space-y-4 sm:max-w-[145px]">
              {[['Ready', readiness.ready, 'hsl(173 76% 40%)'], ['Configuring', readiness.configuring, 'hsl(39 92% 57%)'], ['At risk', readiness.atRisk, 'hsl(3 73% 54%)'], ['Not registered', readiness.notRegistered, 'hsl(214 24% 67%)']].map(([label, count, color]) => <div key={label as string} className="flex items-center justify-between text-xs"><span className="flex items-center gap-2 text-[hsl(var(--muted-foreground))]"><i className="h-2 w-2 rounded-full" style={{ background: color as string }} />{label}</span><strong className="mono text-[hsl(var(--foreground))]">{count}</strong></div>)}
            </div>
          </div>
        </Card>
        <Card title="Readiness trend" eyebrow="Average score" action={<SelectPill onClick={() => setRange(range === 'Last 6 months' ? 'Last 12 months' : 'Last 6 months')}>{range}</SelectPill>} className="animate-rise delay-3">
          <div className="px-5 pb-4 pt-5"><div className="mb-1 flex items-center gap-2"><span className="mono text-[27px] font-bold tracking-[-.06em]">78%</span><span className="flex items-center gap-1 text-xs font-bold text-[hsl(var(--primary))]"><ArrowUpRight size={13} /> 12.4%</span></div><p className="text-xs text-[hsl(var(--muted-foreground))]">up from 65% in January</p><TrendChart /></div>
        </Card>
        <Card title="Action center" eyebrow="Needs your attention" action={<ViewAll onClick={() => setActiveTab('At risk')}>View all</ViewAll>} className="animate-rise delay-4">
          <div className="divide-y divide-[hsl(var(--border)/.7)] px-5">{actions.slice(0, 4).map((action) => <button onClick={() => setActiveTab(action.id === 'act-01' ? 'Not registered' : 'At risk')} data-testid={`button-action-${action.id}`} key={action.id} className="flex w-full items-center gap-3 py-3 text-left transition-transform hover:translate-x-0.5"><SeverityIcon severity={action.severity} size={13} /><span className="min-w-0 flex-1 truncate text-xs font-semibold text-[hsl(var(--foreground))]">{action.title}</span><span className="mono rounded-md bg-[hsl(var(--muted))] px-2 py-1 text-[10px] font-bold text-[hsl(var(--muted-foreground))]">{action.count}</span></button>)}</div>
          <div className="px-5 pb-5 pt-3"><Button className="w-full" onClick={() => setActiveTab('At risk')} data-testid="button-view-actions">Open action queue <ArrowUpRight size={14} /></Button></div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.55fr_.9fr]">
        <Card title="Client overview" eyebrow="369 accounts" action={<Button variant="quiet" onClick={() => setSearch('')} data-testid="button-client-filters"><SlidersHorizontal size={13} /> Filters</Button>} className="animate-rise delay-3">
          <div className="overflow-x-auto">
            <div className="flex min-w-[650px] items-center gap-1 border-b border-[hsl(var(--border)/.7)] px-5 pt-1">{Object.keys(tabCounts).map((tab) => <button key={tab} onClick={() => setActiveTab(tab)} data-testid={`button-tab-${tab.toLowerCase().replaceAll(' ', '-')}`} className={`relative whitespace-nowrap px-2.5 py-3 text-[11px] font-bold transition-colors ${activeTab === tab ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'}`}>{tab} <span className="ml-1 opacity-60">{tabCounts[tab]}</span>{activeTab === tab && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[hsl(var(--primary))]" />}</button>)}</div>
            <div className="flex min-w-[650px] items-center justify-between gap-4 px-5 py-3"><p className="text-xs text-[hsl(var(--muted-foreground))]">Sorted by most recently checked</p><label className="flex h-8 w-[190px] items-center gap-2 rounded-md border border-[hsl(var(--border))] px-2.5 text-[hsl(var(--muted-foreground))]"><Search size={13} /><input value={search} onChange={(event) => setSearch(event.target.value)} data-testid="input-client-search" placeholder="Search clients" className="w-full bg-transparent text-xs outline-none placeholder:text-[hsl(var(--muted-foreground))]" /></label></div>
            <table className="w-full min-w-[650px] text-left"><thead className="bg-[hsl(210_43%_98%)] text-[10px] font-bold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]"><tr><th className="px-5 py-2.5">Client</th><th className="px-3 py-2.5">Package</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Score</th><th className="px-3 py-2.5">Checked</th><th className="px-5 py-2.5 text-right">Action</th></tr></thead><tbody>{filteredClients.slice(0, 5).map((client) => <tr key={client.id} data-testid={`row-client-${client.id}`} className="border-t border-[hsl(var(--border)/.55)] transition-colors hover:bg-[hsl(173_76%_34%/.025)]"><td className="px-5 py-3"><div className="flex items-center gap-2.5"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-[hsl(222_45%_17%)] text-[9px] font-bold text-white">{client.initials}</span><div><p className="text-xs font-bold text-[hsl(var(--foreground))]">{client.name}</p><p className="mt-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">{client.email}</p></div></div></td><td className="px-3 py-3 text-xs font-medium text-[hsl(var(--muted-foreground))]">{client.accountingPackage}</td><td className="px-3 py-3"><Badge status={client.peppolStatus} /></td><td className="px-3 py-3"><div className="flex items-center gap-2"><span className="mono w-8 text-[10px] font-bold">{client.readinessScore}</span><span className="h-1.5 w-14 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><span className={`block h-full rounded-full ${client.readinessScore > 80 ? 'bg-[hsl(var(--primary))]' : client.readinessScore > 50 ? 'bg-[hsl(var(--accent))]' : 'bg-[hsl(var(--destructive))]'}`} style={{ width: `${client.readinessScore}%` }} /></span></div></td><td className="whitespace-nowrap px-3 py-3 text-[11px] text-[hsl(var(--muted-foreground))]">{client.lastChecked}</td><td className="px-5 py-3 text-right"><button onClick={() => setSearch(client.name)} data-testid={`button-client-action-${client.id}`} className="text-[11px] font-bold text-[hsl(var(--primary))] hover:underline">{client.actionLabel}</button></td></tr>)}</tbody></table>
            {filteredClients.length === 0 && <p className="px-5 py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">No clients match that search.</p>}
          </div>
          <div className="flex items-center justify-between border-t border-[hsl(var(--border)/.7)] px-5 py-3 text-[11px] text-[hsl(var(--muted-foreground))]"><span>Showing {Math.min(filteredClients.length, 5)} of {filteredClients.length} clients</span><ViewAll onClick={() => setSearch('')}>Clear search</ViewAll></div>
        </Card>
        <Card title="Recent incidents" eyebrow="Last 24 hours" action={<ViewAll onClick={() => undefined}>View all</ViewAll>} className="animate-rise delay-4">
          <div className="divide-y divide-[hsl(var(--border)/.7)] px-5">{incidents.map((incident) => <button key={incident.id} data-testid={`button-incident-${incident.id}`} className="flex w-full items-center gap-3 py-3 text-left transition-transform hover:translate-x-0.5"><SeverityIcon severity={incident.severity} size={13} /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-[hsl(var(--foreground))]">{incident.title}</span><span className="mt-0.5 block text-[10px] text-[hsl(var(--muted-foreground))]">{incident.clientName}</span></span><span className="whitespace-nowrap text-[10px] text-[hsl(var(--muted-foreground))]">{incident.timestamp}</span></button>)}</div>
          <div className="px-5 pb-5 pt-3"><Button variant="secondary" className="w-full" data-testid="button-view-incidents">Open incident monitor <ArrowUpRight size={14} /></Button></div>
        </Card>
      </div>
    </div>
  );
}