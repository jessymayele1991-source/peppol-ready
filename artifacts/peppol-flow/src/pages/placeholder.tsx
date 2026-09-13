import { BarChart3, BellRing, ClipboardList, FileBarChart2, Settings2, UsersRound } from 'lucide-react';
import { Button, Card, EmptyState } from '@/components/peppol-ui';
import { useSession } from '@/auth/session-context';
import { useI18n } from '@/i18n/i18n';

export type PlaceholderPage = 'readiness' | 'actions' | 'incidents' | 'reports' | 'users' | 'settings';

const pageIcons: Record<PlaceholderPage, typeof BarChart3> = {
  readiness: BarChart3,
  actions: ClipboardList,
  incidents: BellRing,
  reports: FileBarChart2,
  users: UsersRound,
  settings: Settings2,
};

export function Placeholder({ page }: { page: PlaceholderPage }) {
  const { t } = useI18n();
  const { session } = useSession();
  const Icon = pageIcons[page];
  const key = `placeholder.${page}`;
  return (
    <div className="space-y-6">
      <div className="animate-rise">
        <p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--primary))]">{t(`${key}.eyebrow`)}{session && <> / {session.organization.name.toLocaleUpperCase()}</>}</p>
        <h1 className="mt-2 text-[30px] font-bold tracking-[-.045em]">{t(`${key}.title`)}</h1>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{t('placeholder.tagline')}</p>
      </div>
      <Card className="animate-rise delay-1">
        <EmptyState icon={<Icon size={25} />} title={t(`${key}.title`)} description={t(`${key}.description`)} action={<Button data-testid={`button-${page}-prepare`}>{t('placeholder.prepare')}</Button>} />
      </Card>
    </div>
  );
}