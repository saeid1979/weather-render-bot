# Weather Telegram Bot for Render

## Features
- Daily weather report at 08:00 Europe/Madrid
- Telegram bot menu buttons
- /weather city
- /chart city
- /all
- Rain probability alerts above threshold
- Temperature, apparent temperature, humidity, wind, UV, sunrise/sunset, air quality
- Chart image sent to Telegram using QuickChart

## Cities
- salamanca
- madrid
- tehran
- ardabil

## Local run
```bash
npm install
cp .env.example .env
npm start
```

## Render environment variables
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
PUBLIC_URL
TIMEZONE
RAIN_THRESHOLD
CRON_SECRET
ENABLE_INTERNAL_CRON

## After deploy
Open:
https://YOUR-RENDER-URL/api/set-webhook

Test:
https://YOUR-RENDER-URL/api/send-telegram?city=madrid
https://YOUR-RENDER-URL/api/report-preview?city=salamanca
https://YOUR-RENDER-URL/api/chart?city=tehran

## Telegram commands
/start
/menu
/weather madrid
/chart tehran
/all
