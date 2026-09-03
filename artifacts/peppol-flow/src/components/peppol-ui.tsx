import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ArrowUpRight, Check, ChevronDown, CircleAlert, Info, LoaderCircle } from 'lucide-react';
import { useI18n } from '@/i18n/i18n';
import { cn } from '@/lib/utils';
import { type Severity } from '@/lib/mock-data';

export type PeppolStatusCode = 'READY' | 'CONFIGURING' | 'AT_RISK' | 'NOT_REGISTERED';

export function Button({
  className,
  variant = 'primary',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'quiet' }) {
  return (
    <button
      className={cn(
        'inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-[hsl(var(--primary))] text-white shadow-[0_3px_0_hsl(173_76%_27%)] hover:-translate-y-px hover:shadow-[0_4px_0_hsl(173_76%_27%)] active:translate-y-px active:shadow-none',
        variant === 'secondary' && 'border border-[hsl(var(--border))] bg-white text-[hsl(var(--foreground))] hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))]',
        variant === 'ghost' && 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]',
        variant === 'quiet' && 'h-8 px-2.5 text-xs text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/.08)]',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Badge({ status, children }: { status?: PeppolStatusCode; children?: ReactNode }) {
  const { t } = useI18n();
  const tone = status === 'READY'
    ? 'bg-[hsl(157_56%_93%)] text-[hsl(159_58%_30%)]'
    : status === 'CONFIGURING'
      ? 'bg-[hsl(43_100%_93%)] text-[hsl(33_77%_37%)]'
      : status === 'AT_RISK'
        ? 'bg-[hsl(4_100%_95%)] text-[hsl(3_69%_45%)]'
        : 'bg-[hsl(214_30%_94%)] text-[hsl(216_16%_45%)]';
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold tracking-[.01em]', tone)}>{children ?? (status ? t(`status.${status}`) : null)}</span>;
}

export function SeverityIcon({ severity, size = 15 }: { severity: Severity; size?: number }) {
  const Icon = severity === 'critical' ? CircleAlert : severity === 'warning' ? Info : Check;
  return <span className={cn('inline-flex h-6 w-6 items-center justify-center rounded-full', severity === 'critical' ? 'bg-[hsl(4_100%_95%)] text-[hsl(var(--destructive))]' : severity === 'warning' ? 'bg-[hsl(43_100%_93%)] text-[hsl(33_77%_37%)]' : 'bg-[hsl(157_56%_93%)] text-[hsl(159_58%_30%)]')}><Icon size={size} strokeWidth={2.2} /></span>;
}

export function Card({ title, eyebrow, action, children, className }: { title?: string; eyebrow?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('card-surface overflow-hidden rounded-xl', className)}>
      {(title || eyebrow || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-[hsl(var(--border)/.65)] px-5 py-4">
          <div>
            {eyebrow && <p className="mono mb-1 text-[9px] font-bold uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))]">{eyebrow}</p>}
            {title && <h2 className="text-sm font-bold tracking-[-.01em] text-[hsl(var(--foreground))]">{title}</h2>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('overflow-x-auto', className)}><table className="w-full text-left">{children}</table></div>;
}

export function StatCard({ label, value, note, trend, icon, accent = 'teal', className }: { label: string; value: string; note: string; trend?: string; icon: ReactNode; accent?: 'teal' | 'amber' | 'red' | 'navy'; className?: string }) {
  const accentStyle = { teal: 'bg-[hsl(157_56%_93%)] text-[hsl(159_58%_30%)]', amber: 'bg-[hsl(43_100%_93%)] text-[hsl(33_77%_37%)]', red: 'bg-[hsl(4_100%_95%)] text-[hsl(3_69%_45%)]', navy: 'bg-[hsl(214_35%_94%)] text-[hsl(218_45%_28%)]' }[accent];
  return (
    <div className={cn('card-surface relative min-h-[138px] rounded-xl p-5 transition-transform duration-200 hover:-translate-y-0.5', className)}>
      <div className="flex items-start justify-between"><p className="text-[11px] font-bold uppercase tracking-[.07em] text-[hsl(var(--muted-foreground))]">{label}</p><span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', accentStyle)}>{icon}</span></div>
      <div className="mt-4 flex items-end gap-2"><span className="mono text-[28px] font-bold leading-none tracking-[-.06em] text-[hsl(var(--foreground))]">{value}</span>{trend && <span className="mb-0.5 text-[11px] font-bold text-[hsl(var(--primary))]">{trend}</span>}</div>
      <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">{note}</p>
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="flex min-h-[400px] flex-col items-center justify-center px-6 py-16 text-center"><div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[hsl(173_76%_34%/.09)] text-[hsl(var(--primary))]">{icon ?? <LoaderCircle size={25} />}</div><h2 className="text-lg font-bold text-[hsl(var(--foreground))]">{title}</h2><p className="mt-2 max-w-sm text-sm leading-6 text-[hsl(var(--muted-foreground))]">{description}</p>{action && <div className="mt-6">{action}</div>}</div>;
}

export function ViewAll({ children, onClick = () => undefined }: { children: ReactNode; onClick?: () => void }) {
  return <button onClick={onClick} data-testid="button-view-all" className="group inline-flex items-center gap-1 text-xs font-bold text-[hsl(var(--primary))] transition-colors hover:text-[hsl(173_76%_25%)]">{children}<ArrowUpRight size={13} className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></button>;
}

export function SelectPill({ children, onClick = () => undefined }: { children: ReactNode; onClick?: () => void }) {
  return <button onClick={onClick} data-testid="button-select-period" className="inline-flex items-center gap-2 rounded-md border border-[hsl(var(--border))] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[hsl(var(--muted-foreground))] transition-colors hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))]">{children}<ChevronDown size={13} /></button>;
}