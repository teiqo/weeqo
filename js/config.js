/* ---------- конфиг weeqo: единственный файл, который нужно править ---------- */

/* 1) Адрес базы: Firebase Console -> Realtime Database -> вкладка Data, сверху.
      Допиши /weeqo-swaps.json в конец — в консоли этой части нет. */
var SHARED_SWAPS_URL = "https://weeqo-8c533-default-rtdb.firebaseio.com/weeqo-swaps.json";

/* 2) Web API Key: Project settings -> General -> Your apps -> иконка </> ->
      придумай название -> Register app -> из сниппета копируй значение apiKey. */
var FIREBASE_API_KEY = "";

/* 3) Имя бота от @BotFather без @. Боту нужен /setdomain на домен сайта
      (для GitHub Pages это teiqo.github.io). */
var TELEGRAM_BOT_NAME = "";

/* 4) sha256 токена бота — считает tools/bot-hash.html (двойной клик, вставить токен).
      Сам токен сюда НЕ вставляй! */
var TELEGRAM_BOT_TOKEN_SHA256 = "";
