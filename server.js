require('dotenv').config();

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cron = require('node-cron');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEFAULT_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PUBLIC_URL = process.env.PUBLIC_URL;
const TIMEZONE = process.env.TIMEZONE || 'Europe/Madrid';
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const SETTINGS_PATH = path.join(__dirname, 'settings.json');
const CITIES_PATH = path.join(__dirname, 'cities.json');
const USERS_PATH = path.join(__dirname, 'users.json');
const LOGS_PATH = path.join(__dirname, 'logs.json');

const defaultSettings = {
  sendTime: '08:00',
  language: 'fa',
  rainThreshold: Number(process.env.RAIN_THRESHOLD || 50),
  windWarningKmh: Number(process.env.WIND_WARNING_KMH || 55),
  uvWarning: Number(process.env.UV_WARNING || 7),
  heatWarningC: Number(process.env.HEAT_WARNING_C || 35),
  coldWarningC: Number(process.env.COLD_WARNING_C || 0),
  realTimeAlerts: true,
  dailyReport: true,
  selectedCities: ['salamanca', 'madrid', 'tehran', 'ardabil'],
  alertCooldownMinutes: 120
};

const defaultCities = {
  salamanca: { key: 'salamanca', name: 'Salamanca, Spain', fa: 'سالامانکا، اسپانیا', lat: 40.9701, lon: -5.6635 },
  madrid: { key: 'madrid', name: 'Madrid, Spain', fa: 'مادرید، اسپانیا', lat: 40.4168, lon: -3.7038 },
  tehran: { key: 'tehran', name: 'Tehran, Iran', fa: 'تهران، ایران', lat: 35.6892, lon: 51.3890 },
  ardabil: { key: 'ardabil', name: 'Ardabil, Iran', fa: 'اردبیل، ایران', lat: 38.2498, lon: 48.2933 }
};

function clone(x) { return JSON.parse(JSON.stringify(x)); }
function loadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2));
      return clone(fallback);
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (Array.isArray(fallback)) return Array.isArray(parsed) ? parsed : clone(fallback);
    return { ...fallback, ...parsed };
  } catch (err) {
    console.error('JSON load error:', filePath, err.message);
    return clone(fallback);
  }
}
function saveJson(filePath, data) { fs.writeFileSync(filePath, JSON.stringify(data, null, 2)); }

let settings = loadJson(SETTINGS_PATH, defaultSettings);
let cities = loadJson(CITIES_PATH, defaultCities);
let users = loadJson(USERS_PATH, {});
let logs = loadJson(LOGS_PATH, []);

function saveSettings() { saveJson(SETTINGS_PATH, settings); }
function saveCities() { saveJson(CITIES_PATH, cities); }
function saveUsers() { saveJson(USERS_PATH, users); }
function saveLogs() { logs = logs.slice(-800); saveJson(LOGS_PATH, logs); }
function logEvent(type, message, meta = {}) {
  const item = { time: new Date().toISOString(), type, message, meta };
  logs.push(item); saveLogs();
  console.log(`[${type}] ${message}`, Object.keys(meta).length ? meta : '');
}
function recordUser(rawUser, chatId) {
  if (!chatId) return;
  const id = String(chatId);
  users[id] = {
    chatId: id,
    firstName: rawUser?.first_name || users[id]?.firstName || '',
    lastName: rawUser?.last_name || users[id]?.lastName || '',
    username: rawUser?.username || users[id]?.username || '',
    languageCode: rawUser?.language_code || users[id]?.languageCode || '',
    lastSeen: new Date().toISOString()
  };
  saveUsers();
}

