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
function parseBotTokens() {
  const bots = {};
  if (BOT_TOKEN) bots.main = BOT_TOKEN;
  if (process.env.BOT_TOKENS_JSON) {
    try {
      const parsed = JSON.parse(process.env.BOT_TOKENS_JSON);
      for (const [key, token] of Object.entries(parsed || {})) {
        if (/^[a-zA-Z0-9_-]+$/.test(key) && String(token || '').trim()) bots[key] = String(token).trim();
      }
    } catch (err) { console.error('BOT_TOKENS_JSON parse error:', err.message); }
  }
  for (const [envKey, value] of Object.entries(process.env)) {
    if (envKey.startsWith('BOT_TOKEN_') && String(value || '').trim()) {
      const key = envKey.replace('BOT_TOKEN_', '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (key) bots[key] = String(value).trim();
    }
  }
  return bots;
}
const BOT_TOKENS = parseBotTokens();
const DEFAULT_BOT_KEY = process.env.DEFAULT_BOT_KEY || (BOT_TOKENS.main ? 'main' : Object.keys(BOT_TOKENS)[0] || 'main');
const DEFAULT_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PUBLIC_URL = process.env.PUBLIC_URL;
const TIMEZONE = process.env.TIMEZONE || 'Europe/Madrid';
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const SETTINGS_PATH = path.join(__dirname, 'settings.json');
const CITIES_PATH = path.join(__dirname, 'cities.json');
const USERS_PATH = path.join(__dirname, 'users.json');
const LOGS_PATH = path.join(__dirname, 'logs.json');
const SENT_PATH = path.join(__dirname, 'sent-daily.json');

const defaultSettings = {
  sendTime: '08:00',
  language: 'fa',
  supportedLanguages: ['fa', 'es', 'ar'],
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
  salamanca: { key: 'salamanca', name: 'Salamanca, Spain', fa: 'سالامانکا، اسپانیا', es: 'Salamanca, España', ar: 'سالامانكا، إسبانيا', lat: 40.9701, lon: -5.6635 },
  madrid: { key: 'madrid', name: 'Madrid, Spain', fa: 'مادرید، اسپانیا', es: 'Madrid, España', ar: 'مدريد، إسبانيا', lat: 40.4168, lon: -3.7038 },
  tehran: { key: 'tehran', name: 'Tehran, Iran', fa: 'تهران، ایران', es: 'Teherán, Irán', ar: 'طهران، إيران', lat: 35.6892, lon: 51.3890 },
  ardabil: { key: 'ardabil', name: 'Ardabil, Iran', fa: 'اردبیل، ایران', es: 'Ardabil, Irán', ar: 'أردبيل، إيران', lat: 38.2498, lon: 48.2933 }
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
let sentDaily = loadJson(SENT_PATH, {});

function saveSettings() { saveJson(SETTINGS_PATH, settings); }
function saveCities() { saveJson(CITIES_PATH, cities); }
function saveUsers() { saveJson(USERS_PATH, users); }
function saveLogs() { logs = logs.slice(-800); saveJson(LOGS_PATH, logs); }
function saveSentDaily() { saveJson(SENT_PATH, sentDaily); }

function normalizeBotKey(input) {
  const raw = String(input || DEFAULT_BOT_KEY || 'main').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return BOT_TOKENS[raw] ? raw : DEFAULT_BOT_KEY;
}
function inferBotKeyForChat(chatId) {
  const matches = Object.values(users || {}).filter(u => String(u.chatId) === String(chatId) && u.botKey && BOT_TOKENS[u.botKey]);
  if (matches.length === 1) return matches[0].botKey;
  return DEFAULT_BOT_KEY;
}
function getBotToken(botKey = DEFAULT_BOT_KEY) {
  return getBotTokenStrict(botKey);
}
function listBots() {
  return Object.keys(BOT_TOKENS).map(key => ({ key, isDefault: key === DEFAULT_BOT_KEY }));
}
function canonicalBotKey(input) {
  return String(input || DEFAULT_BOT_KEY || 'main').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || DEFAULT_BOT_KEY;
}
function looksLikeTelegramBotToken(token) {
  return /^\d{6,}:[-_A-Za-z0-9]{20,}$/.test(String(token || '').trim());
}
function botTokenStatus(botKey = DEFAULT_BOT_KEY) {
  const key = canonicalBotKey(botKey);
  const token = BOT_TOKENS[key];
  if (!token) return { ok: false, key, error: `Missing token for botKey "${key}". Add BOT_TOKEN_${key.toUpperCase()} in Render Environment.` };
  if (!looksLikeTelegramBotToken(token)) return { ok: false, key, error: `Invalid token format for botKey "${key}". This must be the BotFather token, not a Chat ID.` };
  return { ok: true, key };
}
function getBotTokenStrict(botKey = DEFAULT_BOT_KEY) {
  const status = botTokenStatus(botKey);
  if (!status.ok) throw new Error(status.error);
  return BOT_TOKENS[status.key];
}
function botKeyFromReq(req) {
  return normalizeBotKey(req.params?.botKey || req.query?.botKey || DEFAULT_BOT_KEY);
}
function logEvent(type, message, meta = {}) {
  const item = { time: new Date().toISOString(), type, message, meta };
  logs.push(item); saveLogs();
  console.log(`[${type}] ${message}`, Object.keys(meta).length ? meta : '');
}
function normalizeLanguage(input) {
  const l = String(input || '').toLowerCase().slice(0,2);
  if (['fa','es','ar'].includes(l)) return l;
  return settings.language || 'fa';
}
function inferLanguage(rawUser) {
  const lc = String(rawUser?.language_code || '').toLowerCase();
  if (lc.startsWith('es')) return 'es';
  if (lc.startsWith('ar')) return 'ar';
  return settings.language || 'fa';
}
function recordUser(rawUser, chatId, botKey = DEFAULT_BOT_KEY) {
  if (!chatId) return;
  const id = String(chatId);
  const key = normalizeBotKey(botKey);
  const storageKey = `${key}:${id}`;
  const old = users[storageKey] || users[id] || {};
  users[storageKey] = {
    storageKey,
    botKey: key,
    chatId: id,
    firstName: rawUser?.first_name || old.firstName || '',
    lastName: rawUser?.last_name || old.lastName || '',
    username: rawUser?.username || old.username || '',
    languageCode: rawUser?.language_code || old.languageCode || '',
    language: old.language || inferLanguage(rawUser),
    city: old.city || 'madrid',
    sendTime: old.sendTime || settings.sendTime || '08:00',
    rainThreshold: Number(old.rainThreshold || settings.rainThreshold || 50),
    isActive: old.isActive !== false,
    isAdmin: old.isAdmin || (key === DEFAULT_BOT_KEY && DEFAULT_CHAT_ID && String(DEFAULT_CHAT_ID) === id),
    createdAt: old.createdAt || new Date().toISOString(),
    lastSeen: new Date().toISOString()
  };
  if (users[id] && id !== storageKey) delete users[id];
  saveUsers();
}
function getUser(chatId, botKey = DEFAULT_BOT_KEY) {
  const id = String(chatId);
  const key = normalizeBotKey(botKey);
  return users[`${key}:${id}`] || users[id] || { storageKey: `${key}:${id}`, botKey: key, chatId: id, language: settings.language || 'fa', city: 'madrid', sendTime: settings.sendTime || '08:00', rainThreshold: settings.rainThreshold, isActive: true };
}
function saveUserObject(user) {
  const key = normalizeBotKey(user.botKey || DEFAULT_BOT_KEY);
  const id = String(user.chatId);
  users[`${key}:${id}`] = { ...user, storageKey: `${key}:${id}`, botKey: key, chatId: id };
  if (users[id] && `${key}:${id}` !== id) delete users[id];
  saveUsers();
  return users[`${key}:${id}`];
}
function isAdminChat(chatId, botKey = DEFAULT_BOT_KEY) {
  const u = getUser(chatId, botKey);
  return (normalizeBotKey(botKey) === DEFAULT_BOT_KEY && DEFAULT_CHAT_ID && String(DEFAULT_CHAT_ID) === String(chatId)) || !!u?.isAdmin;
}
function userThreshold(chatId) {
  return Number(getUser(chatId).rainThreshold || settings.rainThreshold || 50);
}



const TR = {
  fa: {
    menuTitle: '🌤 منوی بات هواشناسی\nیک گزینه را انتخاب کنید:',
    liveMap: '🗺 نقشه زنده', adminPanel: '🛠 پنل مدیریت وب', settings: '⚙️ تنظیمات', alertStatus: '⚠️ وضعیت هشدار',
    cityNotFound: '❌ شهر پیدا نشد.', invalid: 'دستور نامعتبر است. /menu را بزنید.',
    mapLink: '🗺 نقشه زنده آب‌وهوا:',
    settingsText: '⚙️ تنظیمات شما', dailyTime: '⏰ ساعت ارسال', rainLimit: '🌧 حد بارندگی', city: '🏙 شهر', language: '🌐 زبان', active: '✅ فعال', inactive: '⛔ غیرفعال',
    setTimeOk: '✅ ساعت ارسال روزانه شما تغییر کرد به', setTimeBad: '❌ فرمت درست: /settime 08:00',
    setCityOk: '✅ شهر پیش‌فرض شما تغییر کرد به', setLangOk: '✅ زبان شما تغییر کرد به فارسی',
    help: 'دستورها:\n/menu\n/weather madrid\n/chart tehran\n/all\n/setcity madrid\n/settime 08:00\n/lang fa | /lang es | /lang ar\n/mysettings',
    userAdded: '✅ کاربر اضافه شد.', userRemoved: '✅ کاربر حذف/غیرفعال شد.', notAdmin: '⛔ فقط مدیر اجازه این کار را دارد.', broadcastSent: '✅ پیام همگانی ارسال شد.'
  },
  es: {
    menuTitle: '🌤 Menú del bot meteorológico\nElige una opción:',
    liveMap: '🗺 Mapa en vivo', adminPanel: '🛠 Panel de administración', settings: '⚙️ Ajustes', alertStatus: '⚠️ Estado de alertas',
    cityNotFound: '❌ Ciudad no encontrada.', invalid: 'Comando no válido. Usa /menu.',
    mapLink: '🗺 Mapa meteorológico en vivo:',
    settingsText: '⚙️ Tus ajustes', dailyTime: '⏰ Hora de envío', rainLimit: '🌧 Límite de lluvia', city: '🏙 Ciudad', language: '🌐 Idioma', active: '✅ Activo', inactive: '⛔ Inactivo',
    setTimeOk: '✅ Tu hora diaria cambió a', setTimeBad: '❌ Formato correcto: /settime 08:00',
    setCityOk: '✅ Tu ciudad predeterminada cambió a', setLangOk: '✅ Tu idioma cambió a español',
    help: 'Comandos:\n/menu\n/weather madrid\n/chart tehran\n/all\n/setcity madrid\n/settime 08:00\n/lang fa | /lang es | /lang ar\n/mysettings',
    userAdded: '✅ Usuario añadido.', userRemoved: '✅ Usuario eliminado/desactivado.', notAdmin: '⛔ Solo el administrador puede hacerlo.', broadcastSent: '✅ Mensaje enviado a todos los usuarios.'
  },
  ar: {
    menuTitle: '🌤 قائمة بوت الطقس\nاختر خياراً:',
    liveMap: '🗺 الخريطة الحية', adminPanel: '🛠 لوحة الإدارة', settings: '⚙️ الإعدادات', alertStatus: '⚠️ حالة التنبيهات',
    cityNotFound: '❌ لم يتم العثور على المدينة.', invalid: 'أمر غير صحيح. استخدم /menu.',
    mapLink: '🗺 خريطة الطقس الحية:',
    settingsText: '⚙️ إعداداتك', dailyTime: '⏰ وقت الإرسال', rainLimit: '🌧 حد المطر', city: '🏙 المدينة', language: '🌐 اللغة', active: '✅ نشط', inactive: '⛔ غير نشط',
    setTimeOk: '✅ تم تغيير وقت الإرسال اليومي إلى', setTimeBad: '❌ الصيغة الصحيحة: /settime 08:00',
    setCityOk: '✅ تم تغيير مدينتك الافتراضية إلى', setLangOk: '✅ تم تغيير اللغة إلى العربية',
    help: 'الأوامر:\n/menu\n/weather madrid\n/chart tehran\n/all\n/setcity madrid\n/settime 08:00\n/lang fa | /lang es | /lang ar\n/mysettings',
    userAdded: '✅ تمت إضافة المستخدم.', userRemoved: '✅ تم حذف/تعطيل المستخدم.', notAdmin: '⛔ هذا الأمر للمدير فقط.', broadcastSent: '✅ تم إرسال الرسالة الجماعية.'
  }
};
function tr(lang, key) { return (TR[normalizeLanguage(lang)] || TR.fa)[key] || TR.fa[key] || key; }
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
function cityLabel(city, lang = 'fa') { return city?.[normalizeLanguage(lang)] || city?.fa || city?.name || city?.key; }
function todayDateString() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function currentHourInTimezone() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    hour12: false
  }).formatToParts(new Date());
  const hour = Number(parts.find(p => p.type === 'hour')?.value || 0);
  return hour === 24 ? 0 : hour;
}
function todayRangeIndexes(hourlyTimes, mode = 'daily') {
  const today = todayDateString();
  const startHour = mode === 'manual' ? currentHourInTimezone() : 8;
  return (hourlyTimes || [])
    .map((t, idx) => ({ t, idx }))
    .filter(x => x.t.startsWith(today) && Number(x.t.slice(11, 13)) >= startHour && Number(x.t.slice(11, 13)) <= 23)
    .map(x => x.idx);
}
function rangeLabel(mode = 'daily') {
  const startHour = mode === 'manual' ? currentHourInTimezone() : 8;
  return `${String(startHour).padStart(2, '0')}:00 تا 24:00`;
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
function analyzeWeather(city, weather, air, mode = 'daily', opts = settings) {
  const h = weather.hourly || {};
  const idxs = todayRangeIndexes(h.time || [], mode);
  const values = (name) => idxs.map(i => h[name]?.[i]).filter(v => typeof v === 'number');
  const temps = values('temperature_2m');
  const apparent = values('apparent_temperature');
  const rain = values('precipitation_probability');
  const wind = values('wind_speed_10m');
  const uv = values('uv_index');
  const humidity = values('relative_humidity_2m');
  const rainHours = idxs.map(i => ({ time: h.time[i], value: h.precipitation_probability?.[i] }))
    .filter(x => typeof x.value === 'number' && x.value >= Number(opts.rainThreshold));
  const airValues = air?.hourly?.us_aqi ? idxs.map(i => air.hourly.us_aqi[i]).filter(v => typeof v === 'number') : [];
  const summary = {
    tempMax: max(temps), tempMin: min(temps), apparentMax: max(apparent), rainMax: max(rain), windMax: max(wind),
    uvMax: max(uv), humidityAvg: avg(humidity), aqiMax: max(airValues),
    sunrise: weather.daily?.sunrise?.[0]?.slice(11,16), sunset: weather.daily?.sunset?.[0]?.slice(11,16), rainHours
  };
  const alerts = [];
  if (summary.rainMax !== null && summary.rainMax >= opts.rainThreshold) alerts.push(`🌧 احتمال بارندگی بالا تا ${summary.rainMax}%`);
  if (summary.windMax !== null && summary.windMax >= opts.windWarningKmh) alerts.push(`💨 هشدار باد شدید: ${summary.windMax} km/h`);
  if (summary.uvMax !== null && summary.uvMax >= opts.uvWarning) alerts.push(`☀️ هشدار UV بالا: ${summary.uvMax}`);
  if (summary.tempMax !== null && summary.tempMax >= opts.heatWarningC) alerts.push(`🔥 هشدار گرما: ${summary.tempMax}°C`);
  if (summary.tempMin !== null && summary.tempMin <= opts.coldWarningC) alerts.push(`❄️ هشدار سرما: ${summary.tempMin}°C`);
  if (summary.aqiMax !== null && summary.aqiMax >= 101) alerts.push(`😷 کیفیت هوا ناسالم: AQI ${summary.aqiMax}`);
  return { summary, alerts };
}
function aiLikeSummary(city, summary, alerts, lang = 'fa', opts = settings) {
  const name = cityLabel(city, lang);
  if (lang === 'es') {
    const parts = [];
    if (summary.rainMax >= opts.rainThreshold) parts.push(`En ${name}, la probabilidad de lluvia es importante; conviene llevar paraguas.`);
    else parts.push(`En ${name}, no se observa una probabilidad de lluvia importante.`);
    if (summary.tempMax !== null && summary.tempMin !== null) parts.push(`La temperatura estará aproximadamente entre ${summary.tempMin} y ${summary.tempMax} °C.`);
    if (summary.windMax >= opts.windWarningKmh) parts.push('El viento puede ser fuerte; precaución para moto, bici y reparto.');
    if (summary.uvMax >= opts.uvWarning) parts.push('El índice UV es alto; usa protección solar.');
    if (summary.aqiMax >= 101) parts.push('La calidad del aire puede ser mala para personas sensibles.');
    if (!alerts.length) parts.push('Las condiciones generales son estables.');
    return parts.join(' ');
  }
  if (lang === 'ar') {
    const parts = [];
    if (summary.rainMax >= opts.rainThreshold) parts.push(`في ${name} توجد احتمالية ملحوظة للأمطار؛ من الأفضل حمل مظلة.`);
    else parts.push(`في ${name} لا توجد احتمالية أمطار مهمة.`);
    if (summary.tempMax !== null && summary.tempMin !== null) parts.push(`درجة الحرارة تقريباً بين ${summary.tempMin} و ${summary.tempMax}°C.`);
    if (summary.windMax >= opts.windWarningKmh) parts.push('قد تكون الرياح قوية؛ يرجى الحذر عند استخدام الدراجة أو الدراجة النارية.');
    if (summary.uvMax >= opts.uvWarning) parts.push('مؤشر الأشعة فوق البنفسجية مرتفع؛ استخدم واقي الشمس.');
    if (summary.aqiMax >= 101) parts.push('جودة الهواء قد تكون غير مناسبة للأشخاص الحساسين.');
    if (!alerts.length) parts.push('الأحوال العامة مستقرة.');
    return parts.join(' ');
  }
  const parts = [];
  if (summary.rainMax >= opts.rainThreshold) parts.push(`در ${name} امروز احتمال بارندگی قابل توجه است و بهتر است چتر همراه داشته باشید.`);
  else parts.push(`در ${name} امروز احتمال بارندگی مهمی دیده نمی‌شود.`);
  if (summary.tempMax !== null && summary.tempMin !== null) parts.push(`بازه دما حدود ${summary.tempMin} تا ${summary.tempMax} درجه است.`);
  if (summary.windMax >= opts.windWarningKmh) parts.push(`باد می‌تواند شدید شود؛ برای موتور، دوچرخه و دلیوری احتیاط لازم است.`);
  if (summary.uvMax >= opts.uvWarning) parts.push(`شاخص UV بالاست؛ بهتر است در ساعات آفتابی از ضدآفتاب و کلاه استفاده شود.`);
  if (summary.aqiMax >= 101) parts.push(`کیفیت هوا برای افراد حساس مناسب نیست.`);
  if (!alerts.length) parts.push('شرایط کلی روز پایدار است.');
  return parts.join(' ');
}

function getStatus(summary, alerts, opts = settings) {
  if (alerts.some(a => a.includes('ناسالم') || a.includes('باد شدید') || a.includes('گرما'))) return 'danger';
  if (summary.rainMax >= opts.rainThreshold || alerts.length) return 'warning';
  return 'normal';
}
function userOptions(chatIdOrUser) {
  const u = typeof chatIdOrUser === 'object' ? chatIdOrUser : getUser(chatIdOrUser);
  return { ...settings, rainThreshold: Number(u.rainThreshold || settings.rainThreshold) };
}
function formatReport(city, weather, air, mode = 'daily', lang = 'fa', opts = settings) {
  const { summary, alerts } = analyzeWeather(city, weather, air, mode, opts);
  const rainHoursText = summary.rainHours.length ? summary.rainHours.map(x => `   ⏰ ${hourLabel(x.time)} → ${x.value}%`).join('\n') : (lang === 'es' ? '   No hay horas por encima del límite.' : lang === 'ar' ? '   لا توجد ساعات أعلى من الحد.' : '   موردی بالای حد هشدار نیست.');
  const alertText = alerts.length ? alerts.map(a => `⚠️ ${a}`).join('\n') : (lang === 'es' ? '✅ No hay alertas importantes.' : lang === 'ar' ? '✅ لا توجد تنبيهات مهمة.' : '✅ هشدار مهمی ثبت نشده است.');
  if (lang === 'es') return `🌤 Informe inteligente del tiempo\n📍 ${cityLabel(city, lang)}\n🕗 Intervalo: ${rangeLabel(mode)}\n🌍 Zona horaria: ${TIMEZONE}\n\n🌡 Temperatura: ${summary.tempMin ?? '-'} a ${summary.tempMax ?? '-'}°C\n🥵 Sensación máxima: ${summary.apparentMax ?? '-'}°C\n🌧 Probabilidad máxima de lluvia: ${summary.rainMax ?? '-'}%\n💨 Viento máximo: ${summary.windMax ?? '-'} km/h\n💧 Humedad media: ${summary.humidityAvg ?? '-'}%\n☀️ UV máx.: ${summary.uvMax ?? '-'}\n😷 AQI máx.: ${summary.aqiMax ?? '-'}\n🌅 Amanecer: ${summary.sunrise ?? '-'}\n🌇 Atardecer: ${summary.sunset ?? '-'}\n\n🌧 Horas con lluvia por encima de ${opts.rainThreshold}%:\n${rainHoursText}\n\n${alertText}\n\n🤖 Resumen inteligente:\n${aiLikeSummary(city, summary, alerts, lang, opts)}`;
  if (lang === 'ar') return `🌤 تقرير الطقس الذكي\n📍 ${cityLabel(city, lang)}\n🕗 الفترة: ${rangeLabel(mode)}\n🌍 المنطقة الزمنية: ${TIMEZONE}\n\n🌡 الحرارة: ${summary.tempMin ?? '-'} إلى ${summary.tempMax ?? '-'}°C\n🥵 أعلى إحساس حراري: ${summary.apparentMax ?? '-'}°C\n🌧 أعلى احتمال للأمطار: ${summary.rainMax ?? '-'}%\n💨 أعلى سرعة رياح: ${summary.windMax ?? '-'} km/h\n💧 متوسط الرطوبة: ${summary.humidityAvg ?? '-'}%\n☀️ أعلى UV: ${summary.uvMax ?? '-'}\n😷 أعلى AQI: ${summary.aqiMax ?? '-'}\n🌅 الشروق: ${summary.sunrise ?? '-'}\n🌇 الغروب: ${summary.sunset ?? '-'}\n\n🌧 ساعات المطر فوق ${opts.rainThreshold}%:\n${rainHoursText}\n\n${alertText}\n\n🤖 ملخص ذكي:\n${aiLikeSummary(city, summary, alerts, lang, opts)}`;
  return `🌤 گزارش هوشمند آب‌وهوا\n📍 ${cityLabel(city, lang)}\n🕗 بازه بررسی: ${rangeLabel(mode)}\n🌍 منطقه زمانی: ${TIMEZONE}\n\n🌡 دما: ${summary.tempMin ?? '-'} تا ${summary.tempMax ?? '-'}°C\n🥵 دمای محسوس حداکثر: ${summary.apparentMax ?? '-'}°C\n🌧 بیشترین احتمال بارندگی: ${summary.rainMax ?? '-'}%\n💨 بیشترین سرعت باد: ${summary.windMax ?? '-'} km/h\n💧 میانگین رطوبت: ${summary.humidityAvg ?? '-'}%\n☀️ UV Max: ${summary.uvMax ?? '-'}\n😷 AQI Max: ${summary.aqiMax ?? '-'}\n🌅 طلوع: ${summary.sunrise ?? '-'}\n🌇 غروب: ${summary.sunset ?? '-'}\n\n🌧 ساعت‌های بارندگی بالای ${opts.rainThreshold}%:\n${rainHoursText}\n\n${alertText}\n\n🤖 خلاصه هوشمند:\n${aiLikeSummary(city, summary, alerts, lang, opts)}`;
}


async function sendMessage(chatId, text, extra = {}, botKey = null) {
  const key = botKey ? normalizeBotKey(botKey) : inferBotKeyForChat(chatId);
  const token = getBotToken(key);
  return axios.post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chatId, text, parse_mode: 'HTML', ...extra }, { timeout: 15000 });
}
async function answerCallback(callbackId, botKey = DEFAULT_BOT_KEY) {
  if (!callbackId) return;
  try { await axios.post(`https://api.telegram.org/bot${getBotToken(botKey)}/answerCallbackQuery`, { callback_query_id: callbackId }, { timeout: 5000 }); } catch (_) {}
}
async function sendMainMenu(chatId, botKey = DEFAULT_BOT_KEY) {
  const user = getUser(chatId, botKey);
  const lang = normalizeLanguage(user.language);
  const mapUrl = PUBLIC_URL ? `${PUBLIC_URL.replace(/\/$/, '')}/map` : 'https://render.com';
  return sendMessage(chatId, tr(lang, 'menuTitle'), {
    reply_markup: { inline_keyboard: [
      [{ text: '🌤 Salamanca', callback_data: 'weather:salamanca' }, { text: '🌤 Madrid', callback_data: 'weather:madrid' }],
      [{ text: '🌤 Tehran', callback_data: 'weather:tehran' }, { text: '🌤 Ardabil', callback_data: 'weather:ardabil' }],
      [{ text: '📊 Chart Salamanca', callback_data: 'chart:salamanca' }, { text: '📊 Chart Madrid', callback_data: 'chart:madrid' }],
      [{ text: '📊 Chart Tehran', callback_data: 'chart:tehran' }, { text: '📊 Chart Ardabil', callback_data: 'chart:ardabil' }],
      [{ text: tr(lang, 'liveMap'), url: mapUrl }],
      [{ text: tr(lang, 'alertStatus'), callback_data: 'alerts:status' }, { text: tr(lang, 'settings'), callback_data: 'settings:show' }],
      [{ text: '🇪🇸 Español', callback_data: 'lang:es' }, { text: '🇸🇦 العربية', callback_data: 'lang:ar' }, { text: '🇮🇷 فارسی', callback_data: 'lang:fa' }],
      [{ text: tr(lang, 'adminPanel'), url: PUBLIC_URL || 'https://render.com' }]
    ] }
  }, botKey);
}

