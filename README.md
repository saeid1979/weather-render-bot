# Weather Render Telegram Bot - AI Admin Version

Features:
- Real-time alerts every 30 minutes
- Daily weather report at custom time
- AI-like smart summary without paid API
- Telegram city buttons and chart buttons
- `/settime 07:30` command from Telegram
- Web admin panel
- Open-Meteo Weather + Air Quality
- Render-ready

## Render Environment Variables

TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
PUBLIC_URL=https://weather-render-bot.onrender.com
TIMEZONE=Europe/Madrid
RAIN_THRESHOLD=50
WIND_WARNING_KMH=55
UV_WARNING=7
HEAT_WARNING_C=35
COLD_WARNING_C=0
ENABLE_INTERNAL_CRON=true
ADMIN_PASSWORD=change-this-password

## Commands

/start
/menu
/weather madrid
/chart tehran
/all
/settings
/settime 07:30

## Admin Panel

https://weather-render-bot.onrender.com

Use ADMIN_PASSWORD to login.

## Webhook

Open once after deployment:

https://weather-render-bot.onrender.com/api/set-webhook
