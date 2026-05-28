require('dotenv').config();

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 10000;
const TIMEZONE = process.env.TIMEZONE || 'Europe/Madrid';
const RAIN_THRESHOLD = Number(process.env.RAIN_THRESHOLD || 50);
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEFAULT_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const CRON_SECRET = process.env.CRON_SECRET || 'change-this-secret-key';
const ENABLE_INTERNAL_CRON = String(process.env.ENABLE_INTERNAL_CRON || 'true').toLowerCase() === 'true';

const CITIES = {
  salamanca: { key: 'salamanca', fa: 'سالامانکا', en: 'Salamanca, Spain', lat: 40.9701, lon: -5.6635 },
  madrid: { key: 'madrid', fa: 'مادرید', en: 'Madrid, Spain', lat: 40.4168, lon: -3.7038 },
  tehran: { key: 'tehran', fa: 'تهران', en: 'Tehran, Iran', lat: 35.6892, lon: 51.3890 },
  ardabil: { key: 'ardabil', fa: 'اردبیل', en: 'Ardabil, Iran', lat: 38.2498, lon: 48.2933 }
};

function cityByInput(input = '') {
  const value = String(input).trim().toLowerCase();
  return CITIES[value] || Object.values(CITIES).find(c =>
    c.en.toLowerCase().includes(value) || c.fa.includes(value)
  );
}

