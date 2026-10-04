import { useState } from 'react';
import { ChevronLeft, ChevronRight, CircleAlert, LoaderCircle, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import {
  getGetCompanyAssessmentQueryKey,
  getListCompanyAssessmentsQueryKey,
  useGetCompanyAssessment,
  useListCompanyAssessments,
  type AssessmentSummary,
} from '@workspace/api-client-react';
import { useSession } from '@/auth/session-context';
import { Badge, Button, type PeppolStatusCode } from '@/components/peppol-ui';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useI18n } from '@/i18n/i18n';
import { AssessmentResult } from './assessment-result';

const PAGE_SIZE = 10;

/** The score's movement against the previous assessment, or that it cannot be compared. */
function Delta({ delta }: { delta: number | null }) {
  const { formatNumber, t } = useI18n();

  if (delta === null) {
    return (
      <span className="text-[10px] text-[hsl(var(--muted-foreground))]" data-testid="text-delta-incomparable">
        {t('clients.readiness.history.delta.incomparable')}
      </span>
    );
  }
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[hsl(var(--muted-foreground))]">
        <Minus size={11} /> {t('clients.readiness.history.delta.equal')}
      </span>
    );
  }

  const up = delta > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-bold ${up ? 'text-[hsl(159_58%_30%)]' : 'text-[hsl(var(--destructive))]'}`}
      data-testid="text-delta"
    >
      <Icon size={11} />
      {up ? '+' : '−'}
      {formatNumber(Math.abs(delta))}
    </span>
  );
}

/** One history row; its detail is fetched only once the row is opened. */
function AssessmentRow({ companyId, summary, open }: {
  companyId: string;
  summary: AssessmentSummary;
  open: boolean;
}) {
  const { formatDate, formatNumber, t } = useI18n();
  const { session } = useSession();

  const detail = useGetCompanyAssessment(companyId, summary.assessmentId, {
    query: {
      queryKey: getGetCompanyAssessmentQueryKey(companyId, summary.assessmentId),
      enabled: open,
      staleTime: Infinity,
    },
  });

  const assessor =
    summary.completedById === null
      ? t('clients.readiness.history.unknownAssessor')
      : summary.completedById === session?.user.id
        ? t('clients.readiness.result.byYou')
        : (summary.completedByName ?? t('clients.readiness.history.unknownAssessor'));

  return (
    <AccordionItem value={summary.assessmentId} className="border-[hsl(var(--border)/.7)]">
      <AccordionTrigger className="px-5 py-3 hover:no-underline" data-testid={`row-assessment-${summary.assessmentId}`}>
        <span className="grid min-w-0 flex-1 gap-1 pr-3 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-4">
          <span className="whitespace-nowrap text-xs font-bold">
            {formatDate(summary.calculatedAt, { day: '2-digit', month: 'short', year: 'numeric' })}
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <span className="mono text-sm font-bold">{formatNumber(summary.score)}%</span>
            <Delta delta={summary.scoreDelta} />
            <Badge status={summary.status as PeppolStatusCode} />
          </span>
          <span className="whitespace-nowrap text-[10px] text-[hsl(var(--muted-foreground))]">
            {assessor} · {t('clients.readiness.result.engine', { version: formatNumber(summary.engineVersion) })} ·{' '}
            {t('clients.readiness.history.riskCount', { count: formatNumber(summary.riskCount) })}
          </span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="bg-[hsl(210_43%_98%)]">
        {detail.isLoading ? (
          <div className="flex min-h-[120px] items-center justify-center">
            <LoaderCircle className="animate-spin text-[hsl(var(--primary))]" size={20} />
          </div>
        ) : detail.isError || !detail.data ? (
          <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 text-center">
            <CircleAlert className="text-[hsl(var(--destructive))]" size={22} />
            <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">
              {t('clients.readiness.history.loadError')}
            </p>
            <Button variant="secondary" className="h-8" onClick={() => void detail.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : (
          <AssessmentResult assessment={detail.data} />
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

/**
 * A client's assessment history, newest first. Rows open independently so two
 * assessments can be compared side by side, and each one loads its control
 * points and evidence only when it is opened.
 */
export function AssessmentTimeline({ companyId }: { companyId: string }) {
  const { formatNumber, t } = useI18n();
  const [page, setPage] = useState(1);
  const [openRows, setOpenRows] = useState<string[]>([]);

  const params = { page, pageSize: PAGE_SIZE };
  const history = useListCompanyAssessments(companyId, params, {
    query: { queryKey: getListCompanyAssessmentsQueryKey(companyId, params), placeholderData: (previous) => previous },
  });

  if (history.isLoading) {
    return (
      <div className="flex min-h-[160px] items-center justify-center">
        <LoaderCircle className="animate-spin text-[hsl(var(--primary))]" size={22} />
      </div>
    );
  }
  if (history.isError || !history.data) {
    return (
      <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 text-center">
        <CircleAlert className="text-[hsl(var(--destructive))]" size={24} />
        <p className="text-sm font-semibold text-[hsl(var(--muted-foreground))]">
          {t('clients.readiness.history.loadError')}
        </p>
        <Button onClick={() => void history.refetch()}>{t('common.retry')}</Button>
      </div>
    );
  }

  const { items, total, pageSize } = history.data;
  if (total === 0) {
    return <p className="px-5 py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">{t('clients.readiness.history.empty')}</p>;
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div data-testid="panel-assessment-history">
      <Accordion type="multiple" value={openRows} onValueChange={setOpenRows}>
        {items.map((summary) => (
          <AssessmentRow
            key={summary.assessmentId}
            companyId={companyId}
            summary={summary}
            open={openRows.includes(summary.assessmentId)}
          />
        ))}
      </Accordion>

      {pageCount > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--border)/.7)] px-5 py-3 text-[11px] text-[hsl(var(--muted-foreground))]">
          <span>
            {t('clients.pagination.summary', {
              from: formatNumber((page - 1) * pageSize + 1),
              to: formatNumber((page - 1) * pageSize + items.length),
              total: formatNumber(total),
            })}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              className="h-8 px-2.5"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              aria-label={t('common.previousPage')}
              data-testid="button-history-previous"
            >
              <ChevronLeft size={14} />
            </Button>
            <span className="mono">{t('clients.pagination.page', { page: formatNumber(page), pages: formatNumber(pageCount) })}</span>
            <Button
              variant="secondary"
              className="h-8 px-2.5"
              disabled={page >= pageCount}
              onClick={() => setPage(page + 1)}
              aria-label={t('common.nextPage')}
              data-testid="button-history-next"
            >
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
