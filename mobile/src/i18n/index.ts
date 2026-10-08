import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { resources } from './resources';

const i18n = createInstance();

void i18n.use(initReactI18next).init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  initAsync: false,
});

export default i18n;
