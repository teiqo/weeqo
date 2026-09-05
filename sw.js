const CACHE = "weeqo-groups-v18";
const ASSETS = [
  "./",
  "./index.html",
  "./assets/index-DpiSe78P.css",
  "./assets/weekly-VO4sFbvD.css",
  "./assets/WeeklyApp-BMeQie97.css",
  "./assets/weekly-transitions-BckgDRnH.css",
  "./assets/weekly-opaque-GLxzbT3R.css",
  "./css/patch.css",
  "./js/app.js",
  "./js/schedule.js",
  "./images/weekly.svg",
  "./images/weekly-180.png",
  "./manifest.webmanifest"
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
  if (event.request.url.indexOf("data/schedule.json") !== -1) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
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
