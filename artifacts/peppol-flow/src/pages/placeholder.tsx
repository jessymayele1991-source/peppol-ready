import { BarChart3, BellRing, ClipboardList, FileBarChart2, FolderKanban, Settings2, UsersRound } from 'lucide-react';
import { Button, Card, EmptyState } from '@/components/peppol-ui';
import { useI18n } from '@/i18n/i18n';

export type PlaceholderPage = 'clients' | 'readiness' | 'actions' | 'incidents' | 'reports' | 'users' | 'settings';

const pageIcons: Record<PlaceholderPage, typeof FolderKanban> = {
  clients: FolderKanban,
  readiness: BarChart3,
  actions: ClipboardList,
  incidents: BellRing,
  reports: FileBarChart2,
  users: UsersRound,
  settings: Settings2,
};

export function Placeholder({ page }: { page: PlaceholderPage }) {
  const { t } = useI18n();
  const Icon = pageIcons[page];
  const key = `placeholder.${page}`;
  return (
    <div className="space-y-6">
      <div className="animate-rise">
        <p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--primary))]">{t(`${key}.eyebrow`)} / NORTHSTAR</p>
        <h1 className="mt-2 text-[30px] font-bold tracking-[-.045em]">{t(`${key}.title`)}</h1>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{t('placeholder.tagline')}</p>
      </div>
      <Card className="animate-rise delay-1">
        <EmptyState icon={<Icon size={25} />} title={t(`${key}.title`)} description={t(`${key}.description`)} action={<Button data-testid={`button-${page}-prepare`}>{t('placeholder.prepare')}</Button>} />
      </Card>
    </div>
  );
}