require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PUBLIC_URL = process.env.PUBLIC_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const DEFAULT_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const TIMEZONE = process.env.TIMEZONE || 'Europe/Madrid';
const RAIN_THRESHOLD = Number(process.env.RAIN_THRESHOLD || 50);
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
function getUsers() {
  const users = readJson(USERS_FILE, []);
  if (DEFAULT_CHAT_ID && !users.some(u => String(u.chatId) === String(DEFAULT_CHAT_ID))) {
    users.push({
      chatId: String(DEFAULT_CHAT_ID), username: '', firstName: 'Default Admin', language: 'fa', city: 'madrid', sendTime: '08:00', rainThreshold: RAIN_THRESHOLD, isActive: true, isAdmin: true, createdAt: new Date().toISOString(), lastSeen: new Date().toISOString()
    });
    writeJson(USERS_FILE, users);
  }
  return users;
}
function saveUsers(users) { writeJson(USERS_FILE, users); }
function getLogs() { return readJson(LOGS_FILE, []); }
function addLog(type, message, meta = {}) {
  const logs = getLogs();
  logs.unshift({ time: new Date().toISOString(), type, message, meta });
  writeJson(LOGS_FILE, logs.slice(0, 800));
}
function getSettings() {
  return readJson(SETTINGS_FILE, { sendTime: '08:00', rainThreshold: RAIN_THRESHOLD, windWarningKmh: 45, uvWarning: 7 });
}
function saveSettings(settings) { writeJson(SETTINGS_FILE, settings); }

