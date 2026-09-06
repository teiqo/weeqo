const CACHE = "weeqo-groups-v63";
const ASSETS = [
  "./",
  "./index.html",
  "./assets/index-DpiSe78P.css",
  "./assets/weekly-VO4sFbvD.css",
  "./assets/WeeklyApp-BMeQie97.css",
  "./assets/weekly-transitions-BckgDRnH.css",
  "./assets/weekly-opaque-GLxzbT3R.css",
  "./css/patch.css",
  "./js/config.js",
  "./js/app.js",
  "./js/schedule.js",
  "./images/weeqo-icon.svg",
  "./images/weeqo-180.png",
  "./manifest.webmanifest",
  "./assets/fonts/inter.ttf"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      /* Обходим HTTP-кэш браузера, чтобы в кэш SW не попала устаревшая копия. */
      .then((cache) =>
        Promise.all(
          ASSETS.map((url) =>
            fetch(new Request(url, { cache: "reload" }))
              .then((res) => (res.ok ? cache.put(url, res) : null))
              .catch(() => null)
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

/* Страница может попросить сбросить кэш и сам SW, если приложение не загрузилось. */
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "skip-waiting") {
    self.skipWaiting();
    return;
  }
  if (data.type === "purge") {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => {
          if (event.source) event.source.postMessage({ type: "purged" });
        })
    );
  }
});

const isFresh = (url) =>
  url.indexOf("data/schedule.json") !== -1 ||
  url.indexOf("data/changelog.json") !== -1 ||
  url.indexOf("js/config.js") !== -1 ||
  url.indexOf("js/local-config.js") !== -1;

/* HTML и код приложения — network-first: битая копия в кэше не должна залипать навсегда. */
const isAppShell = (request) =>
  request.mode === "navigate" ||
  request.destination === "document" ||
  request.destination === "script" ||
  /\.(html|js|mjs)(\?|$)/.test(new URL(request.url).pathname);

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = request.url;

  /* Облако с заменами, auth-токены и виджет Telegram не кешируем.
     Офлайн отдаём 503 сами, чтобы не сыпать Uncaught в консоль. */
  if (/\.(firebaseio\.com|firebasedatabase\.app|googleapis\.com|getpantry\.cloud)|telegram\.org/.test(url)) {
    event.respondWith(
      fetch(request).catch(() => new Response(null, { status: 503 }))
    );
    return;
  }

  if (isFresh(url)) {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }

  if (isAppShell(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches
            .match(request)
            .then((cached) =>
              cached ||
              (request.destination === "script"
                ? new Response("", {
                    status: 503,
                    headers: { "Content-Type": "application/javascript" }
                  })
                : caches.match("./index.html"))
            )
        )
    );
    return;
  }

  /* Остальное (css с хэшем, шрифты, картинки) — cache-first. */
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request)
          .then((response) => {
            if (response && response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => caches.match("./index.html"))
    )
  );
});
