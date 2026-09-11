import { useState, type FormEvent } from 'react';
import { CircleAlert, Languages, LoaderCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, getGetSessionQueryKey, useLogin } from '@workspace/api-client-react';
import { Button } from '@/components/peppol-ui';
import { useI18n } from '@/i18n/i18n';

export function Login() {
  const { language, languages, setLanguage, t } = useI18n();
  const queryClient = useQueryClient();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      const session = await login.mutateAsync({ data: { email, password } });
      queryClient.setQueryData(getGetSessionQueryKey(), session);
    } catch (cause) {
      // 401 is the expected answer for bad credentials; anything else is a fault.
      setError(
        cause instanceof ApiError && cause.status === 401
          ? t('auth.invalidCredentials')
          : t('auth.unexpectedError'),
      );
    }
  }

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
            id="login-language"
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
            {t('auth.eyebrow')}
          </p>
          <h1 className="mt-2 text-[28px] font-bold tracking-[-.045em]">{t('auth.title')}</h1>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{t('auth.subtitle')}</p>

          <form onSubmit={onSubmit} className="card-surface mt-6 rounded-xl p-5">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="login-email" className="block text-xs font-bold">{t('auth.email')}</label>
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  data-testid="input-email"
                  className="h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-white px-3 text-sm outline-none transition-colors focus-visible:border-[hsl(var(--primary))] focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="login-password" className="block text-xs font-bold">{t('auth.password')}</label>
                <input
                  id="login-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  data-testid="input-password"
                  className="h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-white px-3 text-sm outline-none transition-colors focus-visible:border-[hsl(var(--primary))] focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                />
              </div>
            </div>

            {error && (
              <p
                role="alert"
                data-testid="text-login-error"
                className="mt-4 flex items-start gap-2 rounded-lg bg-[hsl(4_100%_95%)] p-2.5 text-[11px] font-semibold leading-4 text-[hsl(3_69%_45%)]"
              >
                <CircleAlert size={14} className="mt-px shrink-0" />
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={login.isPending}
              data-testid="button-sign-in"
              className="mt-5 w-full"
            >
              {login.isPending && <LoaderCircle size={15} className="animate-spin" />}
              {t(login.isPending ? 'auth.signingIn' : 'auth.signIn')}
            </Button>
          </form>

          <p className="mt-4 text-center text-[11px] text-[hsl(var(--muted-foreground))]">{t('auth.help')}</p>
        </div>
      </main>
    </div>
  );
}
