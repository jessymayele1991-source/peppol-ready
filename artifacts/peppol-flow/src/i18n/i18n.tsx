import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

type Messages = Record<string, unknown>;
type InterpolationValues = Record<string, string | number>;

type LocaleModule = {
  default: Messages & {
    meta: { code: string; name: string };
  };
};

const localeModules = import.meta.glob<LocaleModule>('../locales/*.json', {
  eager: true,
});

const locales = Object.values(localeModules).reduce<Record<string, LocaleModule['default']>>(
  (registry, module) => {
    registry[module.default.meta.code] = module.default;
    return registry;
  },
  {},
);

export const DEFAULT_LANGUAGE = 'nl';
let activeLanguage = DEFAULT_LANGUAGE;

function resolveMessage(messages: Messages, key: string): string | undefined {
  const value = key.split('.').reduce<unknown>(
    (current, segment) =>
      typeof current === 'object' && current !== null
        ? (current as Record<string, unknown>)[segment]
        : undefined,
    messages,
  );
  return typeof value === 'string' ? value : undefined;
}

function interpolate(template: string, values?: InterpolationValues) {
  if (!values) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    String(values[key] ?? `{{${key}}}`),
  );
}

export function translate(
  key: string,
  values?: InterpolationValues,
  language = activeLanguage,
) {
  const message =
    resolveMessage(locales[language] ?? locales[DEFAULT_LANGUAGE], key) ??
    resolveMessage(locales[DEFAULT_LANGUAGE], key) ??
    key;
  return interpolate(message, values);
}

export const availableLanguages = Object.values(locales).map((locale) => ({
  code: locale.meta.code,
  name: locale.meta.name,
}));

type I18nContextValue = {
  language: string;
  setLanguage: (language: string) => void;
  languages: typeof availableLanguages;
  t: (key: string, values?: InterpolationValues) => string;
  formatDate: (
    value: string | number | Date,
    options?: Intl.DateTimeFormatOptions,
  ) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatCurrency: (value: number, currency?: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
  userId,
}: {
  children: ReactNode;
  userId: string;
}) {
  const preferenceKey = `peppolflow:language:${userId}`;
  const [language, updateLanguage] = useState(() => {
    const stored = window.localStorage.getItem(preferenceKey);
    return stored && locales[stored] ? stored : DEFAULT_LANGUAGE;
  });

  useEffect(() => {
    activeLanguage = language;
    document.documentElement.lang = language;
    window.localStorage.setItem(preferenceKey, language);
  }, [language, preferenceKey]);

  const value = useMemo<I18nContextValue>(() => {
    const locale = language;
    return {
      language,
      languages: availableLanguages,
      setLanguage: (nextLanguage) => {
        if (locales[nextLanguage]) updateLanguage(nextLanguage);
      },
      t: (key, values) => translate(key, values, locale),
      formatDate: (date, options) =>
        new Intl.DateTimeFormat(locale, options).format(new Date(date)),
      formatNumber: (number, options) =>
        new Intl.NumberFormat(locale, options).format(number),
      formatCurrency: (number, currency = 'EUR') =>
        new Intl.NumberFormat(locale, {
          style: 'currency',
          currency,
        }).format(number),
    };
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n requires I18nProvider');
  return context;
}