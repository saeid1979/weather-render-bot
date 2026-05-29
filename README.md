# Weather Render Bot - Multi User + Spanish/Arabic

قابلیت‌های این نسخه:

- ثبت خودکار کاربر با `/start`
- اضافه کردن کاربر از پنل مدیریت وب
- اضافه کردن کاربر از تلگرام با `/adduser`
- غیرفعال کردن کاربر با `/removeuser`
- تنظیم زبان کاربر: فارسی، اسپانیایی، عربی
- تنظیم شهر پیش‌فرض هر کاربر
- تنظیم ساعت ارسال روزانه برای هر کاربر
- تنظیم حد هشدار بارندگی برای هر کاربر
- ارسال همگانی Broadcast به همه کاربران فعال
- ارسال گزارش روزانه چندکاربره به‌صورت خودکار
- گزارش دستی از ساعت فعلی تا 24:00 همان روز
- نقشه زنده و کلیک روی هر نقطه برای دریافت آب‌وهوا
- پنل مدیریت کاربران، شهرها، لاگ‌ها، هشدارها و تنظیمات

## Render Environment Variables

```env
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_admin_chat_id
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

## Telegram User Commands

```text
/start
/menu
/help
/map
/weather madrid
/chart tehran
/all
/setcity madrid
/settime 08:00
/setrain 50
/lang fa
/lang es
/lang ar
/mysettings
```

## Telegram Admin Commands

Only admin chat id can use these commands. Admin is the `TELEGRAM_CHAT_ID` user.

```text
/adduser 123456789 es
/removeuser 123456789
/broadcast متن پیام برای همه کاربران
```

## Languages

- Persian: `/lang fa`
- Spanish: `/lang es`
- Arabic: `/lang ar`

The bot will send weather reports, settings messages, menu labels and AI summaries in the user's selected language.

## Multi-user daily reports

Each active user has their own:

- `city`
- `sendTime`
- `language`
- `rainThreshold`

The scheduler checks every minute and sends the daily report to users whose configured time has arrived.
