# Weather Render Bot - Multi-Bot + Multi-User

این نسخه از چند بات تلگرام همزمان پشتیبانی می‌کند. هر کاربر علاوه بر `chatId` یک `botKey` دارد، بنابراین اگر یک Chat ID مربوط به بات دوم باشد، پیام با توکن همان بات دوم ارسال می‌شود.

## قابلیت‌های مهم

- چند بات با چند Bot Token
- Webhook جدا برای هر بات
- ثبت خودکار کاربر با `/start` در همان باتی که پیام داده است
- ذخیره `botKey + chatId` برای هر کاربر
- ارسال همگانی به همه بات‌ها یا فقط یک بات خاص
- نمایش نتیجه ارسال برای هر کاربر: ارسال شد، Block/Not Started، Chat Not Found
- پشتیبانی زبان فارسی، اسپانیایی و عربی
- پنل مدیریت کاربران، شهرها، لاگ‌ها، هشدارها و تنظیمات
- نقشه زنده و گزارش دستی از لحظه درخواست تا 24:00

## Render Environment Variables

```env
TELEGRAM_BOT_TOKEN=توکن_بات_اصلی
TELEGRAM_CHAT_ID=چت_آیدی_ادمین_در_بات_اصلی
BOT_TOKEN_SECOND=توکن_بات_دوم
BOT_TOKEN_RESTAURANT=توکن_بات_سوم_اختیاری
DEFAULT_BOT_KEY=main
PUBLIC_URL=https://weather-render-bot.onrender.com
TIMEZONE=Europe/Madrid
RAIN_THRESHOLD=50
ENABLE_INTERNAL_CRON=true
ADMIN_PASSWORD=رمز_پنل
```

روش JSON هم پشتیبانی می‌شود:

```env
BOT_TOKENS_JSON={"main":"token1","second":"token2"}
```

## Deploy

Build Command:

```bash
npm install
```

Start Command:

```bash
npm start
```

بعد از Deploy این لینک را باز کن تا Webhook همه بات‌ها تنظیم شود:

```text
https://weather-render-bot.onrender.com/api/set-webhook
```

اگر درست باشد، خروجی شامل چند webhook مثل این می‌شود:

```text
/webhook/main
/webhook/second
```

## دستورات تلگرام

```text
/start
/menu
/chatid
/mybot
/weather madrid
/chart tehran
/all
/setcity madrid
/settime 08:00
/setrain 50
/lang fa
/lang es
/lang ar
/adduser 914709600 ar second
/broadcast پیام تست
```

## نکته مهم

هر کاربر باید در همان باتی که قرار است از آن پیام بگیرد `/start` بزند. اگر کاربر در بات دوم `/start` زده باشد، باید با `botKey=second` ذخیره شود.

## آخرین اصلاحات این نسخه

- پشتیبانی زبان پیش‌فرض هر کاربر: وقتی کاربر با `/language` یا دکمه زبان، زبان خود را انتخاب کند، مقدار `language` در `users.json` ذخیره می‌شود و گزارش‌ها، منو و پیام‌های بعدی با همان زبان ارسال می‌شوند.
- اصلاح Broadcast برای Multi-Bot: ارسال همگانی برای هر کاربر با `botKey` خودش انجام می‌شود؛ برای `main` از `TELEGRAM_BOT_TOKEN` و برای `second` از `BOT_TOKEN_SECOND` استفاده می‌شود.
- اضافه شدن دو شهر جدید به لیست پیش‌فرض، منوی تلگرام، نقشه و پنل:
  - Nouakchott, Mauritania
  - Bordeaux, France

### نمونه دستورات شهرهای جدید

```text
/weather nouakchott
/weather bordeaux
/chart nouakchott
/chart bordeaux
/setcity nouakchott
/setcity bordeaux
```
