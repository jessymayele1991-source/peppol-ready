import { useState, type ReactNode } from 'react';
import { Archive, ArrowLeft, CircleAlert, LoaderCircle, Pencil, Plus, RotateCcw, Star, Trash2, UserRound } from 'lucide-react';
import { Link, useParams } from 'wouter';
import {
  ApiError,
  getGetCompanyQueryKey,
  useArchiveCompany,
  useDeleteCompanyContact,
  useGetCompany,
  useRestoreCompany,
  type ClientContact,
} from '@workspace/api-client-react';
import { useSession } from '@/auth/session-context';
import { clientErrorKey, useRefreshClients } from '@/components/clients/client-shared';
import { CompanyFormSheet } from '@/components/clients/company-form';
import { ContactFormSheet } from '@/components/clients/contact-form';
import { Badge, Button, Card, EmptyState, type PeppolStatusCode } from '@/components/peppol-ui';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useI18n } from '@/i18n/i18n';
import { initials } from '@/lib/initials';

/** A confirmation that stays open, and reports failure, until its action settles. */
function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, destructive, onConfirm }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (cause) {
      setError(t(clientErrorKey(cause)));
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!pending) { setError(null); onOpenChange(next); } }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p role="alert" className="rounded-lg bg-[hsl(4_100%_95%)] p-2.5 text-[11px] font-semibold text-[hsl(3_69%_45%)]">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t('clients.form.cancel')}</AlertDialogCancel>
          <Button
            onClick={() => void confirm()}
            disabled={pending}
            data-testid="button-confirm"
            className={destructive ? 'bg-[hsl(var(--destructive))] shadow-none hover:shadow-none' : undefined}
          >
            {pending && <LoaderCircle size={15} className="animate-spin" />}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold">{children}</dd>
    </div>
  );
}

