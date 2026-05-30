# Weather Render Bot - Fixed Multi-Bot Broadcast + Daily Scheduler

## Important Render Environment Variables

Required:

```env
TELEGRAM_BOT_TOKEN=MAIN_BOT_TOKEN_FROM_BOTFATHER
TELEGRAM_CHAT_ID=74774761
BOT_TOKEN_SECOND=SECOND_BOT_TOKEN_FROM_BOTFATHER
DEFAULT_BOT_KEY=main
PUBLIC_URL=https://weather-render-bot.onrender.com
ADMIN_PASSWORD=YOUR_ADMIN_PASSWORD
TIMEZONE=Europe/Madrid
RAIN_THRESHOLD=50
ENABLE_INTERNAL_CRON=true
```

Optional but recommended for reliable scheduled sending on Render Free:

```env
CRON_SECRET=make_a_random_secret
```

Then create an external cron-job.org job to open this URL every 1 minute or every 5 minutes:

```text
https://weather-render-bot.onrender.com/api/cron/tick?secret=YOUR_CRON_SECRET
```

Why: Render Free Web Services can sleep when inactive, so internal node-cron may not run while the app is sleeping.

## After deploy

Open:

```text
https://weather-render-bot.onrender.com/api/set-webhook
```

## Test users

In each bot account:

```text
/start
/chatid
/mybot
```

## Admin Panel Tests

Use:

- Broadcast: sends custom message to all active users using each user's botKey.
- تست ارسال: sends a direct test message to a selected user.
- ارسال گزارش دستی: sends daily weather report manually to all active users.


## Forecast model selection update

This version automatically selects the forecast model source:

- European cities such as Salamanca, Madrid and Bordeaux use ECMWF IFS through Open-Meteo's `models` parameter.
- Non-European cities such as Tehran, Ardabil and Nouakchott use NOAA GFS through Open-Meteo's `models` parameter.
- If a selected model is temporarily unavailable or does not return a required variable, the app automatically falls back to Open-Meteo Best Match so Telegram responses do not fail.

Optional Render environment variables:

```env
ECMWF_MODEL=ecmwf_ifs025
GFS_MODEL=gfs_seamless
```

Admin diagnostic endpoint:

```text
/api/admin/forecast-models
```

The Telegram report now includes a line like:

```text
🛰 Model: ECMWF IFS 0.25°
```

or:

```text
🛰 Model: NOAA GFS Seamless
```