const cities = {
  salamanca: { name: 'Salamanca', country: 'Spain', lat: 40.9701, lon: -5.6635 },
  madrid: { name: 'Madrid', country: 'Spain', lat: 40.4168, lon: -3.7038 },
  tehran: { name: 'Tehran', country: 'Iran', lat: 35.6892, lon: 51.3890 },
  ardabil: { name: 'Ardabil', country: 'Iran', lat: 38.2498, lon: 48.2933 }
};
function normalizeCity(c) { return String(c || '').toLowerCase().trim().replace(/[^a-z]/g, ''); }
function t(lang, key) {
  const dict = {
    fa: { welcome: 'سلام! به بات هواشناسی خوش آمدید.', menu: 'منو:', saved: 'ذخیره شد.', invalid: 'دستور نامعتبر است.', cityNotFound: 'شهر پیدا نشد.', mysettings: 'تنظیمات شما', broadcastDone: 'ارسال همگانی انجام شد.' },
    es: { welcome: '¡Hola! Bienvenido al bot del clima.', menu: 'Menú:', saved: 'Guardado.', invalid: 'Comando inválido.', cityNotFound: 'Ciudad no encontrada.', mysettings: 'Tus ajustes', broadcastDone: 'Difusión enviada.' },
    ar: { welcome: 'مرحباً! أهلاً بك في بوت الطقس.', menu: 'القائمة:', saved: 'تم الحفظ.', invalid: 'أمر غير صالح.', cityNotFound: 'لم يتم العثور على المدينة.', mysettings: 'إعداداتك', broadcastDone: 'تم إرسال الرسالة الجماعية.' }
  };
  return (dict[lang] || dict.fa)[key] || key;
}
function requireAdmin(req, res, next) {
  const pass = req.headers['x-admin-password'] || req.body.adminPassword || req.query.password;
  if (String(pass || '') !== String(ADMIN_PASSWORD)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized. ADMIN_PASSWORD is missing or wrong.' });
  }
  next();
}
async function telegram(method, payload) {
  if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is missing');
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
  const { data } = await axios.post(url, payload, { timeout: 20000 });
  return data;
}
async function sendMessage(chatId, text, extra = {}) {
  return telegram('sendMessage', { chat_id: String(chatId), text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
}
async function answerCallbackQuery(id, text = '') {
  try { await telegram('answerCallbackQuery', { callback_query_id: id, text }); } catch (e) { addLog('telegram', 'answerCallbackQuery failed', { error: e.response?.data || e.message }); }
}
async function setWebhook() {
  if (!PUBLIC_URL) throw new Error('PUBLIC_URL is missing');
  return telegram('setWebhook', { url: `${PUBLIC_URL.replace(/\/$/, '')}/webhook` });
}
function upsertUser(from, chatId, lang = 'fa') {
  const users = getUsers();
  let user = users.find(u => String(u.chatId) === String(chatId));
  if (!user) {
    user = { chatId: String(chatId), username: from?.username || '', firstName: from?.first_name || '', language: lang, city: 'madrid', sendTime: '08:00', rainThreshold: RAIN_THRESHOLD, isActive: true, isAdmin: false, createdAt: new Date().toISOString(), lastSeen: new Date().toISOString() };
    users.push(user);
  } else {
    user.username = from?.username || user.username || '';
    user.firstName = from?.first_name || user.firstName || '';
    user.lastSeen = new Date().toISOString();
  }
  saveUsers(users);
  return user;
}
async function fetchWeather(cityKey, options = {}) {
  const city = cities[normalizeCity(cityKey)] || cities.madrid;
  const url = 'https://api.open-meteo.com/v1/forecast';
  const params = {
    latitude: city.lat,
    longitude: city.lon,
    timezone: TIMEZONE,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m',
    hourly: 'temperature_2m,precipitation_probability,wind_speed_10m,relative_humidity_2m,uv_index',
    daily: 'sunrise,sunset,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    forecast_days: 1
  };
  const { data } = await axios.get(url, { params, timeout: 20000 });
  return { city, data };
}
function buildWeatherText(cityKey, user = {}, mode = 'manual') {
  return fetchWeather(cityKey).then(({ city, data }) => {
    const threshold = Number(user.rainThreshold || RAIN_THRESHOLD);
    const now = new Date();
    const hours = data.hourly?.time || [];
    const rain = data.hourly?.precipitation_probability || [];
    const temp = data.hourly?.temperature_2m || [];
    const wind = data.hourly?.wind_speed_10m || [];
    let startHour = mode === 'manual' ? now.getHours() : 8;
    const selected = hours.map((h, i) => ({ h, rain: rain[i], temp: temp[i], wind: wind[i] }))
      .filter(x => {
        const hour = Number(String(x.h).slice(11, 13));
        return hour >= startHour && hour <= 23;
      });
    const risky = selected.filter(x => Number(x.rain) >= threshold);
    const lang = user.language || 'fa';
    const title = lang === 'es' ? `🌤 Informe del clima: ${city.name}` : lang === 'ar' ? `🌤 تقرير الطقس: ${city.name}` : `🌤 گزارش هواشناسی: ${city.name}`;
    const range = lang === 'es' ? `⏰ Rango: desde ahora hasta 24:00` : lang === 'ar' ? `⏰ الفترة: من الآن حتى 24:00` : `⏰ بازه: از همین لحظه تا 24:00`;
    let msg = `${title}\n${range}\n\n`;
    msg += `🌡 ${data.current.temperature_2m}°C | Feels: ${data.current.apparent_temperature}°C\n`;
    msg += `💧 Humidity: ${data.current.relative_humidity_2m}%\n`;
    msg += `💨 Wind: ${data.current.wind_speed_10m} km/h\n`;
    msg += `🌅 ${data.daily.sunrise?.[0]?.slice(11, 16) || '-'} | 🌇 ${data.daily.sunset?.[0]?.slice(11, 16) || '-'}\n\n`;
    if (risky.length) {
      msg += `⚠️ Rain probability >= ${threshold}%:\n`;
      msg += risky.map(x => `• ${String(x.h).slice(11, 16)} → ${x.rain}%`).join('\n');
    } else {
      msg += lang === 'es' ? `✅ No hay horas con lluvia mayor a ${threshold}%.` : lang === 'ar' ? `✅ لا توجد ساعات باحتمال مطر أعلى من ${threshold}%.` : `✅ ساعتی با احتمال بارندگی بالای ${threshold}% دیده نشد.`;
    }
    return msg;
  });
}
function mainMenu(lang = 'fa') {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🌤 Madrid', callback_data: 'weather:madrid' }, { text: '🌤 Salamanca', callback_data: 'weather:salamanca' }],
        [{ text: '🌤 Tehran', callback_data: 'weather:tehran' }, { text: '🌤 Ardabil', callback_data: 'weather:ardabil' }],
        [{ text: '🗺 Live Map', url: `${PUBLIC_URL || ''}/map` }, { text: '⚙ Admin Panel', url: `${PUBLIC_URL || ''}/` }]
      ]
    }
  };
}

