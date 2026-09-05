/* ---------- конфиг weeqo ----------
Значения в репозитории НЕ хранятся. Их подставляет GitHub Action при деплое
из окружения репозитория (Settings → Environments → github-pages):

Environment variables:  SHARED_SWAPS_URL, TELEGRAM_BOT_NAME
Environment secrets:    FIREBASE_API_KEY, TELEGRAM_BOT_TOKEN_SHA256

Для локальной проверки можно временно вписать значения сюда —
только не коммить их. */

var SHARED_SWAPS_URL = "";
var FIREBASE_API_KEY = "";
var TELEGRAM_BOT_NAME = "";
var TELEGRAM_BOT_TOKEN_SHA256 = "";
