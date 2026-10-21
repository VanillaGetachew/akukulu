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
  // Lets the dev server be opened through a public tunnel (Telegram testing).
  allowedDevOrigins: ['*.trycloudflare.com', '*.ngrok-free.dev', '*.ngrok-free.app'],
  // Socket.IO requests end in "/socket.io/"; don't redirect them to drop the slash.
  skipTrailingSlashRedirect: true,
  /**
   * The web app forwards API and Socket.IO traffic to the API server, so the
   * browser only ever talks to one origin (one tunnel / one domain, no CORS).
   */
  async rewrites() {
    const api = (process.env.INTERNAL_API_ORIGIN ?? 'http://localhost:4000').replace(/\/$/, '');
    return [
      { source: '/api/:path*', destination: `${api}/api/:path*` },
      // Socket.IO only answers on "/socket.io/" (with the slash), so keep it on the way through.
      { source: '/socket.io', destination: `${api}/socket.io/` },
      { source: '/socket.io/:path+', destination: `${api}/socket.io/:path+` },
    ];
  },
};

export default nextConfig;
