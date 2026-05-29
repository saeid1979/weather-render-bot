# Weather Render Bot + Full Admin Panel + Live Map

قابلیت‌ها:
- بات تلگرام با دکمه‌های انتخاب شهر
- گزارش متنی آب‌وهوا
- نمودار تصویری PNG
- هشدار فوری هر ۳۰ دقیقه
- خلاصه هوشمند AI-like
- تنظیم ساعت ارسال روزانه با `/settime 08:00`
- پنل مدیریت وب
- نقشه زنده آب‌وهوا در `/map`

## Render Environment Variables

```env
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
PUBLIC_URL=https://weather-render-bot.onrender.com
TIMEZONE=Europe/Madrid
RAIN_THRESHOLD=50
ENABLE_INTERNAL_CRON=true
ADMIN_PASSWORD=your_admin_password
```

## Render Commands

Build Command:
```bash
npm install
```

Start Command:
```bash
npm start
```

## After Deploy

Set webhook:
```text
https://weather-render-bot.onrender.com/api/set-webhook
```

Admin panel:
```text
https://weather-render-bot.onrender.com
```

Live map:
```text
https://weather-render-bot.onrender.com/map
```

Telegram commands:
```text
/start
/menu
/map
/weather madrid
/chart tehran
/all
/settime 08:00
/settings
```
