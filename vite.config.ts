import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'favicon.ico',
          'icon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
        ],
        manifest: {
          id: '/',
          name: 'CIRCLE Workspace ASLI RI',
          short_name: 'CIRCLE',
          description:
            'Enterprise collaboration portal with Google Auth, Calendar, and Drive integration.',
          theme_color: '#FF5364',
          background_color: '#ffffff',
          display: 'standalone',
          orientation: 'portrait-primary',
          start_url: '/',
          scope: '/',
          prefer_related_applications: false,
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          importScripts: ['/sw-notifications.js'],
          maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
          // Precache ONLY the lightweight app shell & icons on first visit so initial bandwidth is never saturated by 5MB+ of lazy route chunks.
          globPatterns: ['index.html', 'manifest.webmanifest', 'favicon.ico', 'icon.svg', 'apple-touch-icon.png', 'pwa-*.png', 'assets/index-*.css', 'assets/index-*.js', 'assets/vendor-react-*.js', 'assets/rolldown-runtime-*.js'],
          globIgnores: ['assets/aistudio/**', 'uploads/**', '**/vendor-pdf*', '**/html2canvas*', '**/vendor-charts*'],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//],
          runtimeCaching: [
            {
              // Content-hashed Vite JS/CSS chunks are immutable — cache on first visit with zero revalidation latency
              urlPattern: ({ url }) =>
                url.pathname.startsWith('/assets/') &&
                (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')),
              handler: 'CacheFirst',
              options: {
                cacheName: 'vite-immutable-chunks',
                expiration: {
                  maxEntries: 80,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: ({ url }) =>
                url.pathname.startsWith('/assets/') ||
                url.pathname.startsWith('/api/files/') ||
                url.pathname.startsWith('/api/public/'),
              handler: 'CacheFirst',
              options: {
                cacheName: 'workspace-media-cache',
                expiration: {
                  maxEntries: 120,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'classic',
          navigateFallback: 'index.html',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        sonner: path.resolve(__dirname, 'src/lib/sonnerCompat.jsx'),
      },
    },
    build: {
      target: 'es2020',
      cssCodeSplit: true,
      modulePreload: {
        polyfill: false,
        resolveDependencies: (_filename, deps) =>
          deps.filter(
            (dep) =>
              !dep.includes('vendor-pdf') &&
              !dep.includes('vendor-charts') &&
              !dep.includes('html2canvas')
          ),
      },
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('react-dom') || id.includes('react-router') || id.includes('/node_modules/react/') || id.includes('scheduler')) {
              return 'vendor-react';
            }
            if (id.includes('firebase')) {
              return 'vendor-firebase';
            }
            if (id.includes('recharts') || id.includes('d3-')) {
              return 'vendor-charts';
            }
            if (id.includes('jspdf') || id.includes('html2canvas')) {
              return 'vendor-pdf';
            }
            if (id.includes('@radix-ui')) {
              return 'vendor-radix';
            }
            if (id.includes('lucide-react')) {
              return 'vendor-icons';
            }
            if (id.includes('framer-motion') || id.includes('/node_modules/motion/')) {
              return 'vendor-motion';
            }
            if (id.includes('date-fns') || id.includes('dayjs') || id.includes('axios') || id.includes('dompurify')) {
              return 'vendor-utils';
            }
            return undefined;
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

