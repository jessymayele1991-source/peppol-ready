import { type InputHTMLAttributes, type ReactNode } from 'react';
import { CircleAlert, Languages } from 'lucide-react';
import { useI18n } from '@/i18n/i18n';

/**
 * The frame shared by the signed-out pages: brand, language choice, and a
 * centred card. Sign-in and registration differ only in what goes inside it.
 */
export function AuthLayout({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { language, languages, setLanguage, t } = useI18n();

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[hsl(var(--background))]">
      <header className="flex items-center justify-between px-5 py-5 sm:px-8">
        <span className="flex items-center gap-2.5">
          <span className="relative flex h-8 w-8 items-center justify-center rounded-[9px] bg-[hsl(var(--primary))] text-white shadow-[0_5px_18px_hsl(221_83%_53%/.25)]">
            <span className="absolute h-3.5 w-3.5 rounded-full border-[2px] border-white" />
            <span className="absolute h-[2px] w-5 rotate-45 bg-white" />
          </span>
          <span className="text-[16px] font-bold tracking-[-.035em] text-[hsl(222_45%_17%)]">
            PEPPOL <span className="text-[hsl(var(--primary))]">READY</span>
          </span>
        </span>
        <label className="flex h-9 items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] bg-white px-2 text-[hsl(var(--muted-foreground))]">
          <Languages size={15} />
          <span className="sr-only">{t('topbar.language')}</span>
          <select
            id="auth-language"
            aria-label={t('topbar.language')}
            data-testid="select-language"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            className="bg-transparent text-xs font-semibold outline-none"
          >
            {languages.map((locale) => (
              <option key={locale.code} value={locale.code}>{locale.name}</option>
            ))}
          </select>
        </label>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-[400px]">
          <p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--primary))]">
            {eyebrow}
          </p>
          <h1 className="mt-2 text-[28px] font-bold tracking-[-.045em]">{title}</h1>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{subtitle}</p>
          {children}
          {footer}
        </div>
      </main>
    </div>
  );
}

/** A labelled text input in the signed-out forms' style, also used by the client forms. */
export function AuthField({
  id,
  label,
  hint,
  error,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; hint?: string; error?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-bold">{label}</label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...input}
        className="h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-white px-3 text-sm outline-none transition-colors focus-visible:border-[hsl(var(--primary))] focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
      />
      {hint && <p className="text-[11px] text-[hsl(var(--muted-foreground))]">{hint}</p>}
      {error && <p id={`${id}-error`} className="text-[11px] font-semibold text-[hsl(3_69%_45%)]">{error}</p>}
    </div>
  );
}

/** The error line shown under a signed-out form. */
export function AuthError({ message, testId }: { message: string; testId: string }) {
  return (
    <p
      role="alert"
      data-testid={testId}
      className="mt-4 flex items-start gap-2 rounded-lg bg-[hsl(4_100%_95%)] p-2.5 text-[11px] font-semibold leading-4 text-[hsl(3_69%_45%)]"
    >
      <CircleAlert size={14} className="mt-px shrink-0" />
      {message}
    </p>
  );
}
