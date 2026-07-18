import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import es from './locales/es.json';
import ur from './locales/ur.json';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'ur', label: 'اردو' },
] as const;

// Languages that read right-to-left — <html dir> is flipped for these in
// LanguageSwitcher so RTL scripts like Urdu lay out correctly.
export const RTL_LANGUAGES = new Set(['ur', 'ar', 'he', 'fa']);

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
      ur: { translation: ur },
    },
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    detection: {
      // Persist the explicit choice made via <LanguageSwitcher />, falling
      // back to the browser's Accept-Language on first visit.
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'flowforge_lang',
    },
  });

export default i18n;
