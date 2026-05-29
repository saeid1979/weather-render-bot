# Weather Render Bot - Broadcast Results Fix

این نسخه بخش ارسال همگانی را اصلاح می‌کند و بعد از ارسال، نتیجه را برای هر کاربر جدا نشان می‌دهد:

- ✅ Sent
- ❌ Blocked or not started
- ❌ Chat not found / Bad request

## Deploy

```bash
cd H:\weather-render-bot
npm install
git add .
git commit -m "fix broadcast result per user"
git push
```

بعد از Live شدن در Render:

```text
https://weather-render-bot.onrender.com/api/set-webhook
```

## Environment variables

```env
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=74774761
PUBLIC_URL=https://weather-render-bot.onrender.com
ADMIN_PASSWORD=your_password
TIMEZONE=Europe/Madrid
RAIN_THRESHOLD=50
ENABLE_INTERNAL_CRON=true
```
