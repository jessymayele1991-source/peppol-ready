import { useEffect, useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useLocation } from 'wouter';
import { useCreateCompany, useUpdateCompany, type Company } from '@workspace/api-client-react';
import { CreateCompanyBody, UpdateCompanyBody } from '@workspace/api-zod';
import { AuthError, AuthField } from '@/components/auth-layout';
import { Button } from '@/components/peppol-ui';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/hooks/use-toast';
import { useI18n } from '@/i18n/i18n';
import { clientErrorKey, fieldErrorKeys, textOrNull, useRefreshClients } from './client-shared';

const FIELDS = [
  { name: 'name', maxLength: 200, autoComplete: 'organization', required: true },
  { name: 'legalName', maxLength: 200 },
  { name: 'vatNumber', maxLength: 32 },
  { name: 'registrationNumber', maxLength: 32 },
  { name: 'email', maxLength: 254, type: 'email' },
  { name: 'phone', maxLength: 50, type: 'tel' },
  { name: 'industry', maxLength: 100 },
  { name: 'accountingPackage', maxLength: 100 },
  { name: 'addressLine', maxLength: 200, autoComplete: 'street-address' },
  { name: 'postalCode', maxLength: 20, autoComplete: 'postal-code' },
  { name: 'city', maxLength: 100, autoComplete: 'address-level2' },
  { name: 'country', maxLength: 2, autoComplete: 'country', hint: true },
] as const;

type FieldName = (typeof FIELDS)[number]['name'];
type Values = Record<FieldName, string>;

function valuesOf(company?: Company): Values {
  return Object.fromEntries(FIELDS.map(({ name }) => [name, company?.[name] ?? ''])) as Values;
}

/**
 * Creates a client, or edits one when `company` is given. Only fields the user
 * can set are in the form; the server rejects anything else and normalizes
 * what it stores, so the form shows the stored values after saving.
 */
export function CompanyFormSheet({
  open,
  onOpenChange,
  company,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company?: Company;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const refresh = useRefreshClients();
  const create = useCreateCompany();
  const update = useUpdateCompany();
  const [values, setValues] = useState<Values>(() => valuesOf(company));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;

  useEffect(() => {
    if (!open) return;
    setValues(valuesOf(company));
    setFieldErrors({});
    setError(null);
  }, [open, company]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const initial = valuesOf(company);
    const payload: Record<string, string | null> = {};
    for (const { name } of FIELDS) {
      // An edit sends only what changed; a new client sends what was filled in.
      if (company && values[name].trim() === initial[name]) continue;
      const value = textOrNull(values[name]);
      if (name === 'name') payload[name] = value ?? '';
      else if (value !== null || company) payload[name] = value;
    }

    const parsed = (company ? UpdateCompanyBody : CreateCompanyBody).safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(fieldErrorKeys(parsed.error));
      return;
    }
    setFieldErrors({});

    try {
      if (company) {
        if (Object.keys(payload).length > 0) {
          await update.mutateAsync({ companyId: company.id, data: parsed.data });
        }
        toast({ title: t('clients.toast.updated') });
      } else {
        const created = await create.mutateAsync({ data: CreateCompanyBody.parse(payload) });
        toast({ title: t('clients.toast.created') });
        navigate(`/clients/${created.id}`);
      }
      await refresh();
      onOpenChange(false);
    } catch (cause) {
      setError(t(clientErrorKey(cause)));
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-[480px]">
        <SheetHeader>
          <SheetTitle>{t(company ? 'clients.form.editTitle' : 'clients.form.createTitle')}</SheetTitle>
          <SheetDescription>{t('clients.form.description')}</SheetDescription>
        </SheetHeader>
        <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4" data-testid="form-company">
          {FIELDS.map((field) => (
            <AuthField
              key={field.name}
              id={`company-${field.name}`}
              name={field.name}
              label={t(`clients.fields.${field.name}`)}
              hint={'hint' in field ? t(`clients.fields.${field.name}Hint`) : undefined}
              type={'type' in field ? field.type : 'text'}
              autoComplete={'autoComplete' in field ? field.autoComplete : 'off'}
              required={'required' in field}
              maxLength={field.maxLength}
              value={values[field.name]}
              onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
              error={fieldErrors[field.name] ? t(fieldErrors[field.name] as string) : undefined}
              data-testid={`input-company-${field.name}`}
            />
          ))}
          {error && <AuthError message={error} testId="text-company-error" />}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>{t('clients.form.cancel')}</Button>
            <Button type="submit" disabled={pending} data-testid="button-save-company">
              {pending && <LoaderCircle size={15} className="animate-spin" />}
              {t('clients.form.save')}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
