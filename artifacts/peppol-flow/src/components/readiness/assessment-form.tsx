import { useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useCalculateCompanyReadiness, type ReadinessAssessmentInput } from '@workspace/api-client-react';
import { CalculateCompanyReadinessBody } from '@workspace/api-zod';
import { AuthError } from '@/components/auth-layout';
import { clientErrorKey, useRefreshClients } from '@/components/clients/client-shared';
import { Button } from '@/components/peppol-ui';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useI18n } from '@/i18n/i18n';

/**
 * The five questions of the active engine, in the order they are weighted. The
 * keys are the contract's: an answer, its evidence note and the stored control
 * point all use the same key.
 */
export const QUESTION_KEYS = [
  'participantRegistered',
  'receivingAddressConfigured',
  'peppolCapableSoftware',
  'certificateValid',
  'successfulTestInvoice',
] as const;

export type QuestionKey = (typeof QUESTION_KEYS)[number];

const EVIDENCE_LIMIT = 500;

type Answers = Record<QuestionKey, boolean | null>;
type Evidence = Record<QuestionKey, string>;

const blankAnswers = () => Object.fromEntries(QUESTION_KEYS.map((key) => [key, null])) as Answers;
const blankEvidence = () => Object.fromEntries(QUESTION_KEYS.map((key) => [key, ''])) as Evidence;

/**
 * Records a readiness assessment. Every question needs an explicit yes or no —
 * the contract has no "unanswered" — and each one takes an optional note about
 * what the accountant saw. The server recalculates the score from the answers,
 * so nothing here decides the outcome.
 */
export function AssessmentForm({ companyId, onRecorded, onCancel }: {
  companyId: string;
  onRecorded: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const refresh = useRefreshClients();
  const calculate = useCalculateCompanyReadiness();
  const [answers, setAnswers] = useState<Answers>(blankAnswers);
  const [evidence, setEvidence] = useState<Evidence>(blankEvidence);
  const [error, setError] = useState<string | null>(null);

  const answered = QUESTION_KEYS.filter((key) => answers[key] !== null).length;
  const complete = answered === QUESTION_KEYS.length;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!complete) return;

    const notes = Object.fromEntries(
      QUESTION_KEYS.map((key) => [key, evidence[key].trim()]).filter(([, note]) => note !== ''),
    );
    const payload: ReadinessAssessmentInput = {
      ...(Object.fromEntries(QUESTION_KEYS.map((key) => [key, answers[key] === true])) as Record<QuestionKey, boolean>),
      // Omitted when empty: the contract accepts no evidence, but rejects null.
      ...(Object.keys(notes).length > 0 ? { evidence: notes } : {}),
    };

    const parsed = CalculateCompanyReadinessBody.safeParse(payload);
    if (!parsed.success) {
      setError(t('clients.readiness.errors.invalid'));
      return;
    }

    try {
      await calculate.mutateAsync({ companyId, data: payload });
      toast({ title: t('clients.readiness.toast.recorded') });
      await refresh();
      onRecorded();
    } catch (cause) {
      setError(t(clientErrorKey(cause)));
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5 p-5" data-testid="form-assessment">
      <p className="text-xs text-[hsl(var(--muted-foreground))]">{t('clients.readiness.formDescription')}</p>

      {QUESTION_KEYS.map((key, index) => (
        <div key={key} className="rounded-xl border border-[hsl(var(--border))] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold">
                <span className="mono mr-2 text-[hsl(var(--muted-foreground))]">{index + 1}.</span>
                {t(`clients.readiness.questions.${key}.label`)}
              </p>
              <p className="mt-1 text-[11px] leading-4 text-[hsl(var(--muted-foreground))]">
                {t(`clients.readiness.questions.${key}.hint`)}
              </p>
            </div>
            <div role="group" aria-label={t(`clients.readiness.questions.${key}.label`)} className="flex shrink-0 gap-1.5">
              {[true, false].map((value) => (
                <button
                  key={String(value)}
                  type="button"
                  aria-pressed={answers[key] === value}
                  onClick={() => setAnswers((current) => ({ ...current, [key]: value }))}
                  data-testid={`button-answer-${key}-${value ? 'yes' : 'no'}`}
                  className={`h-8 rounded-lg border px-3 text-xs font-bold transition-colors ${
                    answers[key] === value
                      ? value
                        ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-white'
                        : 'border-[hsl(var(--destructive))] bg-[hsl(var(--destructive))] text-white'
                      : 'border-[hsl(var(--border))] bg-white text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--primary))]'
                  }`}
                >
                  {t(value ? 'clients.readiness.answerYes' : 'clients.readiness.answerNo')}
                </button>
              ))}
            </div>
          </div>

          <label htmlFor={`evidence-${key}`} className="mt-3 block text-[10px] font-bold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">
            {t('clients.readiness.evidenceLabel')}
          </label>
          <Textarea
            id={`evidence-${key}`}
            value={evidence[key]}
            maxLength={EVIDENCE_LIMIT}
            rows={2}
            placeholder={t('clients.readiness.evidencePlaceholder')}
            onChange={(event) => setEvidence((current) => ({ ...current, [key]: event.target.value }))}
            data-testid={`input-evidence-${key}`}
            className="mt-1 text-xs"
          />
          <p className="mt-1 text-right text-[10px] text-[hsl(var(--muted-foreground))]">
            {t('clients.readiness.evidenceCounter', { count: evidence[key].length, max: EVIDENCE_LIMIT })}
          </p>
        </div>
      ))}

      {error && <AuthError message={error} testId="text-assessment-error" />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-[hsl(var(--muted-foreground))]" data-testid="text-assessment-progress">
          {t('clients.readiness.answeredOf', { answered, total: QUESTION_KEYS.length })}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>{t('clients.form.cancel')}</Button>
          <Button type="submit" disabled={!complete || calculate.isPending} data-testid="button-submit-assessment">
            {calculate.isPending && <LoaderCircle size={15} className="animate-spin" />}
            {t('clients.readiness.submit')}
          </Button>
        </div>
      </div>
    </form>
  );
}
