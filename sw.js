const CACHE = "weeqo-groups-v46";
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
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
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

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  /* schedule.json, changelog.json и config.js — network-first: свежее важнее кэша. */
  if (
    event.request.url.indexOf("data/schedule.json") !== -1 ||
    event.request.url.indexOf("data/changelog.json") !== -1 ||
    event.request.url.indexOf("js/config.js") !== -1
  ) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }
  /* Облако с заменами, auth-токены и виджет Telegram не кешируем.
     Офлайн отдаём 503 сами, чтобы не сыпать Uncaught в консоль. */
  if (/\.(firebaseio\.com|firebasedatabase\.app|googleapis\.com|getpantry\.cloud)|telegram\.org/.test(event.request.url)) {
    event.respondWith(
      fetch(event.request).catch(() => new Response(null, { status: 503 }))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request)
          .then((response) => {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
            return response;
          })
          .catch(() => caches.match("./index.html"))
    )
  );
});