function todayISOForMadrid() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date()).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatHour(iso) {
  return new Intl.DateTimeFormat('fa-IR', {
    timeZone: TIMEZONE,
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(iso));
}

async function getWeather(cityKey) {
  const city = typeof cityKey === 'string' ? cityByInput(cityKey) : cityKey;
  if (!city) throw new Error('City not found');

  const hourlyParams = [
    'temperature_2m',
    'apparent_temperature',
    'relative_humidity_2m',
    'precipitation_probability',
    'wind_speed_10m',
    'uv_index',
    'weather_code'
  ].join(',');

  const dailyParams = [
    'temperature_2m_max',
    'temperature_2m_min',
    'precipitation_probability_max',
    'sunrise',
    'sunset',
    'uv_index_max',
    'wind_speed_10m_max'
  ].join(',');

  const forecastUrl = 'https://api.open-meteo.com/v1/forecast';
  const airUrl = 'https://air-quality-api.open-meteo.com/v1/air-quality';

  const [forecastRes, airRes] = await Promise.all([
    axios.get(forecastUrl, {
      params: {
        latitude: city.lat,
        longitude: city.lon,
        hourly: hourlyParams,
        daily: dailyParams,
        timezone: TIMEZONE,
        forecast_days: 1
      }
    }),
    axios.get(airUrl, {
      params: {
        latitude: city.lat,
        longitude: city.lon,
        hourly: 'european_aqi,pm10,pm2_5',
        timezone: TIMEZONE,
        forecast_days: 1
      }
    }).catch(() => ({ data: null }))
  ]);

  const data = forecastRes.data;
  const air = airRes.data;
  const targetDate = todayISOForMadrid();

  const hours = data.hourly.time.map((t, i) => ({
    time: t,
    hour: Number(t.slice(11, 13)),
    temperature: data.hourly.temperature_2m[i],
    feelsLike: data.hourly.apparent_temperature[i],
    humidity: data.hourly.relative_humidity_2m[i],
    rain: data.hourly.precipitation_probability[i],
    wind: data.hourly.wind_speed_10m[i],
    uv: data.hourly.uv_index[i],
    code: data.hourly.weather_code[i],
    aqi: air?.hourly?.european_aqi?.[i] ?? null,
    pm25: air?.hourly?.pm2_5?.[i] ?? null,
    pm10: air?.hourly?.pm10?.[i] ?? null
  })).filter(x => x.time.startsWith(targetDate) && x.hour >= 8 && x.hour <= 23);

  const rainHighHours = hours.filter(h => Number(h.rain) >= RAIN_THRESHOLD);
  const maxRain = Math.max(...hours.map(h => Number(h.rain || 0)));
  const maxWind = Math.max(...hours.map(h => Number(h.wind || 0)));
  const maxUv = Math.max(...hours.map(h => Number(h.uv || 0)));
  const avgHumidity = Math.round(hours.reduce((s, h) => s + Number(h.humidity || 0), 0) / Math.max(hours.length, 1));
  const avgAqiValues = hours.map(h => h.aqi).filter(v => v !== null && v !== undefined);
  const avgAqi = avgAqiValues.length ? Math.round(avgAqiValues.reduce((a, b) => a + b, 0) / avgAqiValues.length) : null;

  return {
    city,
    date: targetDate,
    daily: {
      maxTemp: data.daily.temperature_2m_max[0],
      minTemp: data.daily.temperature_2m_min[0],
      maxRain: data.daily.precipitation_probability_max[0],
      sunrise: data.daily.sunrise[0]?.slice(11, 16),
      sunset: data.daily.sunset[0]?.slice(11, 16),
      maxUv: data.daily.uv_index_max[0],
      maxWind: data.daily.wind_speed_10m_max[0]
    },
    hours,
    summary: { rainHighHours, maxRain, maxWind, maxUv, avgHumidity, avgAqi }
  };
}

function buildTextReport(weather) {
  const { city, date, daily, summary } = weather;
  const rainLines = summary.rainHighHours.length
    ? summary.rainHighHours.map(h => `⏰ ${h.time.slice(11, 16)} → ${h.rain}%`).join('\n')
    : '✅ از ساعت 08:00 تا 24:00 احتمال بارندگی بالای حد تعیین‌شده دیده نشد.';

  const alerts = [];
  if (summary.maxRain >= RAIN_THRESHOLD) alerts.push(`🌧 احتمال بارندگی بالا: ${summary.maxRain}%`);
  if (summary.maxWind >= 45) alerts.push(`💨 باد نسبتاً شدید: ${Math.round(summary.maxWind)} km/h`);
  if (summary.maxUv >= 7) alerts.push(`☀️ UV بالا: ${summary.maxUv}`);
  if (summary.avgAqi && summary.avgAqi >= 100) alerts.push(`😷 کیفیت هوا نامناسب: AQI ${summary.avgAqi}`);

  const advice = [];
  if (summary.maxRain >= RAIN_THRESHOLD) advice.push('☂ چتر همراه داشته باشید.');
  if (summary.maxWind >= 45) advice.push('🏍 برای موتور یا دوچرخه احتیاط کنید.');
  if (summary.maxUv >= 7) advice.push('🧴 ضدآفتاب و عینک آفتابی مفید است.');
  if (!advice.length) advice.push('✅ شرایط کلی امروز عادی است.');

  return `🌤 گزارش هوشمند آب‌وهوا\n📍 ${city.fa} - ${city.en}\n📅 تاریخ: ${date}\n⏱ بازه بررسی: 08:00 تا 24:00\n\n🌡 دما: ${daily.minTemp}°C تا ${daily.maxTemp}°C\n🥵 دمای محسوس، رطوبت و باد به‌صورت ساعتی بررسی شدند.\n💧 میانگین رطوبت: ${summary.avgHumidity}%\n💨 بیشترین باد: ${Math.round(summary.maxWind)} km/h\n☀️ بیشترین UV: ${summary.maxUv}\n🌅 طلوع: ${daily.sunrise || '-'}\n🌇 غروب: ${daily.sunset || '-'}\n😷 میانگین کیفیت هوا: ${summary.avgAqi ?? 'نامشخص'}\n\n🌧 ساعت‌های احتمال بارندگی بالای ${RAIN_THRESHOLD}%:\n${rainLines}\n\n${alerts.length ? '⚠️ هشدارها:\n' + alerts.join('\n') : '✅ هشدار جدی ثبت نشد.'}\n\n📌 پیشنهاد امروز:\n${advice.join('\n')}`;
}

function quickChartUrl(weather) {
  const labels = weather.hours.map(h => h.time.slice(11, 16));
  const temps = weather.hours.map(h => h.temperature);
  const rain = weather.hours.map(h => h.rain);
  const wind = weather.hours.map(h => h.wind);
  const chart = {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Temp °C', data: temps, borderColor: 'red', fill: false },
        { label: 'Rain %', data: rain, borderColor: 'blue', fill: false },
        { label: 'Wind km/h', data: wind, borderColor: 'green', fill: false }
      ]
    },
    options: {
      title: { display: true, text: `${weather.city.en} | 08:00-24:00` },
      legend: { position: 'bottom' },
      scales: { yAxes: [{ ticks: { beginAtZero: true } }] }
    }
  };
  return `https://quickchart.io/chart?width=900&height=500&c=${encodeURIComponent(JSON.stringify(chart))}`;
}

async function telegram(method, payload) {
  if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is missing');
  const url = `https://api.telegram.org/bot${TOKEN}/${method}`;
  const res = await axios.post(url, payload);
  return res.data;
}

function menuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🌤 Salamanca', callback_data: 'weather:salamanca' },
        { text: '🌤 Madrid', callback_data: 'weather:madrid' }
      ],
      [
        { text: '🌤 Tehran', callback_data: 'weather:tehran' },
        { text: '🌤 Ardabil', callback_data: 'weather:ardabil' }
      ],
      [
        { text: '📊 Chart Salamanca', callback_data: 'chart:salamanca' },
        { text: '📊 Chart Madrid', callback_data: 'chart:madrid' }
      ],
      [
        { text: '🌍 گزارش همه شهرها', callback_data: 'all' }
      ]
    ]
  };
}

async function sendCityReport(chatId, cityKey, withChart = true) {
  const weather = await getWeather(cityKey);
  await telegram('sendMessage', {
    chat_id: chatId,
    text: buildTextReport(weather),
    reply_markup: menuKeyboard()
  });
  if (withChart) {
    await telegram('sendPhoto', {
      chat_id: chatId,
      photo: quickChartUrl(weather),
      caption: `📊 نمودار دما، بارندگی و باد برای ${weather.city.fa}`
    });
  }
}

async function sendAllReports(chatId = DEFAULT_CHAT_ID, withChart = false) {
  for (const key of Object.keys(CITIES)) {
    await sendCityReport(chatId, key, withChart);
  }
}

app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.get('/api/report-preview', async (req, res) => {
  try {
    const city = req.query.city || 'salamanca';
    const weather = await getWeather(city);
    res.type('text/plain').send(buildTextReport(weather));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/chart', async (req, res) => {
  try {
    const city = req.query.city || 'salamanca';
    const weather = await getWeather(city);
    res.redirect(quickChartUrl(weather));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/send-telegram', async (req, res) => {
  try {
    const city = req.query.city;
    const chart = req.query.chart !== 'false';
    if (city) await sendCityReport(DEFAULT_CHAT_ID, city, chart);
    else await sendAllReports(DEFAULT_CHAT_ID, false);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/cron/daily', async (req, res) => {
  if (req.query.key !== CRON_SECRET) return res.status(403).json({ ok: false, error: 'Forbidden' });
  try {
    await sendAllReports(DEFAULT_CHAT_ID, false);
    res.json({ ok: true, message: 'Daily report sent' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/set-webhook', async (req, res) => {
  try {
    if (!PUBLIC_URL) throw new Error('PUBLIC_URL is missing');
    const webhookUrl = `${PUBLIC_URL}/telegram/webhook`;
    const result = await telegram('setWebhook', { url: webhookUrl });
    res.json({ ok: true, webhookUrl, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/telegram/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const update = req.body;
    if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = cb.message.chat.id;
      const [action, city] = String(cb.data || '').split(':');
      await telegram('answerCallbackQuery', { callback_query_id: cb.id });
      if (action === 'weather') await sendCityReport(chatId, city, false);
      else if (action === 'chart') await sendCityReport(chatId, city, true);
      else if (action === 'all') await sendAllReports(chatId, false);
      return;
    }

    const msg = update.message;
    if (!msg || !msg.chat) return;
    const chatId = msg.chat.id;
    const text = String(msg.text || '').trim();
    const [cmd, arg] = text.split(/\s+/);

    if (cmd === '/start' || cmd === '/menu') {
      await telegram('sendMessage', {
        chat_id: chatId,
        text: 'سلام 👋\nاز منوی زیر شهر را انتخاب کنید یا دستور بفرستید:\n/weather madrid\n/chart tehran\n/all',
        reply_markup: menuKeyboard()
      });
    } else if (cmd === '/weather') {
      await sendCityReport(chatId, arg || 'salamanca', false);
    } else if (cmd === '/chart') {
      await sendCityReport(chatId, arg || 'salamanca', true);
    } else if (cmd === '/all') {
      await sendAllReports(chatId, false);
    } else {
      await telegram('sendMessage', {
        chat_id: chatId,
        text: 'دستور نامعتبر است. /menu را بفرستید.',
        reply_markup: menuKeyboard()
      });
    }
  } catch (e) {
    console.error('Webhook error:', e.message);
  }
});

if (ENABLE_INTERNAL_CRON) {
  cron.schedule('0 8 * * *', async () => {
    try {
      console.log('Running internal daily cron...');
      await sendAllReports(DEFAULT_CHAT_ID, false);
    } catch (e) {
      console.error('Internal cron error:', e.message);
    }
  }, { timezone: TIMEZONE });
}

app.listen(PORT, () => {
  console.log(`Weather Telegram Bot is running on port ${PORT}`);
});
