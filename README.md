# Weather Render Telegram Bot - Full Admin Panel

قابلیت‌ها:

- انتخاب شهر از داخل تلگرام
- گزارش تصویری PNG
- گزارش روزانه خودکار
- هشدار فوری Real-Time Alert
- خلاصه هوشمند AI-like
- تنظیم ساعت ارسال با `/settime 08:00`
- پنل مدیریت وب
- افزودن/حذف/ویرایش شهر
- تنظیم حد هشدارها
- مشاهده کاربران تلگرام
- مشاهده و پاک کردن لاگ‌ها

## Render Environment Variables

در Render بخش Environment این موارد را وارد کنید:

```env
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
ADMIN_PASSWORD=your_admin_password
```

## Build / Start

```text
Build Command: npm install
Start Command: npm start
```

## فعال‌سازی Webhook

بعد از Deploy این لینک را باز کنید:

```text
https://weather-render-bot.onrender.com/api/set-webhook
```

## پنل مدیریت

```text
https://weather-render-bot.onrender.com
```

با مقدار `ADMIN_PASSWORD` وارد شوید.

## دستورات تلگرام

```text
/start
/menu
/weather madrid
/chart tehran
/all
/settings
/settime 08:00
/admin
```

## نکته امنیتی

فایل `.env` نباید در GitHub باشد. اگر قبلاً commit شده، اجرا کنید:

```bash
git rm --cached .env
git commit -m "remove env file"
git push
```
