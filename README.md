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


## Click anywhere on map
در صفحه `/map` علاوه بر چهار شهر ثبت‌شده، با کلیک روی هر نقطه از نقشه، مختصات همان نقطه خوانده می‌شود و گزارش آب‌وهوا، بارندگی، باد، UV و AQI نمایش داده می‌شود.

## Update: manual Telegram report range

Manual Telegram requests now use a dynamic time range:

- `/weather madrid`
- `/chart tehran`
- `/all`
- city buttons in `/menu`
- chart buttons in `/menu`
- manual send from admin panel

These requests calculate weather from the current hour in `TIMEZONE` until 24:00 of the same day.

The automatic daily report still uses the scheduled daily report logic and checks the day from 08:00 to 24:00.

Examples:

- If the user asks at 11:20, the bot checks 11:00 to 24:00.
- If the user asks at 18:45, the bot checks 18:00 to 24:00.
