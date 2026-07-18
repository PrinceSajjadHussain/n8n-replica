import { useTranslation } from 'react-i18next';
import { RTL_LANGUAGES, SUPPORTED_LANGUAGES } from '../i18n';

export default function LanguageSwitcher() {
  const { i18n, t } = useTranslation();

  function changeLanguage(code: string) {
    i18n.changeLanguage(code);
    document.documentElement.dir = RTL_LANGUAGES.has(code) ? 'rtl' : 'ltr';
    document.documentElement.lang = code;
  }

  return (
    <label className="block">
      <span className="sr-only">{t('nav.language')}</span>
      <select
        value={i18n.resolvedLanguage ?? 'en'}
        onChange={(e) => changeLanguage(e.target.value)}
        className="focus-ring w-full text-xs bg-canvas border border-panelBorder rounded-md px-2 py-1.5 text-muted hover:text-ink transition-default"
        aria-label={t('nav.language')}
      >
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.label}
          </option>
        ))}
      </select>
    </label>
  );
}
