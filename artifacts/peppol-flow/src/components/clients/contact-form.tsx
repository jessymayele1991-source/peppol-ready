import { useEffect, useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useCreateCompanyContact, useUpdateCompanyContact, type ClientContact } from '@workspace/api-client-react';
import { CreateCompanyContactBody, UpdateCompanyContactBody } from '@workspace/api-zod';
import { AuthError, AuthField } from '@/components/auth-layout';
import { Button } from '@/components/peppol-ui';
import { Checkbox } from '@/components/ui/checkbox';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/hooks/use-toast';
import { useI18n } from '@/i18n/i18n';
import { clientErrorKey, fieldErrorKeys, textOrNull, useRefreshClients } from './client-shared';

const FIELDS = [
  { name: 'name', maxLength: 200, autoComplete: 'name', required: true },
  { name: 'role', maxLength: 100, autoComplete: 'organization-title' },
  { name: 'email', maxLength: 254, type: 'email', autoComplete: 'email' },
  { name: 'phone', maxLength: 50, type: 'tel', autoComplete: 'tel' },
] as const;

type FieldName = (typeof FIELDS)[number]['name'];
type Values = Record<FieldName, string> & { isPrimary: boolean };

function valuesOf(contact?: ClientContact): Values {
  return {
    name: contact?.name ?? '',
    role: contact?.role ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    isPrimary: contact?.isPrimary ?? false,
  };
}

/** Adds a contact to a client, or edits one when `contact` is given. */
export function ContactFormSheet({
  companyId,
  open,
  onOpenChange,
  contact,
}: {
  companyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: ClientContact;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const refresh = useRefreshClients();
  const create = useCreateCompanyContact();
  const update = useUpdateCompanyContact();
  const [values, setValues] = useState<Values>(() => valuesOf(contact));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;

  useEffect(() => {
    if (!open) return;
    setValues(valuesOf(contact));
    setFieldErrors({});
    setError(null);
  }, [open, contact]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const initial = valuesOf(contact);
    const payload: Record<string, string | boolean | null> = {};
    for (const { name } of FIELDS) {
      if (contact && values[name].trim() === initial[name]) continue;
      const value = textOrNull(values[name]);
      if (name === 'name') payload[name] = value ?? '';
      else if (value !== null || contact) payload[name] = value;
    }
    if (!contact || values.isPrimary !== initial.isPrimary) payload['isPrimary'] = values.isPrimary;

    const schema = contact ? UpdateCompanyContactBody : CreateCompanyContactBody;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(fieldErrorKeys(parsed.error));
      return;
    }
    setFieldErrors({});

    try {
      if (contact) {
        if (Object.keys(payload).length > 0) {
          await update.mutateAsync({ companyId, contactId: contact.id, data: parsed.data });
        }
        toast({ title: t('clients.toast.contactUpdated') });
      } else {
        await create.mutateAsync({ companyId, data: CreateCompanyContactBody.parse(payload) });
        toast({ title: t('clients.toast.contactCreated') });
      }
      await refresh();
      onOpenChange(false);
    } catch (cause) {
      setError(t(clientErrorKey(cause)));
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-[440px]">
        <SheetHeader>
          <SheetTitle>{t(contact ? 'clients.contacts.editTitle' : 'clients.contacts.createTitle')}</SheetTitle>
          <SheetDescription>{t('clients.contacts.formDescription')}</SheetDescription>
        </SheetHeader>
        <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4" data-testid="form-contact">
          {FIELDS.map((field) => (
            <AuthField
              key={field.name}
              id={`contact-${field.name}`}
              name={field.name}
              label={t(`clients.contacts.fields.${field.name}`)}
              type={'type' in field ? field.type : 'text'}
              autoComplete={field.autoComplete}
              required={'required' in field}
              maxLength={field.maxLength}
              value={values[field.name]}
              onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
              error={fieldErrors[field.name] ? t(fieldErrors[field.name] as string) : undefined}
              data-testid={`input-contact-${field.name}`}
            />
          ))}
          <label htmlFor="contact-isPrimary" className="flex items-start gap-2.5 rounded-lg border border-[hsl(var(--border))] p-3">
            <Checkbox
              id="contact-isPrimary"
              checked={values.isPrimary}
              onCheckedChange={(checked) => setValues((current) => ({ ...current, isPrimary: checked === true }))}
              data-testid="checkbox-contact-primary"
              className="mt-0.5"
            />
            <span>
              <span className="block text-xs font-bold">{t('clients.contacts.fields.isPrimary')}</span>
              <span className="mt-0.5 block text-[11px] text-[hsl(var(--muted-foreground))]">{t('clients.contacts.fields.isPrimaryHint')}</span>
            </span>
          </label>
          {error && <AuthError message={error} testId="text-contact-error" />}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>{t('clients.form.cancel')}</Button>
            <Button type="submit" disabled={pending} data-testid="button-save-contact">
              {pending && <LoaderCircle size={15} className="animate-spin" />}
              {t('clients.form.save')}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
