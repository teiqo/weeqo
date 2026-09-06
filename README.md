# weeqo — расписание занятий

<img width="1920" height="945" alt="image" src="https://github.com/user-attachments/assets/738e1ac4-d8c7-49b2-b2ea-34fc1123014e" />

<b>PWA с расписанием колледжа:</b> мне было скучно и я решил сделать приложение для просмотра расписания пар / расписания звонков / удобных замен с модерацией / систему уведомлений о изменений в парах / просмотра текущей пары и тдтд.
у меня не было денег и поэтому этот репозиторий это и есть хостинг лол, облако — Firebase Realtime Database (для замен пар ну и там еще чето есть)

## структура

| путь | что это? |
| --- | --- |
| `index.html` | единственная страница приложения |
| `js/app.js` | приложение |
| `js/schedule.js` | работа с данными расписания |
| `js/config.js` | генерируется <b>github actions</b> при деплое — руками не править и не коммитить значения (в env добавлять) |
| `css/patch.css` | ручные правки поверх собранных стилей |
| `assets/` | собранные стили и шрифт |
| `images/` | иконки |
| `data/schedule.json` | расписание — обновляет бот, руками не трогать |
| `data/changelog.json` | журнал изменений расписания |
| `tools/update_schedule.py` | парсер PDF с сайта колледжа (cron каждые 3 часа) (это было сложно) |
| `tools/notify_telegram.py` | рассылка уведомлений в <b>telegram</b> |
| `tools/bot-hash.html` | локальный калькулятор sha256 токена бота |
| `firebase-rules.json` | правила Realtime Database — публикуются руками в Firebase Console |
| `.github/workflows/` | `deploy-pages.yml` — деплой сайта, `update-schedule.yml` — парсер по расписанию, `notify-telegram.yml` — уведомления |

## настройка (settings → secrets and variables → actions)

workflow читает каждое значение из обеих вкладок — variables и secrets.

| имя | что |
| --- | --- |
| `SHARED_SWAPS_URL` | URL Realtime Database + `/weeqo-swaps.json` |
| `FIREBASE_API_KEY` | ключ веб-приложения Firebase |
| `TELEGRAM_BOT_NAME` | username бота без @ |
| `TELEGRAM_BOT_ID` | Client ID из BotFather → Login Widget |
| `TELEGRAM_BOT_TOKEN_SHA256` | sha256 токена бота (посчитать через `tools/bot-hash.html`), нужен старому виджету |
| `TELEGRAM_OWNER_ID` | telegram id владельца — необязательно |
| `TELEGRAM_ADMIN_IDS` | telegram id редакторов через запятую — необязательно |

## firebase

1. Создай Realtime Database и скопируй её URL в `SHARED_SWAPS_URL`.
2. Опубликуй правила из `firebase-rules.json` (Realtime Database → Правила).
3. Включи Anonymous в Authentication → Sign-in method.

## telegram

BotFather (мини-апп) → выбрать бота → login widget → в allowed URLs добавить `https://<твой>.github.io` → скопировать client ID в `TELEGRAM_BOT_ID`.

## деплой и обновления

- Любой пуш пересобирает `js/config.js` и деплоит сайт на Pages.
- `update-schedule` ходит за PDF каждые 3 часа (cron по UTC). запуск вручную: actions → update-schedule → Run workflow.
- при изменениях фронта поднимай версию кэша в `sw.js` (`weeqo-groups-vXX`) — иначе клиенты останутся на старом коде из кэша.

- очень сильно вдохновился - https://csu.noteven.dev/