function normalizeCityKey(input) {
  if (!input) return null;
  const raw = String(input).trim().toLowerCase();
  const aliases = {
    salamanca: 'salamanca', 'سالامانکا': 'salamanca',
    madrid: 'madrid', 'مادرید': 'madrid',
    tehran: 'tehran', 'تهران': 'tehran',
    ardabil: 'ardabil', ardebil: 'ardabil', 'اردبیل': 'ardabil'
  };
  return aliases[raw] || raw.replace(/\s+/g, '-');
}
function cityLabel(city) { return city.fa || city.name || city.key; }
function todayDateString() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function todayRangeIndexes(hourlyTimes) {
  const today = todayDateString();
  return (hourlyTimes || [])
    .map((t, idx) => ({ t, idx }))
    .filter(x => x.t.startsWith(today) && Number(x.t.slice(11, 13)) >= 8 && Number(x.t.slice(11, 13)) <= 23)
    .map(x => x.idx);
}
function hourLabel(iso) { return String(iso).slice(11, 16); }
function buildWeatherUrl(city) {
  return `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}` +
    `&hourly=temperature_2m,apparent_temperature,precipitation_probability,relative_humidity_2m,wind_speed_10m,uv_index` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,sunrise,sunset,wind_speed_10m_max` +
    `&timezone=${encodeURIComponent(TIMEZONE)}&forecast_days=2`;
}
function buildAirUrl(city) {
  return `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${city.lat}&longitude=${city.lon}` +
    `&hourly=us_aqi,pm10,pm2_5&timezone=${encodeURIComponent(TIMEZONE)}&forecast_days=2`;
}
async function fetchWeather(cityKey) {
  const key = normalizeCityKey(cityKey);
  const city = cities[key];
  if (!city) throw new Error('City not found');
  const [weatherRes, airRes] = await Promise.allSettled([
    axios.get(buildWeatherUrl(city), { timeout: 15000 }),
    axios.get(buildAirUrl(city), { timeout: 15000 })
  ]);
  if (weatherRes.status !== 'fulfilled') throw new Error('Weather API failed');
  return { city, weather: weatherRes.value.data, air: airRes.status === 'fulfilled' ? airRes.value.data : null };
}

async function fetchWeatherForPoint(lat, lon, label = 'Selected Location') {
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) throw new Error('Invalid coordinates');
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) throw new Error('Coordinates out of range');
  const city = {
    key: `point-${latitude.toFixed(4)}-${longitude.toFixed(4)}`,
    name: label,
    fa: label,
    lat: latitude,
    lon: longitude
  };
  const [weatherRes, airRes] = await Promise.allSettled([
    axios.get(buildWeatherUrl(city), { timeout: 15000 }),
    axios.get(buildAirUrl(city), { timeout: 15000 })
  ]);
  if (weatherRes.status !== 'fulfilled') throw new Error('Weather API failed');
  return { city, weather: weatherRes.value.data, air: airRes.status === 'fulfilled' ? airRes.value.data : null };
}

async function reverseGeocode(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=10&accept-language=fa,en`;
    const result = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'weather-render-bot/1.0 (Telegram weather assistant)' }
    });
    const a = result.data.address || {};
    return a.city || a.town || a.village || a.county || a.state || result.data.display_name || 'Selected Location';
  } catch (err) {
    return 'Selected Location';
  }
}
function avg(arr) { return arr.length ? Math.round(arr.reduce((a,b)=>a+b,0) / arr.length) : null; }
function max(arr) { return arr.length ? Math.max(...arr) : null; }
function min(arr) { return arr.length ? Math.min(...arr) : null; }
function analyzeWeather(city, weather, air) {
  const h = weather.hourly || {};
  const idxs = todayRangeIndexes(h.time || []);
  const values = (name) => idxs.map(i => h[name]?.[i]).filter(v => typeof v === 'number');
  const temps = values('temperature_2m');
  const apparent = values('apparent_temperature');
  const rain = values('precipitation_probability');
  const wind = values('wind_speed_10m');
  const uv = values('uv_index');
  const humidity = values('relative_humidity_2m');
  const rainHours = idxs.map(i => ({ time: h.time[i], value: h.precipitation_probability?.[i] }))
    .filter(x => typeof x.value === 'number' && x.value >= Number(settings.rainThreshold));
  const airValues = air?.hourly?.us_aqi ? idxs.map(i => air.hourly.us_aqi[i]).filter(v => typeof v === 'number') : [];
  const summary = {
    tempMax: max(temps), tempMin: min(temps), apparentMax: max(apparent), rainMax: max(rain), windMax: max(wind),
    uvMax: max(uv), humidityAvg: avg(humidity), aqiMax: max(airValues),
    sunrise: weather.daily?.sunrise?.[0]?.slice(11,16), sunset: weather.daily?.sunset?.[0]?.slice(11,16), rainHours
  };
  const alerts = [];
  if (summary.rainMax !== null && summary.rainMax >= settings.rainThreshold) alerts.push(`🌧 احتمال بارندگی بالا تا ${summary.rainMax}%`);
  if (summary.windMax !== null && summary.windMax >= settings.windWarningKmh) alerts.push(`💨 هشدار باد شدید: ${summary.windMax} km/h`);
  if (summary.uvMax !== null && summary.uvMax >= settings.uvWarning) alerts.push(`☀️ هشدار UV بالا: ${summary.uvMax}`);
  if (summary.tempMax !== null && summary.tempMax >= settings.heatWarningC) alerts.push(`🔥 هشدار گرما: ${summary.tempMax}°C`);
  if (summary.tempMin !== null && summary.tempMin <= settings.coldWarningC) alerts.push(`❄️ هشدار سرما: ${summary.tempMin}°C`);
  if (summary.aqiMax !== null && summary.aqiMax >= 101) alerts.push(`😷 کیفیت هوا ناسالم: AQI ${summary.aqiMax}`);
  return { summary, alerts };
}
function aiLikeSummary(city, summary, alerts) {
  const parts = [];
  const name = cityLabel(city);
  if (summary.rainMax >= settings.rainThreshold) parts.push(`در ${name} امروز احتمال بارندگی قابل توجه است و بهتر است چتر همراه داشته باشید.`);
  else parts.push(`در ${name} امروز احتمال بارندگی مهمی دیده نمی‌شود.`);
  if (summary.tempMax !== null && summary.tempMin !== null) parts.push(`بازه دما حدود ${summary.tempMin} تا ${summary.tempMax} درجه است.`);
  if (summary.windMax >= settings.windWarningKmh) parts.push(`باد می‌تواند شدید شود؛ برای موتور، دوچرخه و دلیوری احتیاط لازم است.`);
  if (summary.uvMax >= settings.uvWarning) parts.push(`شاخص UV بالاست؛ بهتر است در ساعات آفتابی از ضدآفتاب و کلاه استفاده شود.`);
  if (summary.aqiMax >= 101) parts.push(`کیفیت هوا برای افراد حساس مناسب نیست.`);
  if (!alerts.length) parts.push('شرایط کلی روز پایدار است.');
  return parts.join(' ');
}
function getStatus(summary, alerts) {
  if (alerts.some(a => a.includes('ناسالم') || a.includes('باد شدید') || a.includes('گرما'))) return 'danger';
  if (summary.rainMax >= settings.rainThreshold || alerts.length) return 'warning';
  return 'normal';
}
function formatReport(city, weather, air) {
  const { summary, alerts } = analyzeWeather(city, weather, air);
  const rainHoursText = summary.rainHours.length ? summary.rainHours.map(x => `   ⏰ ${hourLabel(x.time)} → ${x.value}%`).join('\n') : '   موردی بالای حد هشدار نیست.';
  const alertText = alerts.length ? alerts.map(a => `⚠️ ${a}`).join('\n') : '✅ هشدار مهمی ثبت نشده است.';
  return `🌤 گزارش هوشمند آب‌وهوا\n📍 ${cityLabel(city)}\n🕗 بازه بررسی: 08:00 تا 24:00\n🌍 منطقه زمانی: ${TIMEZONE}\n\n🌡 دما: ${summary.tempMin ?? '-'} تا ${summary.tempMax ?? '-'}°C\n🥵 دمای محسوس حداکثر: ${summary.apparentMax ?? '-'}°C\n🌧 بیشترین احتمال بارندگی: ${summary.rainMax ?? '-'}%\n💨 بیشترین سرعت باد: ${summary.windMax ?? '-'} km/h\n💧 میانگین رطوبت: ${summary.humidityAvg ?? '-'}%\n☀️ UV Max: ${summary.uvMax ?? '-'}\n😷 AQI Max: ${summary.aqiMax ?? '-'}\n🌅 طلوع: ${summary.sunrise ?? '-'}\n🌇 غروب: ${summary.sunset ?? '-'}\n\n🌧 ساعت‌های بارندگی بالای ${settings.rainThreshold}%:\n${rainHoursText}\n\n${alertText}\n\n🤖 خلاصه هوشمند:\n${aiLikeSummary(city, summary, alerts)}`;
}

