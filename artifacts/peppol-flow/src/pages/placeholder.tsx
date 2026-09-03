import { BarChart3, BellRing, ClipboardList, FileBarChart2, FolderKanban, Settings2, UsersRound } from 'lucide-react';
import { Button, Card, EmptyState } from '@/components/peppol-ui';

const pageCopy: Record<string, { eyebrow: string; title: string; description: string; icon: typeof FolderKanban }> = {
  Clients: { eyebrow: 'Client directory', title: 'Your client network is ready to connect', description: 'Once client records are imported, this is where your team will search, segment, and inspect every Peppol profile.', icon: FolderKanban },
  Readiness: { eyebrow: 'Readiness intelligence', title: 'A sharper view is coming together', description: 'Readiness analysis will give you the controls to compare client groups, spot drift, and understand what is holding scores back.', icon: BarChart3 },
  Actions: { eyebrow: 'Action queue', title: 'Keep the queue moving', description: 'Prioritised work will appear here as client signals become actionable. Each item will carry its owner, context, and next best step.', icon: ClipboardList },
  Incidents: { eyebrow: 'Incident monitor', title: 'A quieter operational day', description: 'No live incident feed has been connected yet. This space is prepared for delivery failures, validation issues, and expiring certificates.', icon: BellRing },
  Reports: { eyebrow: 'Reporting studio', title: 'Reports, without the spreadsheet sprawl', description: 'Build recurring readiness snapshots for clients and stakeholders. Your first report will appear here when the data connection is enabled.', icon: FileBarChart2 },
  Users: { eyebrow: 'Workspace team', title: 'Bring your operators together', description: 'Invite teammates, assign roles, and make ownership visible across your client network.', icon: UsersRound },
  Settings: { eyebrow: 'Workspace settings', title: 'Make PeppolFlow yours', description: 'Workspace preferences, integrations, notification rules, and access controls will live here.', icon: Settings2 },
};

export function Placeholder({ page }: { page: string }) {
  const copy = pageCopy[page];
  return (
    <div className="space-y-6">
      <div className="animate-rise"><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--primary))]">{copy.eyebrow} / NORTHSTAR</p><h1 className="mt-2 text-[30px] font-bold tracking-[-.045em]">{copy.title}</h1><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">A focused workspace for teams that work with certainty.</p></div>
      <Card className="animate-rise delay-1">
        <EmptyState icon={<copy.icon size={25} />} title={copy.title} description={copy.description} action={<Button data-testid={`button-${page.toLowerCase()}-prepare`}><span>Prepare workspace</span></Button>} />
      </Card>
    </div>
  );
}