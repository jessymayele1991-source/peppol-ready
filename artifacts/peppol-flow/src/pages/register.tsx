import { useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { ApiError, getGetSessionQueryKey, useRegister } from '@workspace/api-client-react';
import { AuthError, AuthField, AuthLayout } from '@/components/auth-layout';
import { Button } from '@/components/peppol-ui';
import { rememberLanguageFor, useI18n } from '@/i18n/i18n';

/** Matches the API contract's RegisterInput. */
export const MIN_PASSWORD_LENGTH = 12;

function errorKeyFor(cause: unknown): string {
  if (!(cause instanceof ApiError)) return 'register.errors.unexpected';
  if (cause.status === 409) return 'register.errors.emailInUse';
  if (cause.status === 429) return 'register.errors.tooManyAttempts';
  if (cause.status === 400) return 'register.errors.invalid';
  return 'register.errors.unexpected';
}

export function Register() {
  const { language, t } = useI18n();
  const queryClient = useQueryClient();
  const register = useRegister();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // Checked here only: the confirmation guards against a typo and never
    // leaves the browser.
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('register.errors.passwordTooShort', { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('register.errors.passwordMismatch'));
      return;
    }

    try {
      const session = await register.mutateAsync({ data: { name, email, password } });
      // Keep the language the visitor registered in once the session takes over.
      rememberLanguageFor(session.user.id, language);
      queryClient.setQueryData(getGetSessionQueryKey(), session);
    } catch (cause) {
      setError(t(errorKeyFor(cause)));
    }
  }

  return (
    <AuthLayout
      eyebrow={t('register.eyebrow')}
      title={t('register.title')}
      subtitle={t('register.subtitle')}
      footer={
        <p className="mt-4 text-center text-xs text-[hsl(var(--muted-foreground))]">
          {t('register.haveAccount')}{' '}
          <Link href="/" data-testid="link-login" className="font-bold text-[hsl(var(--primary))] hover:underline">
            {t('register.goToLogin')}
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="card-surface mt-6 rounded-xl p-5">
        <div className="space-y-4">
          <AuthField
            id="register-name"
            label={t('register.name')}
            name="name"
            autoComplete="name"
            required
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
            data-testid="input-name"
          />
          <AuthField
            id="register-email"
            label={t('auth.email')}
            name="email"
            type="email"
            autoComplete="username"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            data-testid="input-email"
          />
          <AuthField
            id="register-password"
            label={t('auth.password')}
            hint={t('register.passwordHint', { min: MIN_PASSWORD_LENGTH })}
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={256}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            data-testid="input-password"
          />
          <AuthField
            id="register-confirm-password"
            label={t('register.confirmPassword')}
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            data-testid="input-confirm-password"
          />
        </div>

        {error && <AuthError message={error} testId="text-register-error" />}

        <Button
          type="submit"
          disabled={register.isPending}
          data-testid="button-register"
          className="mt-5 w-full"
        >
          {register.isPending && <LoaderCircle size={15} className="animate-spin" />}
          {t(register.isPending ? 'register.submitting' : 'register.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}
