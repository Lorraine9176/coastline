// 海岸线 Service Worker
// 策略：network-first（联网时永远拉取最新文件，保证 js/config.js 的高德 Key 即时生效）；
// 离线时回退到缓存，保证已保存路线/记录可看。
const CACHE = 'coastline-v3';
const ASSETS = [
  '/',
  '/index.html',
  '/styles/main.css',
  '/js/app.js',
  '/js/config.js',
  '/js/db.js',
  '/js/geo.js',
  '/js/gps.js',
  '/js/amap.js',
  '/js/presets.js',
  '/js/corridor.js',
  '/js/parse.js',
  '/js/router.js',
  '/manifest.webmanifest',
  '/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 跨域请求（如高德地图脚本/瓦片）不经过本 SW，直接走浏览器默认逻辑
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('/index.html')))
  );
});