async function broadcastMessage(text) {
  const users = getUsers().filter(u => u.isActive !== false && u.chatId);
  const results = [];
  for (const user of users) {
    const item = { chatId: String(user.chatId), username: user.username || '', firstName: user.firstName || '', ok: false, status: 'failed', errorCode: null, description: '' };
    try {
      const resp = await sendMessage(user.chatId, text);
      item.ok = true;
      item.status = 'sent';
      item.messageId = resp.result?.message_id;
      addLog('broadcast', `✅ Sent to ${user.chatId}`, { chatId: user.chatId, username: user.username });
    } catch (e) {
      const err = e.response?.data;
      item.errorCode = err?.error_code || null;
      item.description = err?.description || e.message;
      if (item.errorCode === 403) item.status = 'blocked_or_not_started';
      else if (item.errorCode === 400) item.status = 'chat_not_found_or_bad_request';
      addLog('broadcast_error', `❌ Failed to ${user.chatId}`, { chatId: user.chatId, username: user.username, error: err || e.message });
    }
    results.push(item);
  }
  addLog('admin', `Broadcast completed: ${results.filter(r => r.ok).length}/${results.length}`, { results });
  return { ok: true, total: results.length, sent: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results };
}

app.get('/api/set-webhook', async (req, res) => {
  try { res.json(await setWebhook()); }
  catch (e) { res.status(400).json({ ok: false, error: e.response?.data || e.message }); }
});
app.get('/api/admin/users', requireAdmin, (req, res) => res.json({ ok: true, users: getUsers() }));
app.get('/api/admin/logs', requireAdmin, (req, res) => res.json({ ok: true, logs: getLogs().slice(0, 200) }));
app.post('/api/admin/logs/clear', requireAdmin, (req, res) => { writeJson(LOGS_FILE, []); res.json({ ok: true }); });
app.post('/api/admin/users', requireAdmin, (req, res) => {
  const { chatId, username = '', firstName = '', language = 'fa', city = 'madrid', sendTime = '08:00', rainThreshold = RAIN_THRESHOLD, isAdmin = false } = req.body;
  if (!chatId) return res.status(400).json({ ok: false, error: 'chatId is required' });
  const users = getUsers();
  let user = users.find(u => String(u.chatId) === String(chatId));
  if (!user) {
    user = { chatId: String(chatId), username, firstName, language, city, sendTime, rainThreshold: Number(rainThreshold), isActive: true, isAdmin: Boolean(isAdmin), createdAt: new Date().toISOString(), lastSeen: new Date().toISOString() };
    users.push(user);
  } else Object.assign(user, { username, firstName, language, city, sendTime, rainThreshold: Number(rainThreshold), isAdmin: Boolean(isAdmin), lastSeen: new Date().toISOString() });
  saveUsers(users);
  addLog('admin', `User saved: ${chatId}`, user);
  res.json({ ok: true, user });
});
app.delete('/api/admin/users/:chatId', requireAdmin, (req, res) => {
  const users = getUsers().filter(u => String(u.chatId) !== String(req.params.chatId));
  saveUsers(users);
  addLog('admin', `User deleted: ${req.params.chatId}`);
  res.json({ ok: true });
});
app.post('/api/admin/broadcast', requireAdmin, async (req, res) => {
  try {
    const text = String(req.body.text || '').trim();
    if (!text) return res.status(400).json({ ok: false, error: 'Broadcast message text is empty.' });
    const result = await broadcastMessage(text);
    res.json(result);
  } catch (e) { res.status(500).json({ ok: false, error: e.response?.data || e.message }); }
});
app.get('/api/admin/settings', requireAdmin, (req, res) => res.json({ ok: true, settings: getSettings() }));
app.post('/api/admin/settings', requireAdmin, (req, res) => { saveSettings({ ...getSettings(), ...req.body }); res.json({ ok: true, settings: getSettings() }); });
app.get('/api/report-preview', async (req, res) => {
  try { res.type('text').send(await buildWeatherText(req.query.city || 'madrid', {}, 'manual')); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/map', (req, res) => res.sendFile(path.join(__dirname, 'public', 'map.html')));

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  try {
    if (update.callback_query) {
      const cb = update.callback_query;
      await answerCallbackQuery(cb.id);
      const chatId = cb.message.chat.id;
      const user = upsertUser(cb.from, chatId);
      const [action, rawCity] = String(cb.data || '').replace('_', ':').split(':');
      const city = normalizeCity(rawCity || user.city);
      addLog('telegram', `Callback data: ${cb.data}`, { chatId });
      if (action === 'weather') {
        if (!cities[city]) return sendMessage(chatId, t(user.language, 'cityNotFound'));
        return sendMessage(chatId, await buildWeatherText(city, user, 'manual'));
      }
      return;
    }
    const msg = update.message;
    if (!msg || !msg.chat) return;
    const chatId = msg.chat.id;
    const text = String(msg.text || '').trim();
    let user = upsertUser(msg.from, chatId);
    addLog('message', `Telegram command: ${text}`, { chatId });
    if (text === '/start') return sendMessage(chatId, `${t(user.language, 'welcome')}\nChat ID: <code>${chatId}</code>`, mainMenu(user.language));
    if (text === '/menu') return sendMessage(chatId, t(user.language, 'menu'), mainMenu(user.language));
    if (text === '/chatid') return sendMessage(chatId, `Your Chat ID: <code>${chatId}</code>`);
    if (text.startsWith('/lang ')) {
      const lang = text.split(/\s+/)[1];
      if (!['fa','es','ar'].includes(lang)) return sendMessage(chatId, 'Use: /lang fa | /lang es | /lang ar');
      const users = getUsers(); const u = users.find(x => String(x.chatId) === String(chatId)); u.language = lang; saveUsers(users);
      return sendMessage(chatId, t(lang, 'saved'));
    }
    if (text.startsWith('/setcity ')) {
      const city = normalizeCity(text.split(/\s+/)[1]);
      if (!cities[city]) return sendMessage(chatId, t(user.language, 'cityNotFound'));
      const users = getUsers(); const u = users.find(x => String(x.chatId) === String(chatId)); u.city = city; saveUsers(users);
      return sendMessage(chatId, t(user.language, 'saved'));
    }
    if (text.startsWith('/settime ')) {
      const tm = text.split(/\s+/)[1];
      if (!/^\d{2}:\d{2}$/.test(tm)) return sendMessage(chatId, 'Format: /settime 08:00');
      const users = getUsers(); const u = users.find(x => String(x.chatId) === String(chatId)); u.sendTime = tm; saveUsers(users);
      return sendMessage(chatId, t(user.language, 'saved'));
    }
    if (text.startsWith('/setrain ')) {
      const val = Number(text.split(/\s+/)[1]);
      if (Number.isNaN(val)) return sendMessage(chatId, 'Format: /setrain 50');
      const users = getUsers(); const u = users.find(x => String(x.chatId) === String(chatId)); u.rainThreshold = val; saveUsers(users);
      return sendMessage(chatId, t(user.language, 'saved'));
    }
    if (text === '/mysettings') return sendMessage(chatId, `${t(user.language, 'mysettings')}\nCity: ${user.city}\nTime: ${user.sendTime}\nRain: ${user.rainThreshold}%\nLang: ${user.language}\nChat ID: ${user.chatId}`);
    if (text.startsWith('/weather')) {
      const city = normalizeCity(text.split(/\s+/)[1] || user.city);
      if (!cities[city]) return sendMessage(chatId, t(user.language, 'cityNotFound'));
      return sendMessage(chatId, await buildWeatherText(city, user, 'manual'));
    }
    if (text.startsWith('/adduser ')) {
      if (!user.isAdmin && String(chatId) !== String(DEFAULT_CHAT_ID)) return sendMessage(chatId, 'Admin only');
      const [, newId, lang = 'fa'] = text.split(/\s+/);
      const users = getUsers();
      if (!users.some(u => String(u.chatId) === String(newId))) users.push({ chatId: String(newId), username: '', firstName: '', language: lang, city: 'madrid', sendTime: '08:00', rainThreshold: RAIN_THRESHOLD, isActive: true, isAdmin: false, createdAt: new Date().toISOString(), lastSeen: new Date().toISOString() });
      saveUsers(users);
      return sendMessage(chatId, `User saved: ${newId}`);
    }
    if (text.startsWith('/broadcast ')) {
      if (!user.isAdmin && String(chatId) !== String(DEFAULT_CHAT_ID)) return sendMessage(chatId, 'Admin only');
      const out = await broadcastMessage(text.replace('/broadcast ', '').trim());
      return sendMessage(chatId, `Broadcast result:\n✅ Sent: ${out.sent}\n❌ Failed: ${out.failed}\nTotal: ${out.total}`);
    }
    return sendMessage(chatId, t(user.language, 'invalid'));
  } catch (e) { addLog('webhook_error', 'Webhook error', { error: e.response?.data || e.message }); }
});

if (process.env.ENABLE_INTERNAL_CRON === 'true') {
  cron.schedule('*/10 * * * *', async () => {
    const now = new Date();
    const hhmm = now.toLocaleTimeString('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit' });
    const users = getUsers().filter(u => u.isActive !== false && u.sendTime === hhmm);
    for (const user of users) {
      try { await sendMessage(user.chatId, await buildWeatherText(user.city, user, 'daily')); addLog('cron', `Daily sent to ${user.chatId}`); }
      catch (e) { addLog('cron_error', `Daily failed to ${user.chatId}`, { error: e.response?.data || e.message }); }
    }
  }, { timezone: TIMEZONE });
}

app.listen(PORT, () => console.log(`Weather Telegram Bot is running on port ${PORT}`));
