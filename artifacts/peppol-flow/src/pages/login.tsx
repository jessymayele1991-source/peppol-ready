import { useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { ApiError, getGetSessionQueryKey, useLogin } from '@workspace/api-client-react';
import { AuthError, AuthField, AuthLayout } from '@/components/auth-layout';
import { Button } from '@/components/peppol-ui';
import { useI18n } from '@/i18n/i18n';

export function Login() {
  const { t } = useI18n();
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
    <AuthLayout
      eyebrow={t('auth.eyebrow')}
      title={t('auth.title')}
      subtitle={t('auth.subtitle')}
      footer={
        <>
          <p className="mt-4 text-center text-xs text-[hsl(var(--muted-foreground))]">
            {t('auth.noAccount')}{' '}
            <Link href="/register" data-testid="link-register" className="font-bold text-[hsl(var(--primary))] hover:underline">
              {t('auth.goToRegister')}
            </Link>
          </p>
          <p className="mt-2 text-center text-[11px] text-[hsl(var(--muted-foreground))]">{t('auth.help')}</p>
        </>
      }
    >
      <form onSubmit={onSubmit} className="card-surface mt-6 rounded-xl p-5">
        <div className="space-y-4">
          <AuthField
            id="login-email"
            label={t('auth.email')}
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            data-testid="input-email"
          />
          <AuthField
            id="login-password"
            label={t('auth.password')}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            data-testid="input-password"
          />
        </div>

        {error && <AuthError message={error} testId="text-login-error" />}

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
    </AuthLayout>
  );
}
