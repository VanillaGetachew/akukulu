/** Minimal typing for the parts of Telegram.WebApp the app uses. */
interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: { id: number; first_name: string } };
  ready(): void;
  expand(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  openTelegramLink?(url: string): void;
  openLink?(url: string): void;
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
  };
  BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function webApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null;
  const app = window.Telegram?.WebApp;
  return app && app.initData ? app : null;
}

export function initTelegram() {
  const app = webApp();
  if (!app) return;
  app.ready();
  app.expand();
  app.setHeaderColor?.('#07071a');
  app.setBackgroundColor?.('#07071a');
}

export function startParam(): string | null {
  const fromTelegram = webApp()?.initDataUnsafe.start_param;
  if (fromTelegram) return fromTelegram;
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('tgWebAppStartParam');
}

export function haptic(kind: 'tap' | 'success' | 'error' = 'tap') {
  const h = webApp()?.HapticFeedback;
  if (!h) return;
  if (kind === 'tap') h.impactOccurred('light');
  else h.notificationOccurred(kind);
}

export function openShare(url: string, text: string) {
  const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  const app = webApp();
  if (app?.openTelegramLink) app.openTelegramLink(share);
  else window.open(share, '_blank', 'noopener');
}
