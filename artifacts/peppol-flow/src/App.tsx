import { type ReactNode, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AlertTriangle, BarChart3, Bell, Check, ChevronDown, CircleHelp, Languages, LayoutDashboard, LoaderCircle, LogOut, Menu, Search, Settings, ShieldCheck, Users, X, Zap } from 'lucide-react';
import { Link, Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SessionProvider, useSession } from '@/auth/session-context';
import { I18nProvider, useI18n } from '@/i18n/i18n';
import { initials } from '@/lib/initials';
import NotFound from '@/pages/not-found';
import { Dashboard } from '@/pages/dashboard';
import { Login } from '@/pages/login';
import { ClientDetail } from '@/pages/client-detail';
import { Clients } from '@/pages/clients';
import { Placeholder, type PlaceholderPage } from '@/pages/placeholder';
import { Register } from '@/pages/register';

const queryClient = new QueryClient();

const navGroups = [
  { key: 'monitor', items: [
    { key: 'dashboard', href: '/', icon: LayoutDashboard },
    { key: 'clients', href: '/clients', icon: Users },
    { key: 'readiness', href: '/readiness', icon: ShieldCheck },
  ] },
  { key: 'operate', items: [
    { key: 'actions', href: '/actions', icon: Zap },
    { key: 'incidents', href: '/incidents', icon: AlertTriangle },
    { key: 'reports', href: '/reports', icon: BarChart3 },
  ] },
  { key: 'workspace', items: [
    { key: 'users', href: '/users', icon: Users },
    { key: 'settings', href: '/settings', icon: Settings },
  ] },
] as const;

/** A section stays highlighted on its sub-pages, such as a client's detail. */
function isActive(href: string, location: string) {
  return href === '/' ? location === '/' : location === href || location.startsWith(`${href}/`);
}

