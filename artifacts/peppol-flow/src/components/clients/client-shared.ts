import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@workspace/api-client-react';
import type { ZodError } from 'zod';

/**
 * Every response about clients: the list in all its filter states, a detail,
 * its contacts, and the dashboard, whose figures exclude archived clients.
 * The server stays the source of truth, so a change refetches rather than
 * patching the cache.
 */
export function useRefreshClients() {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      queryClient.invalidateQueries({
        predicate: ({ queryKey }) =>
          typeof queryKey[0] === 'string' &&
          (queryKey[0].startsWith('/api/companies') || queryKey[0] === '/api/readiness/dashboard'),
      }),
    [queryClient],
  );
}

/** The message key for a failed client or contact request. */
export function clientErrorKey(cause: unknown): string {
  if (!(cause instanceof ApiError)) return 'clients.errors.unexpected';
  const message = (cause.data as { error?: { message?: string } } | null)?.error?.message ?? '';
  switch (cause.status) {
    case 400:
      return 'clients.errors.invalid';
    case 403:
      return 'clients.errors.forbidden';
    case 404:
      return 'clients.errors.notFound';
    case 409:
      // The API names the conflict in its message; the code alone is shared.
      if (/VAT number/i.test(message)) return 'clients.errors.duplicateVat';
      if (/registration number/i.test(message)) return 'clients.errors.duplicateRegistration';
      if (/archived/i.test(message)) return 'clients.errors.archived';
      return 'clients.errors.conflict';
    default:
      return 'clients.errors.unexpected';
  }
}

/** Form text is kept as strings; the contract sends a cleared field as null. */
export function textOrNull(value: string) {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** First contract violation per field, as a message key. */
export function fieldErrorKeys(error: ZodError): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? '');
    if (!field || keys[field]) continue;
    keys[field] =
      issue.code === 'too_small'
        ? 'clients.validation.required'
        : issue.code === 'too_big'
          ? 'clients.validation.tooLong'
          : 'clients.validation.format';
  }
  return keys;
}
