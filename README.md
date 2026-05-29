# Weather Render Bot

## Render settings

Build Command:

```bash
npm install
```

Start Command:

```bash
npm start
```

## Environment Variables

```env
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
PUBLIC_URL=https://weather-render-bot.onrender.com
TIMEZONE=Europe/Madrid
RAIN_THRESHOLD=50
ENABLE_INTERNAL_CRON=true
UV_WARNING=7
WIND_WARNING_KMH=45
```

## Telegram commands

```text
/start
/menu
/weather madrid
/chart tehran
/all
```

## Useful URLs

```text
/api/set-webhook
/api/webhook-info
/api/report-preview?city=madrid
/api/chart?city=madrid
/api/send-telegram?city=madrid
```