function Shell({ children }: { children: ReactNode }) {
  const { language, languages, setLanguage, t } = useI18n();
  const { session, signOut, switchOrganization } = useSession();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const current = navGroups.reduce<string | undefined>(
    (match, group) => match ?? group.items.find((item) => isActive(item.href, location))?.key,
    undefined,
  ) ?? 'dashboard';

  if (!session) return null;
  const { organization, user, role, memberships } = session;

  return (
    <div className="flex min-h-[100dvh] bg-[hsl(var(--background))]">
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[252px] flex-col bg-[hsl(var(--sidebar))] px-3.5 py-4 text-[hsl(var(--sidebar-foreground))] transition-transform duration-300 lg:static lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between px-2.5">
          <Link href="/" onClick={() => setMobileOpen(false)} className="flex items-center gap-2.5" data-testid="link-brand">
            <span className="relative flex h-8 w-8 items-center justify-center rounded-[9px] bg-[hsl(var(--sidebar-primary))] text-[hsl(var(--sidebar))] shadow-[0_5px_18px_hsl(221_83%_53%/.25)]"><span className="absolute h-3.5 w-3.5 rounded-full border-[2px] border-[hsl(var(--sidebar))]" /><span className="absolute h-[2px] w-5 rotate-45 bg-[hsl(var(--sidebar))]" /></span>
            <span className="text-[16px] font-bold tracking-[-.035em] text-white">PEPPOL <span className="text-[hsl(var(--sidebar-primary))]">READY</span></span>
          </Link>
          <button aria-label={t('topbar.closeMenu')} onClick={() => setMobileOpen(false)} data-testid="button-close-mobile-menu" className="rounded-md p-1 text-[hsl(var(--sidebar-foreground)/.7)] hover:bg-[hsl(var(--sidebar-accent))] lg:hidden"><X size={17} /></button>
        </div>
        <button onClick={() => setWorkspaceOpen(!workspaceOpen)} aria-expanded={workspaceOpen} data-testid="button-workspace-switcher" className="relative mt-7 flex w-full items-center gap-3 rounded-xl border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-accent)/.72)] p-3 text-left transition-colors hover:bg-[hsl(var(--sidebar-accent))]">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(39_92%_57%)] text-[11px] font-bold text-[hsl(var(--sidebar))]">{initials(organization.name)}</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-white">{organization.name}</span><span className="mt-0.5 block text-[10px] text-[hsl(var(--sidebar-foreground)/.62)]">{t(`plan.${organization.plan}`)}</span></span>
          <ChevronDown size={14} className={`transition-transform ${workspaceOpen ? 'rotate-180' : ''}`} />
        </button>
        {workspaceOpen && (
          <div role="menu" aria-label={t('auth.switchWorkspace')} className="mt-1.5 space-y-0.5 rounded-lg border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar))] p-1.5 shadow-xl">
            {memberships.map((membership) => {
              const active = membership.organizationId === organization.id;
              return (
                <button
                  key={membership.organizationId}
                  role="menuitem"
                  data-testid={`button-switch-${membership.organizationId}`}
                  onClick={() => { setWorkspaceOpen(false); if (!active) void switchOrganization(membership.organizationId); }}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-semibold transition-colors ${active ? 'bg-[hsl(var(--sidebar-accent))] text-white' : 'text-[hsl(var(--sidebar-foreground)/.78)] hover:bg-[hsl(var(--sidebar-accent))] hover:text-white'}`}
                >
                  <span className="min-w-0 flex-1 truncate">{membership.organizationName}<span className="mt-0.5 block text-[10px] font-normal text-[hsl(var(--sidebar-foreground)/.6)]">{t(`roles.${membership.role}`)}</span></span>
                  {active && <Check size={13} className="shrink-0 text-[hsl(var(--sidebar-primary))]" />}
                </button>
              );
            })}
          </div>
        )}
        <nav className="mt-8 flex-1 space-y-6 overflow-y-auto">
          {navGroups.map((group) => <div key={group.key}><p className="mono mb-2 px-3 text-[9px] font-bold uppercase tracking-[.16em] text-[hsl(var(--sidebar-foreground)/.48)]">{t(`nav.${group.key}`)}</p><div className="space-y-1">{group.items.map((item) => { const Icon = item.icon; const active = isActive(item.href, location); return <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} data-testid={`link-nav-${item.key}`} className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-semibold transition-all duration-200 ${active ? 'bg-[hsl(var(--sidebar-primary))] text-white shadow-[0_5px_14px_hsl(221_83%_53%/.18)]' : 'text-[hsl(var(--sidebar-foreground)/.72)] hover:bg-[hsl(var(--sidebar-accent))] hover:text-white'}`}><Icon size={16} strokeWidth={active ? 2.4 : 1.9} /><span>{t(`nav.${item.key}`)}</span></Link>; })}</div></div>)}
        </nav>
        <div className="mt-5 rounded-xl border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-accent)/.65)] p-3.5"><div className="flex items-start gap-2.5"><CircleHelp size={16} className="mt-0.5 shrink-0 text-[hsl(var(--sidebar-primary))]" /><div><p className="text-xs font-bold text-white">{t('workspace.helpTitle')}</p><p className="mt-1 text-[10px] leading-4 text-[hsl(var(--sidebar-foreground)/.62)]">{t('workspace.helpDescription')}</p><button data-testid="button-contact-support" className="mt-2 text-[10px] font-bold text-[hsl(var(--sidebar-primary))] hover:underline">{t('workspace.contactSupport')} <span aria-hidden>→</span></button></div></div></div>
      </aside>
      {mobileOpen && <button aria-label={t('topbar.closeMenu')} data-testid="button-mobile-overlay" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-30 bg-[hsl(222_45%_17%/.48)] lg:hidden" />}
      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-[hsl(var(--border)/.8)] bg-[hsl(0_0%_100%/.94)] px-4 backdrop-blur-md sm:px-7 lg:px-9">
          <div className="flex min-w-0 items-center gap-3">
            <button aria-label={t('topbar.openMenu')} onClick={() => setMobileOpen(true)} data-testid="button-open-mobile-menu" className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] lg:hidden"><Menu size={19} /></button>
            <div className="hidden items-center gap-2 text-xs font-semibold text-[hsl(var(--muted-foreground))] sm:flex"><span>{t('common.workspace')}</span><span className="text-[hsl(var(--border))]">/</span><span className="text-[hsl(var(--foreground))]">{t(`nav.${current}`)}</span></div>
            <label className="hidden h-9 w-[230px] items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-[hsl(var(--muted-foreground))] md:ml-4 md:flex lg:w-[260px]"><Search size={15} /><input data-testid="input-global-search" placeholder={t('topbar.search')} className="w-full bg-transparent text-xs outline-none placeholder:text-[hsl(var(--muted-foreground))]" /></label>
          </div>
          <div className="relative flex items-center gap-1.5 sm:gap-3">
            <label className="flex h-9 items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] bg-white px-2 text-[hsl(var(--muted-foreground))]"><Languages size={15} /><span className="sr-only">{t('topbar.language')}</span><select aria-label={t('topbar.language')} data-testid="select-language" value={language} onChange={(event) => setLanguage(event.target.value)} className="max-w-[86px] bg-transparent text-xs font-semibold outline-none sm:max-w-none">{languages.map((locale) => <option key={locale.code} value={locale.code}>{locale.name}</option>)}</select></label>
            <button aria-label={t('topbar.notifications')} onClick={() => setNotificationsOpen(!notificationsOpen)} data-testid="button-notifications" className="relative rounded-lg p-2 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"><Bell size={17} /><span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))] ring-2 ring-white" /></button>
            {notificationsOpen && <div className="absolute right-[100px] top-11 z-30 w-64 rounded-xl border border-[hsl(var(--border))] bg-white p-3 shadow-xl"><p className="text-xs font-bold">{t('topbar.notifications')}</p><p className="mt-2 rounded-lg bg-[hsl(var(--muted))] p-2.5 text-[11px] leading-4 text-[hsl(var(--muted-foreground))]">{t('topbar.notificationMessage')}</p></div>}
            <span className="hidden h-5 w-px bg-[hsl(var(--border))] sm:block" />
            <button onClick={() => setProfileOpen(!profileOpen)} data-testid="button-profile-menu" className="flex items-center gap-2 rounded-lg p-1.5 transition-colors hover:bg-[hsl(var(--muted))]"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(222_45%_17%)] text-[10px] font-bold text-white">{user.avatarInitials}</span><span className="hidden text-left sm:block"><span className="block text-xs font-bold">{user.name}</span><span className="block text-[10px] text-[hsl(var(--muted-foreground))]">{t(`roles.${role}`)}</span></span><ChevronDown size={13} className={`hidden text-[hsl(var(--muted-foreground))] transition-transform sm:block ${profileOpen ? 'rotate-180' : ''}`} /></button>
            {profileOpen && <div className="absolute right-0 top-12 z-30 w-52 rounded-xl border border-[hsl(var(--border))] bg-white p-2 shadow-xl"><p className="px-2.5 py-2 text-xs font-bold">{user.email}</p><button data-testid="button-profile-settings" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"><Settings size={14} /> {t('topbar.profileSettings')}</button><button onClick={() => { setProfileOpen(false); void signOut(); }} data-testid="button-sign-out" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-[hsl(var(--destructive))] hover:bg-[hsl(4_100%_95%)]"><LogOut size={14} /> {t('topbar.signOut')}</button></div>}
          </div>
        </header>
        <div className="mx-auto w-full max-w-[1560px] px-4 py-7 sm:px-7 lg:px-9 lg:py-9">{children}</div>
      </main>
    </div>
  );
}