async function sendMessage(chatId, text, extra = {}) {
  if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is missing');
  return axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: chatId, text, parse_mode: 'HTML', ...extra }, { timeout: 15000 });
}
async function answerCallback(callbackId) {
  if (!BOT_TOKEN || !callbackId) return;
  try { await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, { callback_query_id: callbackId }, { timeout: 5000 }); } catch (_) {}
}
async function sendMainMenu(chatId) {
  const mapUrl = PUBLIC_URL ? `${PUBLIC_URL.replace(/\/$/, '')}/map` : 'https://render.com';
  return sendMessage(chatId, '🌤 منوی بات هواشناسی\nیک گزینه را انتخاب کنید:', {
    reply_markup: { inline_keyboard: [
      [{ text: '🌤 Salamanca', callback_data: 'weather:salamanca' }, { text: '🌤 Madrid', callback_data: 'weather:madrid' }],
      [{ text: '🌤 Tehran', callback_data: 'weather:tehran' }, { text: '🌤 Ardabil', callback_data: 'weather:ardabil' }],
      [{ text: '📊 Chart Salamanca', callback_data: 'chart:salamanca' }, { text: '📊 Chart Madrid', callback_data: 'chart:madrid' }],
      [{ text: '📊 Chart Tehran', callback_data: 'chart:tehran' }, { text: '📊 Chart Ardabil', callback_data: 'chart:ardabil' }],
      [{ text: '🗺 نقشه زنده', url: mapUrl }],
      [{ text: '⚠️ Alert Status', callback_data: 'alerts:status' }, { text: '⚙️ Settings', callback_data: 'settings:show' }],
      [{ text: '🛠 پنل مدیریت وب', url: PUBLIC_URL || 'https://render.com' }]
    ] }
  });
}
async function sendWeatherToTelegram(chatId, cityKey) {
  const { city, weather, air } = await fetchWeather(cityKey);
  logEvent('weather', `Weather report requested for ${city.key}`, { chatId, cityKey: city.key });
  return sendMessage(chatId, formatReport(city, weather, air));
}
async function createChartBuffer(cityKey) {
  const { city, weather } = await fetchWeather(cityKey);
  const h = weather.hourly;
  const indexes = todayRangeIndexes(h.time);
  const labels = indexes.map(i => hourLabel(h.time[i]));
  const temp = indexes.map(i => h.temperature_2m[i]);
  const rain = indexes.map(i => h.precipitation_probability[i]);
  const wind = indexes.map(i => h.wind_speed_10m[i]);
  const chartJSNodeCanvas = new ChartJSNodeCanvas({ width: 1000, height: 600, backgroundColour: 'white' });
  return chartJSNodeCanvas.renderToBuffer({
    type: 'line',
    data: { labels, datasets: [
      { label: 'Temperature °C', data: temp, borderWidth: 3, tension: 0.25 },
      { label: 'Rain Probability %', data: rain, borderWidth: 3, tension: 0.25 },
      { label: 'Wind km/h', data: wind, borderWidth: 3, tension: 0.25 }
    ]},
    options: { responsive: false, plugins: { title: { display: true, text: `Weather Chart - ${city.name} - 08:00 to 24:00` }, legend: { display: true } }, scales: { y: { beginAtZero: true } } }
  });
}
async function sendChartToTelegram(chatId, cityKey) {
  const key = normalizeCityKey(cityKey);
  if (!cities[key]) throw new Error('City not found');
  logEvent('chart', `Chart requested for ${key}`, { chatId, cityKey: key });
  const buffer = await createChartBuffer(key);
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('caption', `📊 نمودار آب‌وهوا: ${cityLabel(cities[key])}`);
  form.append('photo', new Blob([buffer], { type: 'image/png' }), `weather-${key}.png`);
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, { method: 'POST', body: form });
}
async function sendAllDailyReport(chatId = DEFAULT_CHAT_ID) {
  if (!chatId) throw new Error('TELEGRAM_CHAT_ID is missing');
  for (const key of settings.selectedCities) {
    try { await sendWeatherToTelegram(chatId, key); } catch (err) { await sendMessage(chatId, `❌ خطا در دریافت گزارش ${key}: ${err.message}`); }
  }
}
const alertMemory = new Map();
function shouldAlert(cityKey, alertText) {
  const key = `${cityKey}:${alertText}`;
  const now = Date.now();
  const cooldown = Number(settings.alertCooldownMinutes) * 60 * 1000;
  const last = alertMemory.get(key) || 0;
  if (now - last < cooldown) return false;
  alertMemory.set(key, now); return true;
}
async function checkRealTimeAlerts() {
  if (!settings.realTimeAlerts || !DEFAULT_CHAT_ID) return;
  for (const key of settings.selectedCities) {
    try {
      const { city, weather, air } = await fetchWeather(key);
      const { summary, alerts } = analyzeWeather(city, weather, air);
      const filtered = alerts.filter(a => shouldAlert(key, a));
      if (!filtered.length) continue;
      await sendMessage(DEFAULT_CHAT_ID, `🚨 هشدار فوری آب‌وهوا\n📍 ${cityLabel(city)}\n\n${filtered.map(a => `⚠️ ${a}`).join('\n')}\n\n🤖 تحلیل سریع:\n${aiLikeSummary(city, summary, filtered)}`);
      logEvent('alert', `Real-time alert sent for ${key}`, { alerts: filtered });
    } catch (err) { console.log('Real-time alert error:', key, err.message); }
  }
}
let scheduledDailyTask = null;
let scheduledAlertTask = null;
function scheduleJobs() {
  if (scheduledDailyTask) scheduledDailyTask.stop();
  if (scheduledAlertTask) scheduledAlertTask.stop();
  if (process.env.ENABLE_INTERNAL_CRON === 'false') return;
  if (settings.dailyReport) {
    const [hh, mm] = String(settings.sendTime || '08:00').split(':').map(Number);
    scheduledDailyTask = cron.schedule(`${mm} ${hh} * * *`, () => sendAllDailyReport().catch(err => console.error('Daily job error:', err.message)), { timezone: TIMEZONE });
    console.log(`Daily report scheduled at ${settings.sendTime} (${TIMEZONE})`);
  }
  if (settings.realTimeAlerts) {
    scheduledAlertTask = cron.schedule('*/30 * * * *', () => checkRealTimeAlerts().catch(err => console.error('Alert job error:', err.message)), { timezone: TIMEZONE });
    console.log('Real-time alerts scheduled every 30 minutes');
  }
}
function adminAuth(req, res, next) {
  const token = req.headers['x-admin-password'] || req.query.password || req.body.password;
  if (token !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  next();
}

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'weather-render-bot', time: new Date().toISOString(), settings }));
app.get('/api/report-preview', async (req, res) => {
  try { const { city, weather, air } = await fetchWeather(req.query.city || 'madrid'); res.type('text/plain').send(formatReport(city, weather, air)); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});
app.get('/api/chart', async (req, res) => {
  try { const buffer = await createChartBuffer(req.query.city || 'madrid'); res.set('Content-Type', 'image/png').send(buffer); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});
app.get('/api/send-telegram', async (req, res) => {
  try { const key = req.query.city ? normalizeCityKey(req.query.city) : null; if (key) await sendWeatherToTelegram(DEFAULT_CHAT_ID, key); else await sendAllDailyReport(DEFAULT_CHAT_ID); res.json({ ok: true, sent: key || 'all' }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});
app.get('/api/set-webhook', async (req, res) => {
  try {
    if (!PUBLIC_URL) return res.status(400).json({ ok: false, error: 'PUBLIC_URL is missing' });
    const webhookUrl = `${PUBLIC_URL.replace(/\/$/, '')}/webhook`;
    const result = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, { url: webhookUrl, allowed_updates: ['message', 'callback_query'] });
    res.json({ ok: true, webhookUrl, telegram: result.data });
  } catch (err) { res.status(500).json({ ok: false, error: err.response?.data || err.message }); }
});
app.get('/api/map-data', async (req, res) => {
  const result = [];
  for (const key of Object.keys(cities)) {
    try {
      const { city, weather, air } = await fetchWeather(key);
      const { summary, alerts } = analyzeWeather(city, weather, air);
      result.push({ key, name: city.name, fa: city.fa, lat: city.lat, lon: city.lon, summary, alerts, status: getStatus(summary, alerts), reportUrl: `/api/report-preview?city=${encodeURIComponent(key)}`, chartUrl: `/api/chart?city=${encodeURIComponent(key)}` });
    } catch (err) { result.push({ key, ...cities[key], error: err.message, status: 'error' }); }
  }
  res.json({ ok: true, time: new Date().toISOString(), timezone: TIMEZONE, settings, cities: result });
});



app.get('/api/point-details', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (Number.isNaN(lat) || Number.isNaN(lon)) return res.status(400).json({ ok: false, error: 'lat and lon are required' });
    const label = req.query.name || await reverseGeocode(lat, lon);
    const { city, weather, air } = await fetchWeatherForPoint(lat, lon, label);
    const { summary, alerts } = analyzeWeather(city, weather, air);
    res.json({
      ok: true,
      time: new Date().toISOString(),
      timezone: TIMEZONE,
      city: { key: city.key, name: city.name, fa: city.fa, lat: city.lat, lon: city.lon, dynamic: true },
      summary,
      alerts,
      status: getStatus(summary, alerts),
      aiSummary: aiLikeSummary(city, summary, alerts),
      reportUrl: `/api/point-report?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&name=${encodeURIComponent(label)}`,
      chartUrl: `/api/point-chart?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&name=${encodeURIComponent(label)}`
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/point-report', async (req, res) => {
  try {
    const label = req.query.name || await reverseGeocode(req.query.lat, req.query.lon);
    const { city, weather, air } = await fetchWeatherForPoint(req.query.lat, req.query.lon, label);
    res.type('text/plain').send(formatReport(city, weather, air));
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/point-chart', async (req, res) => {
  try {
    const label = req.query.name || await reverseGeocode(req.query.lat, req.query.lon);
    const { city, weather } = await fetchWeatherForPoint(req.query.lat, req.query.lon, label);
    const h = weather.hourly;
    const indexes = todayRangeIndexes(h.time);
    const labels = indexes.map(i => hourLabel(h.time[i]));
    const temp = indexes.map(i => h.temperature_2m[i]);
    const rain = indexes.map(i => h.precipitation_probability[i]);
    const wind = indexes.map(i => h.wind_speed_10m[i]);
    const chartJSNodeCanvas = new ChartJSNodeCanvas({ width: 1000, height: 600, backgroundColour: 'white' });
    const buffer = await chartJSNodeCanvas.renderToBuffer({
      type: 'line',
      data: { labels, datasets: [
        { label: 'Temperature °C', data: temp, borderWidth: 3, tension: 0.25 },
        { label: 'Rain Probability %', data: rain, borderWidth: 3, tension: 0.25 },
        { label: 'Wind km/h', data: wind, borderWidth: 3, tension: 0.25 }
      ]},
      options: { responsive: false, plugins: { title: { display: true, text: `Weather Chart - ${city.name} - 08:00 to 24:00` }, legend: { display: true } }, scales: { y: { beginAtZero: true } } }
    });
    res.set('Content-Type', 'image/png').send(buffer);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/city-details', async (req, res) => {
  try {
    const key = normalizeCityKey(req.query.city || 'madrid');
    if (!key || !cities[key]) return res.status(404).json({ ok: false, error: 'City not found' });
    const { city, weather, air } = await fetchWeather(key);
    const { summary, alerts } = analyzeWeather(city, weather, air);
    res.json({
      ok: true,
      time: new Date().toISOString(),
      timezone: TIMEZONE,
      city: { key, name: city.name, fa: city.fa, lat: city.lat, lon: city.lon },
      summary,
      alerts,
      status: getStatus(summary, alerts),
      aiSummary: aiLikeSummary(city, summary, alerts),
      reportUrl: `/api/report-preview?city=${encodeURIComponent(key)}`,
      chartUrl: `/api/chart?city=${encodeURIComponent(key)}`,
      telegramSendUrl: `/api/send-telegram?city=${encodeURIComponent(key)}`
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  try {
    if (update.callback_query) {
      const callback = update.callback_query;
      const chatId = callback.message.chat.id;
      recordUser(callback.from, chatId);
      const data = callback.data || '';
      answerCallback(callback.id);
      const parts = data.includes(':') ? data.split(':') : data.split('_');
      const action = parts[0];
      const cityKey = normalizeCityKey(parts[1]);
      if (action === 'weather') return cities[cityKey] ? sendWeatherToTelegram(chatId, cityKey) : sendMessage(chatId, '❌ شهر پیدا نشد.');
      if (action === 'chart') return cities[cityKey] ? sendChartToTelegram(chatId, cityKey) : sendMessage(chatId, '❌ شهر پیدا نشد.');
      if (action === 'alerts') return sendMessage(chatId, `⚠️ Real-Time Alerts: ${settings.realTimeAlerts ? 'فعال' : 'غیرفعال'}\n⏰ گزارش روزانه: ${settings.sendTime}\n🌧 حد بارندگی: ${settings.rainThreshold}%`);
      if (action === 'settings') return sendMessage(chatId, `⚙️ تنظیمات فعلی\n⏰ ساعت ارسال: ${settings.sendTime}\n🌧 حد بارندگی: ${settings.rainThreshold}%\n💨 هشدار باد: ${settings.windWarningKmh} km/h\n\nبرای تغییر ساعت:\n/settime 07:30`);
      return;
    }
    const msg = update.message;
    if (!msg || !msg.text) return;
    const chatId = msg.chat.id;
    recordUser(msg.from, chatId);
    const text = msg.text.trim();
    const lower = text.toLowerCase();
    logEvent('message', `Telegram command: ${text}`, { chatId });
    if (lower === '/start' || lower === '/menu') return sendMainMenu(chatId);
    if (lower === '/map') return sendMessage(chatId, `🗺 نقشه زنده آب‌وهوا:\n${PUBLIC_URL ? PUBLIC_URL.replace(/\/$/, '') + '/map' : 'PUBLIC_URL تنظیم نشده است.'}`);
    if (lower.startsWith('/weather')) { const key = normalizeCityKey(text.split(/\s+/)[1] || 'madrid'); return cities[key] ? sendWeatherToTelegram(chatId, key) : sendMessage(chatId, '❌ شهر پیدا نشد. مثال: /weather madrid'); }
    if (lower.startsWith('/chart')) { const key = normalizeCityKey(text.split(/\s+/)[1] || 'madrid'); return cities[key] ? sendChartToTelegram(chatId, key) : sendMessage(chatId, '❌ شهر پیدا نشد. مثال: /chart tehran'); }
    if (lower === '/all') return sendAllDailyReport(chatId);
    if (lower.startsWith('/settime')) {
      const newTime = text.split(/\s+/)[1];
      if (!newTime || !/^\d{2}:\d{2}$/.test(newTime)) return sendMessage(chatId, '❌ فرمت درست: /settime 08:00');
      const [hh, mm] = newTime.split(':').map(Number);
      if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return sendMessage(chatId, '❌ ساعت نامعتبر است.');
      settings.sendTime = newTime; saveSettings(); scheduleJobs();
      return sendMessage(chatId, `✅ ساعت ارسال روزانه تغییر کرد به ${newTime}`);
    }
    if (lower === '/settings') return sendMessage(chatId, `⚙️ تنظیمات\n⏰ ساعت ارسال: ${settings.sendTime}\n⚠️ هشدار فوری: ${settings.realTimeAlerts ? 'فعال' : 'غیرفعال'}\n🌧 حد بارندگی: ${settings.rainThreshold}%`);
    return sendMessage(chatId, 'دستور نامعتبر است. /menu را بزنید.');
  } catch (err) { console.error('Webhook processing error:', err.response?.data || err.message); }
});

app.get('/api/admin/settings', adminAuth, (req, res) => res.json({ ok: true, settings, cities }));
app.post('/api/admin/settings', adminAuth, (req, res) => {
  try {
    const allowed = ['sendTime','language','rainThreshold','windWarningKmh','uvWarning','heatWarningC','coldWarningC','realTimeAlerts','dailyReport','selectedCities','alertCooldownMinutes'];
    for (const k of allowed) if (k in req.body) settings[k] = req.body[k];
    if (!/^\d{2}:\d{2}$/.test(settings.sendTime)) settings.sendTime = '08:00';
    ['rainThreshold','windWarningKmh','uvWarning','heatWarningC','coldWarningC','alertCooldownMinutes'].forEach(k => settings[k] = Number(settings[k]));
    if (!Array.isArray(settings.selectedCities)) settings.selectedCities = [];
    saveSettings(); scheduleJobs();
    logEvent('admin', 'Settings updated', settings);
    res.json({ ok: true, settings });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});
app.get('/api/admin/cities', adminAuth, (req, res) => res.json({ ok: true, cities }));
app.post('/api/admin/cities', adminAuth, (req, res) => {
  try {
    const body = req.body || {}; const key = normalizeCityKey(body.key || body.name); const lat = Number(body.lat); const lon = Number(body.lon);
    if (!key || !body.name || Number.isNaN(lat) || Number.isNaN(lon)) return res.status(400).json({ ok: false, error: 'key, name, lat and lon are required' });
    cities[key] = { key, name: body.name, fa: body.fa || body.name, lat, lon };
    if (!settings.selectedCities.includes(key)) settings.selectedCities.push(key);
    saveCities(); saveSettings(); logEvent('admin', `City saved: ${key}`, cities[key]);
    res.json({ ok: true, city: cities[key], cities, settings });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});
app.delete('/api/admin/cities/:key', adminAuth, (req, res) => {
  const key = normalizeCityKey(req.params.key);
  if (!cities[key]) return res.status(404).json({ ok: false, error: 'City not found' });
  delete cities[key]; settings.selectedCities = settings.selectedCities.filter(x => x !== key);
  saveCities(); saveSettings(); logEvent('admin', `City deleted: ${key}`);
  res.json({ ok: true, cities, settings });
});
app.get('/api/admin/users', adminAuth, (req, res) => res.json({ ok: true, users: Object.values(users).sort((a,b)=>String(b.lastSeen).localeCompare(String(a.lastSeen))) }));
app.get('/api/admin/logs', adminAuth, (req, res) => res.json({ ok: true, logs: logs.slice().reverse() }));
app.delete('/api/admin/logs', adminAuth, (req, res) => { logs = []; saveLogs(); res.json({ ok: true, logs }); });
app.post('/api/admin/send-city', adminAuth, async (req, res) => { try { const key = normalizeCityKey(req.body.city || 'madrid'); await sendWeatherToTelegram(DEFAULT_CHAT_ID, key); res.json({ ok: true, sent: key }); } catch (err) { res.status(500).json({ ok: false, error: err.message }); } });
app.post('/api/admin/send-now', adminAuth, async (req, res) => { try { await sendAllDailyReport(DEFAULT_CHAT_ID); res.json({ ok: true, message: 'Daily report sent' }); } catch (err) { res.status(500).json({ ok: false, error: err.message }); } });
app.post('/api/admin/test-alerts', adminAuth, async (req, res) => { try { await checkRealTimeAlerts(); res.json({ ok: true, message: 'Alert check executed' }); } catch (err) { res.status(500).json({ ok: false, error: err.message }); } });

app.get('/map', (req, res) => res.sendFile(path.join(__dirname, 'public', 'map.html')));

scheduleJobs();
app.listen(PORT, () => console.log(`Weather Telegram Bot is running on port ${PORT}`));
