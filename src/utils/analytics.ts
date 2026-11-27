export type AnalyticsConsent = 'unset' | 'accepted' | 'declined';

const CONSENT_STORAGE_KEY = 'ct_nacs_ga_consent';

type GaWindow = Window & {
  [key: string]: unknown;
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
};

function getGaWindow(): GaWindow {
  return window as unknown as GaWindow;
}

export function getStoredConsent(): AnalyticsConsent {
  try {
    const val = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (val === 'accepted' || val === 'declined') {
      return val;
    }
  } catch {
    // Ignore storage access errors in restricted browsing modes.
  }
  return 'unset';
}

export function saveConsent(value: 'accepted' | 'declined'): void {
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, value);
  } catch {
    // Ignore storage access errors in restricted browsing modes.
  }
}

export function enableGoogleAnalytics(): void {
  const gaId = (import.meta.env.VITE_GA_MEASUREMENT_ID ?? '').trim();
  if (!gaId || typeof window === 'undefined') return;

  const w = getGaWindow();
  w[`ga-disable-${gaId}`] = false;

  if (!w.dataLayer) {
    w.dataLayer = [];
  }
  if (!w.gtag) {
    w.gtag = function gtag(...args: unknown[]) {
      w.dataLayer?.push(args);
    };
  }

  const existing = document.querySelector<HTMLScriptElement>('script[data-ga4-sdk="true"]');
  if (!existing) {
    const script = document.createElement('script');
    script.async = true;
    script.dataset.ga4Sdk = 'true';
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
    document.head.appendChild(script);

    w.gtag('js', new Date());
    w.gtag('config', gaId, { anonymize_ip: true });
  }
}

export function disableGoogleAnalytics(): void {
  if (typeof window === 'undefined') return;
  const gaId = (import.meta.env.VITE_GA_MEASUREMENT_ID ?? '').trim();
  const w = getGaWindow();

  if (gaId) {
    w[`ga-disable-${gaId}`] = true;
  }

  try {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const name = cookie.split('=')[0]?.trim();
      if (!name || !name.startsWith('_ga')) continue;
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/CT-NACS-MAP/`;
    }
  } catch {
    // Ignore cookie clearing errors.
  }
}