async function sendWeatherToTelegram(chatId, cityKey, mode = 'manual', botKey = DEFAULT_BOT_KEY) {
  const user = getUser(chatId, botKey);
  const lang = normalizeLanguage(user.language);
  const opts = userOptions(user);
  const { city, weather, air } = await fetchWeather(cityKey);
  logEvent('weather', `Weather report requested for ${city.key}`, { chatId, cityKey: city.key, lang });
  return sendMessage(chatId, formatReport(city, weather, air, mode, lang, opts), {}, botKey);
}
async function createChartBuffer(cityKey, mode = 'daily') {
  const { city, weather } = await fetchWeather(cityKey);
  const h = weather.hourly;
  const indexes = todayRangeIndexes(h.time, 'manual');
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
    options: { responsive: false, plugins: { title: { display: true, text: `Weather Chart - ${city.name} - ${rangeLabel('manual')}` }, legend: { display: true } }, scales: { y: { beginAtZero: true } } }
  });
}
async function sendChartToTelegram(chatId, cityKey, mode = 'manual', botKey = DEFAULT_BOT_KEY) {
  const key = normalizeCityKey(cityKey);
  if (!cities[key]) throw new Error('City not found');
  logEvent('chart', `Chart requested for ${key}`, { chatId, cityKey: key });
  const buffer = await createChartBuffer(key, mode);
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('caption', `📊 ${cityLabel(cities[key], normalizeLanguage(getUser(chatId, botKey).language))}`);
  form.append('photo', new Blob([buffer], { type: 'image/png' }), `weather-${key}.png`);
  return fetch(`https://api.telegram.org/bot${getBotToken(botKey)}/sendPhoto`, { method: 'POST', body: form });
}
async function sendAllDailyReport(chatId = DEFAULT_CHAT_ID, mode = 'manual', botKey = DEFAULT_BOT_KEY) {
  if (!chatId) throw new Error('TELEGRAM_CHAT_ID is missing');
  const user = getUser(chatId, botKey);
  const keys = user.city ? [normalizeCityKey(user.city)] : settings.selectedCities;
  for (const key of keys) {
    try { await sendWeatherToTelegram(chatId, key, mode, botKey); } catch (err) { await sendMessage(chatId, `❌ ${key}: ${err.message}`, {}, botKey); }
  }
}
async function sendDailyReportsToDueUsers() {
  const today = todayDateString();
  const nowTime = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  const allUsers = Object.values(users).filter(u => u.isActive !== false);
  for (const u of allUsers) {
    const due = u.sendTime || settings.sendTime || '08:00';
    const sentKey = `${today}:${u.chatId}`;
    if (nowTime === due && sentDaily[sentKey] !== due) {
      await sendAllDailyReport(u.chatId, 'daily', u.botKey || DEFAULT_BOT_KEY);
      sentDaily[sentKey] = due;
      saveSentDaily();
      logEvent('daily', `Daily report sent to user ${u.chatId}`, { chatId: u.chatId, due });
    }
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
  if (!settings.realTimeAlerts) return;
  const activeUsers = Object.values(users).filter(u => u.isActive !== false);
  if (!activeUsers.length) return;
  for (const key of settings.selectedCities) {
    try {
      const { city, weather, air } = await fetchWeather(key);
      const { summary, alerts } = analyzeWeather(city, weather, air, 'manual', settings);
      const filtered = alerts.filter(a => shouldAlert(key, a));
      if (!filtered.length) continue;
      for (const u of activeUsers) {
        const lang = normalizeLanguage(u.language);
        const opts = userOptions(u);
        const title = lang === 'es' ? 'Alerta meteorológica inmediata' : lang === 'ar' ? 'تنبيه طقس فوري' : 'هشدار فوری آب‌وهوا';
        const quick = lang === 'es' ? 'Análisis rápido' : lang === 'ar' ? 'تحليل سريع' : 'تحلیل سریع';
        await sendMessage(u.chatId, `🚨 ${title}\n📍 ${cityLabel(city, lang)}\n\n${filtered.map(a => `⚠️ ${a}`).join('\n')}\n\n🤖 ${quick}:\n${aiLikeSummary(city, summary, filtered, lang, opts)}`);
      }
      logEvent('alert', `Real-time alert sent for ${key}`, { alerts: filtered, users: activeUsers.length });
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
    scheduledDailyTask = cron.schedule('* * * * *', () => sendDailyReportsToDueUsers().catch(err => console.error('Daily users job error:', err.message)), { timezone: TIMEZONE });
    console.log(`Multi-user daily reports checker scheduled every minute (${TIMEZONE})`);
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

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'weather-render-bot', time: new Date().toISOString(), settings, defaultBotKey: DEFAULT_BOT_KEY, bots: listBots() }));
app.get('/api/report-preview', async (req, res) => {
  try { const { city, weather, air } = await fetchWeather(req.query.city || 'madrid'); const mode = req.query.mode === 'manual' ? 'manual' : 'daily'; res.type('text/plain').send(formatReport(city, weather, air, mode)); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});
app.get('/api/chart', async (req, res) => {
  try { const mode = req.query.mode === 'manual' ? 'manual' : 'daily'; const buffer = await createChartBuffer(req.query.city || 'madrid', mode); res.set('Content-Type', 'image/png').send(buffer); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});
app.get('/api/send-telegram', async (req, res) => {
  try { const key = req.query.city ? normalizeCityKey(req.query.city) : null; if (key) await sendWeatherToTelegram(DEFAULT_CHAT_ID, key, 'manual', normalizeBotKey(req.query.botKey)); else await sendAllDailyReport(DEFAULT_CHAT_ID, 'manual', normalizeBotKey(req.query.botKey)); res.json({ ok: true, sent: key || 'all' }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});
app.get('/api/set-webhook', async (req, res) => {
  try {
    if (!PUBLIC_URL) return res.status(400).json({ ok: false, error: 'PUBLIC_URL is missing' });
    const base = PUBLIC_URL.replace(/\/$/, '');
    const results = [];
    for (const bot of listBots()) {
      const webhookUrl = `${base}/webhook/${bot.key}`;
      const result = await axios.post(`https://api.telegram.org/bot${getBotToken(bot.key)}/setWebhook`, { url: webhookUrl, allowed_updates: ['message', 'callback_query'] });
      results.push({ botKey: bot.key, webhookUrl, telegram: result.data });
    }
    res.json({ ok: true, defaultBotKey: DEFAULT_BOT_KEY, bots: listBots(), results });
  } catch (err) { res.status(500).json({ ok: false, error: err.response?.data || err.message }); }
});
app.get('/api/bots', (req, res) => res.json({ ok: true, defaultBotKey: DEFAULT_BOT_KEY, bots: listBots() }));
app.get('/api/map-data', async (req, res) => {
  const result = [];
  for (const key of Object.keys(cities)) {
    try {
      const { city, weather, air } = await fetchWeather(key);
      const { summary, alerts } = analyzeWeather(city, weather, air, 'daily');
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
    const { summary, alerts } = analyzeWeather(city, weather, air, 'manual');
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
    res.type('text/plain').send(formatReport(city, weather, air, 'manual'));
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/point-chart', async (req, res) => {
  try {
    const label = req.query.name || await reverseGeocode(req.query.lat, req.query.lon);
    const { city, weather } = await fetchWeatherForPoint(req.query.lat, req.query.lon, label);
    const h = weather.hourly;
    const indexes = todayRangeIndexes(h.time, 'manual');
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
      options: { responsive: false, plugins: { title: { display: true, text: `Weather Chart - ${city.name} - ${rangeLabel('manual')}` }, legend: { display: true } }, scales: { y: { beginAtZero: true } } }
    });
    res.set('Content-Type', 'image/png').send(buffer);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/city-details', async (req, res) => {
  try {
    const key = normalizeCityKey(req.query.city || 'madrid');
    if (!key || !cities[key]) return res.status(404).json({ ok: false, error: 'City not found' });
    const { city, weather, air } = await fetchWeather(key);
    const { summary, alerts } = analyzeWeather(city, weather, air, 'daily');
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


function userSettingsText(chatId, botKey = DEFAULT_BOT_KEY) {
  const u = getUser(chatId, botKey);
  const lang = normalizeLanguage(u.language);
  const city = cities[normalizeCityKey(u.city || 'madrid')];
  return `${tr(lang,'settingsText')}\n${tr(lang,'dailyTime')}: ${u.sendTime || settings.sendTime}\n${tr(lang,'city')}: ${city ? cityLabel(city, lang) : u.city}\n${tr(lang,'rainLimit')}: ${u.rainThreshold || settings.rainThreshold}%\n${tr(lang,'language')}: ${lang}\n${u.isActive !== false ? tr(lang,'active') : tr(lang,'inactive')}`;
}
function parseCommandArg(text, index = 1) { return String(text || '').trim().split(/\s+/)[index]; }
app.post(['/webhook', '/webhook/:botKey'], async (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  const botKey = botKeyFromReq(req);
  try {
    if (update.callback_query) {
      const callback = update.callback_query;
      const chatId = callback.message.chat.id;
      recordUser(callback.from, chatId, botKey);
      const data = callback.data || '';
      answerCallback(callback.id, botKey);
      const parts = data.includes(':') ? data.split(':') : data.split('_');
      const action = parts[0];
      const user = getUser(chatId, botKey);
      const lang = normalizeLanguage(user.language);
      const cityKey = normalizeCityKey(parts[1]);
      if (action === 'weather') return cities[cityKey] ? sendWeatherToTelegram(chatId, cityKey, 'manual', botKey) : sendMessage(chatId, tr(lang, 'cityNotFound'));
      if (action === 'chart') return cities[cityKey] ? sendChartToTelegram(chatId, cityKey, 'manual', botKey) : sendMessage(chatId, tr(lang, 'cityNotFound'));
      if (action === 'alerts') return sendMessage(chatId, `⚠️ Real-Time Alerts: ${settings.realTimeAlerts ? 'ON' : 'OFF'}\n${tr(lang,'dailyTime')}: ${user.sendTime || settings.sendTime}\n${tr(lang,'rainLimit')}: ${user.rainThreshold || settings.rainThreshold}%`);
      if (action === 'settings') return sendMessage(chatId, userSettingsText(chatId, botKey));
      if (action === 'lang') {
        const selected = normalizeLanguage(parts[1]);
        saveUserObject({ ...getUser(chatId, botKey), language: selected });
        return sendMessage(chatId, tr(selected, 'setLangOk'));
      }
      return;
    }

    const msg = update.message;
    if (!msg || !msg.text) return;
    const chatId = msg.chat.id;
    recordUser(msg.from, chatId, botKey);
    const text = msg.text.trim();
    const lower = text.toLowerCase();
    const user = getUser(chatId, botKey);
    const lang = normalizeLanguage(user.language);
    logEvent('message', `Telegram command: ${text}`, { chatId });

    if (lower === '/start' || lower === '/menu') return sendMainMenu(chatId, botKey);
    if (lower === '/help') return sendMessage(chatId, tr(lang, 'help'));
    if (lower === '/mysettings' || lower === '/settings') return sendMessage(chatId, userSettingsText(chatId, botKey));
    if (lower === '/map') return sendMessage(chatId, `${tr(lang, 'mapLink')}\n${PUBLIC_URL ? PUBLIC_URL.replace(/\/$/, '') + '/map' : 'PUBLIC_URL is missing'}`);
    if (lower.startsWith('/weather')) {
      const key = normalizeCityKey(parseCommandArg(text) || user.city || 'madrid');
      return cities[key] ? sendWeatherToTelegram(chatId, key, 'manual', botKey) : sendMessage(chatId, tr(lang, 'cityNotFound') + ' /weather madrid');
    }
    if (lower.startsWith('/chart')) {
      const key = normalizeCityKey(parseCommandArg(text) || user.city || 'madrid');
      return cities[key] ? sendChartToTelegram(chatId, key, 'manual', botKey) : sendMessage(chatId, tr(lang, 'cityNotFound') + ' /chart tehran');
    }
    if (lower === '/all') return sendAllDailyReport(chatId, 'manual', botKey);

    if (lower.startsWith('/settime')) {
      const newTime = parseCommandArg(text);
      if (!newTime || !/^\d{2}:\d{2}$/.test(newTime)) return sendMessage(chatId, tr(lang,'setTimeBad'));
      const [hh, mm] = newTime.split(':').map(Number);
      if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return sendMessage(chatId, tr(lang,'setTimeBad'));
      saveUserObject({ ...getUser(chatId, botKey), sendTime: newTime });
      return sendMessage(chatId, `${tr(lang,'setTimeOk')} ${newTime}`);
    }
    if (lower.startsWith('/setcity')) {
      const key = normalizeCityKey(parseCommandArg(text));
      if (!key || !cities[key]) return sendMessage(chatId, tr(lang,'cityNotFound') + ' /setcity madrid');
      saveUserObject({ ...getUser(chatId, botKey), city: key });
      return sendMessage(chatId, `${tr(lang,'setCityOk')} ${cityLabel(cities[key], lang)}`);
    }
    if (lower.startsWith('/setrain')) {
      const val = Number(parseCommandArg(text));
      if (Number.isNaN(val) || val < 0 || val > 100) return sendMessage(chatId, '❌ /setrain 50');
      saveUserObject({ ...getUser(chatId, botKey), rainThreshold: val });
      return sendMessage(chatId, `${tr(lang,'rainLimit')}: ${val}%`);
    }
    if (lower.startsWith('/lang')) {
      const selected = normalizeLanguage(parseCommandArg(text));
      saveUserObject({ ...getUser(chatId, botKey), language: selected });
      return sendMessage(chatId, tr(selected,'setLangOk'));
    }
    if (lower === '/chatid') return sendMessage(chatId, `Your Chat ID: <code>${chatId}</code>\nBot Key: <code>${botKey}</code>`, {}, botKey);
    if (lower === '/mybot') return sendMessage(chatId, `Bot Key: <code>${botKey}</code>
Chat ID: <code>${chatId}</code>`, {}, botKey);
    if (lower.startsWith('/adduser')) {
      if (!isAdminChat(chatId, botKey)) return sendMessage(chatId, tr(lang, 'notAdmin'), {}, botKey);
      const parts = text.trim().split(/\s+/);
      const newId = parts[1];
      const selected = normalizeLanguage(parts[2] || settings.language);
      const selectedBotKey = normalizeBotKey(parts[3] || botKey);
      if (!newId) return sendMessage(chatId, `Usage: /adduser 123456789 es main\nیا: /adduser 914709600 ar second`, {}, botKey);
      const storageKey = `${selectedBotKey}:${newId}`;
      users[storageKey] = { ...(users[storageKey] || {}), storageKey, botKey: selectedBotKey, chatId: String(newId), language: selected, city: 'madrid', sendTime: settings.sendTime, rainThreshold: settings.rainThreshold, isActive: true, createdAt: users[storageKey]?.createdAt || new Date().toISOString(), lastSeen: users[storageKey]?.lastSeen || '' };
      saveUsers();
      return sendMessage(chatId, `User saved: ${storageKey}`, {}, botKey);
    }
    if (lower.startsWith('/removeuser')) {
      if (!isAdminChat(chatId, botKey)) return sendMessage(chatId, tr(lang, 'notAdmin'), {}, botKey);
      const remId = parseCommandArg(text);
      const remBotKey = normalizeBotKey(text.trim().split(/\s+/)[2] || botKey);
      const storageKey = users[String(remId)] ? String(remId) : `${remBotKey}:${remId}`;
      if (!remId || !users[storageKey]) return sendMessage(chatId, 'User not found', {}, botKey);
      users[storageKey].isActive = false;
      saveUsers();
      return sendMessage(chatId, tr(lang, 'userRemoved'), {}, botKey);
    }
    if (lower.startsWith('/broadcast')) {
      if (!isAdminChat(chatId, botKey)) return sendMessage(chatId, tr(lang, 'notAdmin'), {}, botKey);
      const message = text.replace(/^\/broadcast\s*/i, '').trim();
      if (!message) return sendMessage(chatId, 'Usage: /broadcast message', {}, botKey);
      let sent = 0, failed = 0;
      for (const u of Object.values(users).filter(x => x.isActive !== false)) {
        try { await sendMessage(u.chatId, message, {}, u.botKey || DEFAULT_BOT_KEY); sent++; } catch (err) { failed++; logEvent('broadcast_error', `Failed to ${u.botKey}:${u.chatId}`, { error: err.response?.data || err.message }); }
      }
      return sendMessage(chatId, `${tr(lang, 'broadcastSent')}
✅ Sent: ${sent}
❌ Failed: ${failed}`, {}, botKey);
    }
    return sendMessage(chatId, tr(lang, 'invalid'));
  } catch (err) { console.error('Webhook processing error:', err.response?.data || err.message); }
});


app.get('/api/admin/settings', adminAuth, (req, res) => res.json({ ok: true, settings, cities, bots: listBots(), defaultBotKey: DEFAULT_BOT_KEY }));
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
    cities[key] = { key, name: body.name, fa: body.fa || body.name, es: body.es || body.name, ar: body.ar || body.name, lat, lon };
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
app.post('/api/admin/users', adminAuth, (req, res) => {
  const chatId = String(req.body.chatId || '').trim();
  if (!chatId) return res.status(400).json({ ok: false, error: 'chatId is required' });
  const botKey = normalizeBotKey(req.body.botKey || DEFAULT_BOT_KEY);
  const storageKey = `${botKey}:${chatId}`;
  const old = users[storageKey] || {};
  users[storageKey] = {
    storageKey,
    botKey,
    chatId,
    firstName: req.body.firstName || old.firstName || '',
    lastName: req.body.lastName || old.lastName || '',
    username: req.body.username || old.username || '',
    languageCode: old.languageCode || '',
    language: normalizeLanguage(req.body.language || old.language || settings.language),
    city: normalizeCityKey(req.body.city || old.city || 'madrid'),
    sendTime: req.body.sendTime || old.sendTime || settings.sendTime || '08:00',
    rainThreshold: Number(req.body.rainThreshold || old.rainThreshold || settings.rainThreshold || 50),
    isActive: req.body.isActive !== false,
    isAdmin: !!req.body.isAdmin || !!old.isAdmin,
    createdAt: old.createdAt || new Date().toISOString(),
    lastSeen: old.lastSeen || new Date().toISOString()
  };
  if (users[chatId]) delete users[chatId];
  saveUsers();
  logEvent('admin', `User saved: ${storageKey}`, users[storageKey]);
  res.json({ ok: true, user: users[storageKey], users: Object.values(users) });
});
app.delete('/api/admin/users/:chatId', adminAuth, (req, res) => {
  const id = String(req.params.chatId);
  const botKey = normalizeBotKey(req.query.botKey || req.body?.botKey || DEFAULT_BOT_KEY);
  const key = users[id] ? id : `${botKey}:${id}`;
  if (!users[key]) return res.status(404).json({ ok: false, error: 'User not found' });
  users[key].isActive = false;
  saveUsers();
  logEvent('admin', `User deactivated: ${key}`);
  res.json({ ok: true, user: users[key] });
});
app.post('/api/admin/broadcast', adminAuth, async (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ ok: false, error: 'text is required' });

  const requestedBotKeyRaw = String(req.body.botKey || '').trim();
  const targetBotKey = requestedBotKeyRaw ? canonicalBotKey(requestedBotKeyRaw) : null;

  const allUsers = Object.values(users || {});
  const targetUsers = allUsers.filter(u => {
    if (u.isActive === false || !u.chatId) return false;
    const userBotKey = canonicalBotKey(u.botKey || DEFAULT_BOT_KEY);
    return !targetBotKey || userBotKey === targetBotKey;
  });

  const results = [];

  for (const u of targetUsers) {
    const userBotKey = canonicalBotKey(u.botKey || DEFAULT_BOT_KEY);
    const row = {
      chatId: String(u.chatId),
      botKey: userBotKey,
      username: u.username || '',
      firstName: u.firstName || '',
      ok: false,
      status: 'failed',
      errorCode: null,
      description: ''
    };

    const tokenState = botTokenStatus(userBotKey);
    if (!tokenState.ok) {
      row.status = 'bot_token_missing_or_invalid';
      row.description = tokenState.error;
      logEvent('broadcast_error', `❌ ${tokenState.error} for ${userBotKey}:${u.chatId}`, row);
      results.push(row);
      continue;
    }

    try {
      const token = getBotTokenStrict(userBotKey);
      const response = await axios.post(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          chat_id: row.chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        },
        { timeout: 20000 }
      );
      row.ok = true;
      row.status = 'sent';
      row.messageId = response.data?.result?.message_id;
      row.description = 'Message sent successfully';
      logEvent('broadcast', `✅ Sent to ${userBotKey}:${u.chatId}`, row);
    } catch (err) {
      const tg = err.response?.data;
      row.errorCode = tg?.error_code || null;
      row.description = tg?.description || err.message;

      if (row.errorCode === 401) row.status = 'invalid_bot_token';
      else if (row.errorCode === 403) row.status = 'blocked_or_not_started_for_this_bot';
      else if (row.errorCode === 400) row.status = 'chat_not_found_or_bad_request';
      else if (err.code === 'ECONNABORTED') row.status = 'telegram_timeout';
      else row.status = 'telegram_error';

      logEvent('broadcast_error', `❌ Failed to ${userBotKey}:${u.chatId}`, row);
    }

    results.push(row);
  }

  const sent = results.filter(x => x.ok).length;
  const failed = results.length - sent;
  const byBot = results.reduce((acc, r) => {
    acc[r.botKey] = acc[r.botKey] || { total: 0, sent: 0, failed: 0 };
    acc[r.botKey].total += 1;
    if (r.ok) acc[r.botKey].sent += 1;
    else acc[r.botKey].failed += 1;
    return acc;
  }, {});

  logEvent('admin', 'Broadcast completed', { sent, failed, total: results.length, targetBotKey: targetBotKey || 'all', byBot });
  res.json({ ok: true, total: results.length, sent, failed, targetBotKey: targetBotKey || 'all', byBot, results });
});
app.get('/api/admin/bot-status', adminAuth, (req, res) => {
  const bots = Object.keys(BOT_TOKENS).map(key => ({
    key,
    isDefault: key === DEFAULT_BOT_KEY,
    configured: !!BOT_TOKENS[key],
    validFormat: looksLikeTelegramBotToken(BOT_TOKENS[key]),
    tokenHint: BOT_TOKENS[key] ? String(BOT_TOKENS[key]).slice(0, 8) + '...' : ''
  }));
  const userStats = Object.values(users || {}).reduce((acc, u) => {
    const key = canonicalBotKey(u.botKey || DEFAULT_BOT_KEY);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  res.json({ ok: true, defaultBotKey: DEFAULT_BOT_KEY, bots, userStats });
});

app.get('/api/admin/logs', adminAuth, (req, res) => res.json({ ok: true, logs: logs.slice().reverse() }));
app.delete('/api/admin/logs', adminAuth, (req, res) => { logs = []; saveLogs(); res.json({ ok: true, logs }); });
app.post('/api/admin/send-city', adminAuth, async (req, res) => { try { const key = normalizeCityKey(req.body.city || 'madrid'); await sendWeatherToTelegram(DEFAULT_CHAT_ID, key, 'manual', normalizeBotKey(req.body.botKey)); res.json({ ok: true, sent: key, botKey: normalizeBotKey(req.body.botKey) }); } catch (err) { res.status(500).json({ ok: false, error: err.message }); } });
app.post('/api/admin/send-now', adminAuth, async (req, res) => { try { await sendAllDailyReport(DEFAULT_CHAT_ID, 'manual', normalizeBotKey(req.body.botKey)); res.json({ ok: true, message: 'Daily report sent', botKey: normalizeBotKey(req.body.botKey) }); } catch (err) { res.status(500).json({ ok: false, error: err.message }); } });
app.post('/api/admin/test-alerts', adminAuth, async (req, res) => { try { await checkRealTimeAlerts(); res.json({ ok: true, message: 'Alert check executed' }); } catch (err) { res.status(500).json({ ok: false, error: err.message }); } });

app.get('/map', (req, res) => res.sendFile(path.join(__dirname, 'public', 'map.html')));

scheduleJobs();
app.listen(PORT, () => console.log(`Weather Telegram Bot is running on port ${PORT}`));
