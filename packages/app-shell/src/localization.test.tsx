import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  detectLanguage,
  LANGUAGE_STORAGE_KEY,
  LanguageSelector,
  LocalizationProvider,
  translateStatus,
  useLocalization,
} from './localization.js';

function memoryStorage(initial?: string) {
  const values = new Map<string, string>(initial ? [[LANGUAGE_STORAGE_KEY, initial]] : []);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

function Probe() {
  const { language, t } = useLocalization();
  return (
    <>
      <output>{language}</output>
      <p>{t('signIn')}</p>
      <p>{translateStatus('UP', t)}</p>
      <LanguageSelector />
    </>
  );
}

describe('localization', () => {
  it('detects supported device languages and falls back to English', () => {
    expect(detectLanguage(['de-DE', 'es-MX'])).toBe('es');
    expect(detectLanguage(['ht-HT'])).toBe('ht');
    expect(detectLanguage(['fr-CA'])).toBe('fr');
    expect(detectLanguage(['zh-Hans-CN'])).toBe('zh-CN');
    expect(detectLanguage(['zh-Hant-TW', 'en-GB'])).toBe('en');
    expect(detectLanguage(['de-DE'])).toBe('en');
  });

  it('uses the saved language instead of the device language', () => {
    render(
      <LocalizationProvider storage={memoryStorage('zh-CN')} deviceLanguages={['es-MX']}>
        <Probe />
      </LocalizationProvider>,
    );

    expect(screen.getByText('zh-CN')).toBeInTheDocument();
    expect(screen.getByText('登录')).toBeInTheDocument();
    expect(screen.getByText('在线')).toBeInTheDocument();
  });

  it('persists manual changes and keeps them after remount', async () => {
    const user = userEvent.setup();
    const storage = memoryStorage();
    const first = render(
      <LocalizationProvider storage={storage} deviceLanguages={['es-MX']}>
        <Probe />
      </LocalizationProvider>,
    );

    expect(screen.getByText('Iniciar sesión')).toBeInTheDocument();
    expect(screen.getByText('En línea')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Idioma' }), 'fr');
    expect(screen.getByText('Se connecter')).toBeInTheDocument();
    expect(screen.getByText('En ligne')).toBeInTheDocument();
    expect(storage.getItem(LANGUAGE_STORAGE_KEY)).toBe('fr');
    expect(document.documentElement.lang).toBe('fr');

    first.unmount();
    render(
      <LocalizationProvider storage={storage} deviceLanguages={['ht-HT']}>
        <Probe />
      </LocalizationProvider>,
    );

    expect(screen.getByText('fr')).toBeInTheDocument();
    expect(screen.getByText('Se connecter')).toBeInTheDocument();
  });
});
