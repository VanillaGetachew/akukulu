import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // `next dev` and `next build` must not share an output folder, or a build run
  // while the dev server is up corrupts the dev server's files.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  outputFileTracingRoot: root,
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  // Lets the dev server be opened through a Cloudflare quick tunnel (Telegram testing).
  allowedDevOrigins: ['*.trycloudflare.com'],
};

export default nextConfig;
