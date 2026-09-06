# weeqo — расписание занятий

PWA с расписанием колледжа: мне было скучно и я решил сделать приложение для просмотра расписания пар/расписания звонков/удобных замен с модерацией/систему уведомлений о изменений в парах/просмотра текущей пары и тдтд.
у меня не было денег и поэтому этот репозиторий это и есть хостинг лол, облако — Firebase Realtime Database (для замен пар ну и там еще чето есть)

## структура

| Путь | Что это |
| --- | --- |
| `index.html` | единственная страница приложения |
| `js/app.js` | приложение |
| `js/schedule.js` | работа с данными расписания |
| `js/config.js` | генерируется Action-ом при деплое — руками не править и не коммитить значения |
| `css/patch.css` | ручные правки поверх собранных стилей |
| `assets/` | собранные стили и шрифт |
| `images/` | иконки |
| `data/schedule.json` | расписание — обновляет бот, руками не трогать |
| `data/changelog.json` | журнал изменений расписания |
| `tools/update_schedule.py` | парсер PDF с сайта колледжа (cron каждые 3 часа) |
| `tools/notify_telegram.py` | рассылка уведомлений в Telegram |
| `tools/bot-hash.html` | локальный калькулятор sha256 токена бота |
| `firebase-rules.json` | правила Realtime Database — публикуются руками в Firebase Console |
| `.github/workflows/` | `deploy-pages.yml` — деплой сайта, `update-schedule.yml` — парсер по расписанию, `notify-telegram.yml` — уведомления |

## Настройка (Settings → Secrets and variables → Actions)

Workflow читает каждое значение из обеих вкладок — Variables и Secrets.

| Имя | Что |
| --- | --- |
| `SHARED_SWAPS_URL` | URL Realtime Database + `/weeqo-swaps.json` |
| `FIREBASE_API_KEY` | ключ веб-приложения Firebase |
| `TELEGRAM_BOT_NAME` | username бота без @ |
| `TELEGRAM_BOT_ID` | Client ID из BotFather → Login Widget |
| `TELEGRAM_BOT_TOKEN_SHA256` | sha256 токена бота (посчитать через `tools/bot-hash.html`), нужен старому виджету |
| `TELEGRAM_OWNER_ID` | telegram id владельца — необязательно |
| `TELEGRAM_ADMIN_IDS` | telegram id редакторов через запятую — необязательно |

## Firebase

1. Создай Realtime Database и скопируй её URL в `SHARED_SWAPS_URL`.
2. Опубликуй правила из `firebase-rules.json` (Realtime Database → Правила).
3. Включи Anonymous в Authentication → Sign-in method.

## Telegram

BotFather (мини-апп) → выбрать бота → Login Widget → в Allowed URLs добавить `https://<твой>.github.io` → скопировать Client ID в `TELEGRAM_BOT_ID`.

## Деплой и обновления

- Любой пуш пересобирает `js/config.js` и деплоит сайт на Pages.
- `update-schedule` ходит за PDF каждые 3 часа (cron по UTC). Запуск вручную: Actions → update-schedule → Run workflow.
- При изменениях фронта поднимай версию кэша в `sw.js` (`weeqo-groups-vXX`) — иначе клиенты останутся на старом коде из кэша.