function AppLoading() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 bg-[hsl(var(--background))] text-[hsl(var(--muted-foreground))]">
      <LoaderCircle className="animate-spin text-[hsl(var(--primary))]" size={26} />
      <p className="text-sm font-semibold">{t('auth.loading')}</p>
    </div>
  );
}

function Router() {
  const { session, isLoading } = useSession();

  if (isLoading) return <AppLoading />;
  // Signed out: registration has its own path; every other path shows sign-in,
  // so a deep link still lands on a working form.
  if (!session) {
    return <Switch><Route path="/register" component={Register} /><Route component={Login} /></Switch>;
  }

  const placeholderRoutes: Array<{ path: string; page: PlaceholderPage }> = [
    { path: '/readiness', page: 'readiness' },
    { path: '/actions', page: 'actions' }, { path: '/incidents', page: 'incidents' },
    { path: '/reports', page: 'reports' }, { path: '/users', page: 'users' },
    { path: '/settings', page: 'settings' },
  ];
  return <RoutedErrorBoundary><Shell><Switch><Route path="/" component={Dashboard} /><Route path="/clients" component={Clients} /><Route path="/clients/:companyId" component={ClientDetail} /><Route path="/register"><Redirect to="/" replace /></Route>{placeholderRoutes.map(({ path, page }) => <Route key={path} path={path}><Placeholder page={page} /></Route>)}<Route component={NotFound} /></Switch></Shell></RoutedErrorBoundary>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

/**
 * The locale scope follows the session: signed out it stores under an
 * anonymous key so the sign-in screen can still be translated, and once a
 * session arrives it adopts that account's preferred language.
 */
function LocalizedApp() {
  const { session } = useSession();
  return (
    <I18nProvider userId={session?.user.id} preferredLanguage={session?.user.preferredLocale}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter>
        <Toaster />
      </TooltipProvider>
    </I18nProvider>
  );
}

function App() {
  return <QueryClientProvider client={queryClient}><SessionProvider><LocalizedApp /></SessionProvider></QueryClientProvider>;
}

export default App;
