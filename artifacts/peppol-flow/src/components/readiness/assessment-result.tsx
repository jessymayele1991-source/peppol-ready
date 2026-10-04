import { Check, X } from 'lucide-react';
import type { ReadinessAssessment } from '@workspace/api-client-react';
import { useSession } from '@/auth/session-context';
import { Badge, SeverityIcon, type PeppolStatusCode } from '@/components/peppol-ui';
import { useI18n } from '@/i18n/i18n';
import { QUESTION_KEYS, type QuestionKey } from './assessment-form';

/**
 * A recorded assessment: its score and status as stored, what each control
 * point said with the note behind it, and the risks with what to do about them.
 * Every label comes from the locale files by key or code; the English labels and
 * messages the API also returns are for API consumers, not for this interface.
 */
export function AssessmentResult({ assessment }: { assessment: ReadinessAssessment }) {
  const { formatDate, formatNumber, t } = useI18n();
  const { session } = useSession();
  const checks = new Map(assessment.checks.map((check) => [check.key, check]));
  const completedByYou = assessment.completedById !== null && assessment.completedById === session?.user.id;

  return (
    <div className="space-y-5 p-5" data-testid="panel-assessment-result">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">
            {t('clients.readiness.result.scoreLabel')}
          </p>
          <div className="mt-1 flex items-end gap-3">
            <span className="mono text-[34px] font-bold leading-none tracking-[-.06em]" data-testid="text-assessment-score">
              {formatNumber(assessment.score)}%
            </span>
            <Badge status={assessment.status as PeppolStatusCode} />
          </div>
        </div>
        <p className="text-[11px] leading-5 text-[hsl(var(--muted-foreground))]">
          {t('clients.readiness.result.assessedAt', {
            date: formatDate(assessment.calculatedAt, { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
          })}
          <br />
          {t(completedByYou ? 'clients.readiness.result.byYou' : 'clients.readiness.result.byColleague')}
          {' · '}
          {t('clients.readiness.result.engine', { version: formatNumber(assessment.engineVersion) })}
        </p>
      </div>

      <section>
        <h3 className="text-xs font-bold">{t('clients.readiness.result.factors')}</h3>
        <ul className="mt-2 divide-y divide-[hsl(var(--border)/.7)]">
          {QUESTION_KEYS.map((key: QuestionKey) => {
            const check = checks.get(key);
            const passed = check?.passed ?? false;
            return (
              <li key={key} className="flex items-start gap-3 py-3" data-testid={`row-check-${key}`}>
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${passed ? 'bg-[hsl(157_56%_93%)] text-[hsl(159_58%_30%)]' : 'bg-[hsl(4_100%_95%)] text-[hsl(var(--destructive))]'}`}>
                  {passed ? <Check size={14} strokeWidth={2.4} /> : <X size={14} strokeWidth={2.4} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold">{t(`clients.readiness.questions.${key}.label`)}</p>
                  {check?.evidence
                    ? <p className="mt-1 whitespace-pre-wrap break-words text-[11px] text-[hsl(var(--muted-foreground))]" data-testid={`text-evidence-${key}`}>{check.evidence}</p>
                    : <p className="mt-1 text-[11px] italic text-[hsl(var(--muted-foreground))]">{t('clients.readiness.result.noEvidence')}</p>}
                </div>
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">
                  {t(passed ? 'clients.readiness.result.passed' : 'clients.readiness.result.failed')}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h3 className="text-xs font-bold">{t('clients.readiness.result.risks')}</h3>
        {assessment.risks.length === 0 ? (
          <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">{t('clients.readiness.result.noRisks')}</p>
        ) : (
          <ul className="mt-2 space-y-2.5">
            {assessment.risks.map((risk) => (
              <li key={risk.code} className="flex items-start gap-3 rounded-xl border border-[hsl(var(--border))] p-3" data-testid={`row-risk-${risk.code}`}>
                <SeverityIcon severity={risk.severity} size={13} />
                <div className="min-w-0">
                  <p className="text-xs font-bold">{t(`risk.${risk.code}`)}</p>
                  <p className="mt-1 text-[11px] leading-4 text-[hsl(var(--muted-foreground))]">
                    {t(`riskRemediation.${risk.code}`)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
