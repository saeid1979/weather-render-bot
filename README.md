# Weather Render Bot - Multi Bot + Multi Language + Admin Panel

این نسخه شامل این اصلاحات است:

- پشتیبانی Multi-Bot با `main`, `second`, و هر Bot Key دلخواه
- ارسال همگانی واقعی به همه کاربران فعال، با توکن همان بات کاربر
- نمایش نتیجه ارسال برای هر کاربر در پنل: sent, invalid token, blocked, chat not found
- ذخیره دائمی زبان انتخابی هر کاربر
- دکمه انتخاب زبان در `/menu` و دستور `/language`
- ثبت خودکار کاربر با `/start`
- پنل مدیریت کاربران، شهرها، تنظیمات، لاگ‌ها و Broadcast
- گزارش دستی از ساعت فعلی تا 24:00
- نقشه زنده و کلیک روی هر نقطه برای دریافت آب‌وهوا

## نصب روی سیستم خودت

```bash
cd H:\weather-render-bot
npm install
npm start
```

## آپلود تغییرات به GitHub

بعد از جایگزینی فایل‌ها:

```bash
cd H:\weather-render-bot
npm install
git add .
git commit -m "final multibot language broadcast fix"
git push
```

## تنظیمات Render Environment

در Render مسیر زیر را باز کن:

`weather-render-bot -> Environment`

حداقل این متغیرها باید وجود داشته باشند:

```env
TELEGRAM_BOT_TOKEN=توکن_بات_اصلی_از_BotFather
TELEGRAM_CHAT_ID=74774761
BOT_TOKEN_SECOND=توکن_بات_دوم_از_BotFather
DEFAULT_BOT_KEY=main
PUBLIC_URL=https://weather-render-bot.onrender.com
TIMEZONE=Europe/Madrid
RAIN_THRESHOLD=50
ADMIN_PASSWORD=رمز_پنل_مدیریت
ENABLE_INTERNAL_CRON=true
```

نکته مهم: `BOT_TOKEN_SECOND` باید توکن کامل بات دوم باشد، نه Chat ID.

بعد از تغییر Environment Variables:

`Manual Deploy -> Clear build cache & deploy`

## فعال‌سازی Webhook برای همه بات‌ها

بعد از Live شدن Render این آدرس را باز کن:

```text
https://weather-render-bot.onrender.com/api/set-webhook
```

باید نتیجه‌ای شامل `main` و `second` ببینی.

## دستورهای تلگرام

```text
/start
/menu
/language
/lang fa
/lang es
/lang ar
/chatid
/mybot
/mysettings
/weather madrid
/chart tehran
/all
/setcity madrid
/settime 08:00
/setrain 50
/broadcast سلام تست ارسال همگانی
/adduser CHAT_ID LANGUAGE BOT_KEY
```

مثال:

```text
/adduser 74774761 fa main
/adduser 7604417086 ar second
```

## آدرس‌ها

پنل مدیریت:

```text
https://weather-render-bot.onrender.com
```

نقشه زنده:

```text
https://weather-render-bot.onrender.com/map
```

سلامت سرور:

```text
https://weather-render-bot.onrender.com/api/health
```

وضعیت بات‌ها:

```text
https://weather-render-bot.onrender.com/api/bots
```

## نکته مهم درباره زبان

وقتی کاربر از طریق دکمه‌ها یا دستور زیر زبان را انتخاب کند:

```text
/lang es
```

یا:

```text
/language
```

زبان در فایل کاربران ذخیره می‌شود و از آن به بعد تمام پیام‌ها، گزارش‌ها و تنظیمات برای همان کاربر با همان زبان ارسال می‌شود.