export function ClientDetail() {
  const { companyId } = useParams<{ companyId: string }>();
  const { formatDate, formatNumber, t } = useI18n();
  const { can } = useSession();
  const { toast } = useToast();
  const refresh = useRefreshClients();
  const archive = useArchiveCompany();
  const restore = useRestoreCompany();
  const removeContact = useDeleteCompanyContact();
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [contactForm, setContactForm] = useState<{ open: boolean; contact?: ClientContact }>({ open: false });
  const [deleting, setDeleting] = useState<ClientContact | null>(null);

  const { data: company, isLoading, isError, error, refetch } = useGetCompany(companyId, {
    query: { queryKey: getGetCompanyQueryKey(companyId), retry: (count, cause) => !(cause instanceof ApiError && cause.status === 404) && count < 2 },
  });

  if (isLoading) {
    return <Card><div className="flex min-h-[400px] items-center justify-center"><LoaderCircle className="animate-spin text-[hsl(var(--primary))]" size={26} /></div></Card>;
  }
  if (isError || !company) {
    // Another firm's client answers 404 as well: nothing here says it exists.
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <Card>
        <EmptyState
          icon={<CircleAlert size={25} />}
          title={t(missing ? 'clients.detail.notFoundTitle' : 'clients.loadError')}
          description={t(missing ? 'clients.detail.notFoundDescription' : 'clients.detail.retryDescription')}
          action={missing ? <Link href="/clients" className="text-sm font-bold text-[hsl(var(--primary))] hover:underline">{t('clients.detail.back')}</Link> : <Button onClick={() => void refetch()}>{t('common.retry')}</Button>}
        />
      </Card>
    );
  }

  const archived = company.archivedAt !== null;
  const canWrite = can('clients.write') && !archived;
  const address = [company.addressLine, [company.postalCode, company.city].filter(Boolean).join(' '), company.country].filter(Boolean).join(', ');
  const empty = <span className="font-normal text-[hsl(var(--muted-foreground))]">—</span>;

  async function toggleArchive() {
    if (archived) await restore.mutateAsync({ companyId });
    else await archive.mutateAsync({ companyId });
    toast({ title: t(archived ? 'clients.toast.restored' : 'clients.toast.archived') });
    await refresh();
  }

  async function deleteContact(contact: ClientContact) {
    await removeContact.mutateAsync({ companyId, contactId: contact.id });
    toast({ title: t('clients.toast.contactDeleted') });
    await refresh();
  }

  return (
    <div className="space-y-6">
      <Link href="/clients" data-testid="link-back-to-clients" className="inline-flex items-center gap-1.5 text-xs font-bold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]"><ArrowLeft size={14} /> {t('clients.detail.back')}</Link>

      <div className="animate-rise flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[hsl(222_45%_17%)] text-sm font-bold text-white">{initials(company.name)}</span>
          <div className="min-w-0">
            <h1 className="truncate text-[26px] font-bold tracking-[-.045em]" data-testid="text-client-name">{company.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge status={company.peppolStatus as PeppolStatusCode} />
              {archived && <Badge>{t('clients.archived')}</Badge>}
              {company.vatNumber && <span className="mono text-[11px] text-[hsl(var(--muted-foreground))]">{company.vatNumber}</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite && <Button variant="secondary" onClick={() => setEditing(true)} data-testid="button-edit-client"><Pencil size={14} /> {t('clients.detail.edit')}</Button>}
          {can('clients.archive') && (
            <Button variant="secondary" onClick={() => setConfirmArchive(true)} data-testid={archived ? 'button-restore-client' : 'button-archive-client'}>
              {archived ? <RotateCcw size={14} /> : <Archive size={14} />} {t(archived ? 'clients.detail.restore' : 'clients.detail.archive')}
            </Button>
          )}
        </div>
      </div>

      {archived && (
        <p role="status" className="flex items-start gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(214_30%_96%)] p-3.5 text-xs font-semibold text-[hsl(var(--muted-foreground))]" data-testid="text-client-archived">
          <Archive size={15} className="mt-px shrink-0" />
          {t('clients.detail.archivedNotice', { date: formatDate(company.archivedAt as string, { day: '2-digit', month: 'long', year: 'numeric' }) })}
        </p>
      )}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-client-overview">{t('clients.detail.overview')}</TabsTrigger>
          <TabsTrigger value="contacts" data-testid="tab-client-contacts">{t('clients.detail.contacts')} <span className="ml-1.5 opacity-60">{formatNumber(company.contacts.length)}</span></TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 grid gap-5 xl:grid-cols-[1.6fr_1fr]">
          <Card title={t('clients.detail.details')}>
            <dl className="grid gap-5 p-5 sm:grid-cols-2">
              <Detail label={t('clients.fields.legalName')}>{company.legalName ?? empty}</Detail>
              <Detail label={t('clients.fields.vatNumber')}>{company.vatNumber ? <span className="mono">{company.vatNumber}</span> : empty}</Detail>
              <Detail label={t('clients.fields.registrationNumber')}>{company.registrationNumber ? <span className="mono">{company.registrationNumber}</span> : empty}</Detail>
              <Detail label={t('clients.fields.email')}>{company.email ?? empty}</Detail>
              <Detail label={t('clients.fields.phone')}>{company.phone ?? empty}</Detail>
              <Detail label={t('clients.fields.industry')}>{company.industry ?? empty}</Detail>
              <Detail label={t('clients.fields.accountingPackage')}>{company.accountingPackage ?? empty}</Detail>
              <Detail label={t('clients.detail.address')}>{address || empty}</Detail>
            </dl>
          </Card>
          <Card title={t('clients.detail.readiness')}>
            <dl className="grid gap-5 p-5">
              <Detail label={t('clients.table.score')}><span className="mono text-[26px] tracking-[-.06em]">{formatNumber(company.readinessScore)}%</span></Detail>
              <Detail label={t('clients.table.status')}><Badge status={company.peppolStatus as PeppolStatusCode} /></Detail>
              <Detail label={t('clients.table.checked')}>{company.lastCheckedAt ? formatDate(company.lastCheckedAt, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : t('clients.neverChecked')}</Detail>
              <Detail label={t('clients.detail.createdAt')}>{formatDate(company.createdAt, { day: '2-digit', month: 'short', year: 'numeric' })}</Detail>
            </dl>
          </Card>
        </TabsContent>

        <TabsContent value="contacts" className="mt-4">
          <Card
            title={t('clients.detail.contacts')}
            action={canWrite ? <Button variant="quiet" onClick={() => setContactForm({ open: true })} data-testid="button-add-contact"><Plus size={13} /> {t('clients.contacts.add')}</Button> : undefined}
          >
            {company.contacts.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">{t('clients.contacts.empty')}</p>
            ) : (
              <ul className="divide-y divide-[hsl(var(--border)/.7)]">
                {company.contacts.map((contact) => (
                  <li key={contact.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5" data-testid={`row-contact-${contact.id}`}>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"><UserRound size={15} /></span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-xs font-bold">
                        {contact.name}
                        {contact.isPrimary && <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(221_83%_53%/.09)] px-2 py-0.5 text-[10px] text-[hsl(var(--primary))]"><Star size={10} /> {t('clients.contacts.primary')}</span>}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-[hsl(var(--muted-foreground))]">{[contact.role, contact.email, contact.phone].filter(Boolean).join(' · ') || '—'}</p>
                    </div>
                    {canWrite && (
                      <div className="flex gap-1">
                        <Button variant="ghost" className="h-8 px-2" onClick={() => setContactForm({ open: true, contact })} aria-label={t('clients.contacts.edit', { name: contact.name })} data-testid={`button-edit-contact-${contact.id}`}><Pencil size={14} /></Button>
                        <Button variant="ghost" className="h-8 px-2 hover:text-[hsl(var(--destructive))]" onClick={() => setDeleting(contact)} aria-label={t('clients.contacts.delete', { name: contact.name })} data-testid={`button-delete-contact-${contact.id}`}><Trash2 size={14} /></Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {canWrite && <CompanyFormSheet open={editing} onOpenChange={setEditing} company={company} />}
      {canWrite && <ContactFormSheet companyId={companyId} open={contactForm.open} contact={contactForm.contact} onOpenChange={(open) => setContactForm((current) => ({ ...current, open }))} />}
      {can('clients.archive') && (
        <ConfirmDialog
          open={confirmArchive}
          onOpenChange={setConfirmArchive}
          title={t(archived ? 'clients.detail.restoreTitle' : 'clients.detail.archiveTitle', { name: company.name })}
          description={t(archived ? 'clients.detail.restoreDescription' : 'clients.detail.archiveDescription')}
          confirmLabel={t(archived ? 'clients.detail.restore' : 'clients.detail.archive')}
          onConfirm={toggleArchive}
        />
      )}
      {canWrite && (
        <ConfirmDialog
          open={deleting !== null}
          onOpenChange={(open) => { if (!open) setDeleting(null); }}
          title={t('clients.contacts.deleteTitle', { name: deleting?.name ?? '' })}
          description={t('clients.contacts.deleteDescription')}
          confirmLabel={t('clients.contacts.deleteConfirm')}
          destructive
          onConfirm={() => deleteContact(deleting as ClientContact)}
        />
      )}
    </div>
  );
}
