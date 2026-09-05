/* ---------- конфиг weeqo ----------
   Значения подставляет GitHub Action при деплое (tools/build_config.py)
   из переменных репозитория: Settings → Secrets and variables → Actions

     Variables: SHARED_SWAPS_URL, TELEGRAM_BOT_NAME, TELEGRAM_BOT_ID
     Secrets:   FIREBASE_API_KEY, TELEGRAM_BOT_TOKEN_SHA256

   Важно: пустая переменная НИЧЕГО не затирает — тогда работает значение
   ниже. Поэтому вход через Telegram живёт даже без настроек в Settings.

   TELEGRAM_BOT_ID — это Client ID из @BotFather → Bot Settings → Login
   Widget. Он публичный (всё равно уезжает в браузер), в отличие от
   Client Secret, который в код попадать не должен. */

var SHARED_SWAPS_URL = "";
var FIREBASE_API_KEY = "";
var TELEGRAM_BOT_NAME = "";
var TELEGRAM_BOT_ID = "8818826617";
var TELEGRAM_BOT_TOKEN_SHA256 = "";
