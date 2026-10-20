import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Bricolage_Grotesque, Manrope, Noto_Sans_Ethiopic } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-display', weight: ['600', '700', '800'] });
const body = Manrope({ subsets: ['latin'], variable: '--font-body', weight: ['400', '500', '600', '700', '800'] });
const ethiopic = Noto_Sans_Ethiopic({ subsets: ['ethiopic'], variable: '--font-ethiopic', weight: ['600', '700'] });

export const metadata: Metadata = {
  title: 'Akukulu — አኩኩሉ',
  description: 'Play Ludo, Poker, Blackjack, Conquer and Crazy with friends on Telegram. Free virtual points only.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#07071a',
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The Telegram SDK sets CSS variables on <html> before hydration.
    <html lang="en" className={`${display.variable} ${body.variable} ${ethiopic.variable}`} suppressHydrationWarning>
      <head>
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      </head>
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
