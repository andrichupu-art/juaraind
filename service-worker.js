/* ========================================= */
/* PT. JUARA Mail - Service Worker (PWA)     */
/* ========================================= */

const CACHE_NAME = 'juara-mail-cache-v1';

// File inti yang di-cache agar shell aplikasi tetap muncul walau offline
const CORE_ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    './icon-192.png',
    './icon-512.png'
];

// Saat service worker pertama kali dipasang: simpan file inti ke cache
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
    );
    self.skipWaiting();
});

// Saat service worker aktif: bersihkan cache versi lama
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            )
        )
    );
    self.clients.claim();
});

// Strategi: cache-first untuk asset inti, fallback ke network untuk sisanya
self.addEventListener('fetch', (event) => {
    // Biarkan request ke luar domain (misal fonts.googleapis.com) lewat apa adanya
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;

            return fetch(event.request)
                .then((response) => {
                    // Simpan salinan response baru ke cache (khusus file same-origin)
                    if (response && response.status === 200 && event.request.url.startsWith(self.location.origin)) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
                    }
                    return response;
                })
                .catch(() => caches.match('./index.html'));
        })
    );
});
