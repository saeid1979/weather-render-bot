
require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const cron = require("node-cron");
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEFAULT_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PUBLIC_URL = process.env.PUBLIC_URL;
const TIMEZONE = process.env.TIMEZONE || "Europe/Madrid";
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

const SETTINGS_PATH = path.join(__dirname, "settings.json");

const defaultSettings = {
  sendTime: "08:00",
  language: "fa",
  rainThreshold: Number(process.env.RAIN_THRESHOLD || 50),
  windWarningKmh: Number(process.env.WIND_WARNING_KMH || 55),
  uvWarning: Number(process.env.UV_WARNING || 7),
  heatWarningC: Number(process.env.HEAT_WARNING_C || 35),
  coldWarningC: Number(process.env.COLD_WARNING_C || 0),
  realTimeAlerts: true,
  dailyReport: true,
  selectedCities: ["salamanca", "madrid", "tehran", "ardabil"],
  alertCooldownMinutes: 120
};

const cities = {
  salamanca: { key: "salamanca", name: "Salamanca, Spain", fa: "سالامانکا، اسپانیا", lat: 40.9701, lon: -5.6635 },
  madrid: { key: "madrid", name: "Madrid, Spain", fa: "مادرید، اسپانیا", lat: 40.4168, lon: -3.7038 },
  tehran: { key: "tehran", name: "Tehran, Iran", fa: "تهران، ایران", lat: 35.6892, lon: 51.3890 },
  ardabil: { key: "ardabil", name: "Ardabil, Iran", fa: "اردبیل، ایران", lat: 38.2498, lon: 48.2933 }
};

let scheduledDailyTask = null;
let scheduledAlertTask = null;
const alertMemory = new Map();

function loadSettings() {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) {
      fs.writeFileSync(SETTINGS_PATH, JSON.stringify(defaultSettings, null, 2));
      return { ...defaultSettings };
    }
    const saved = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    return { ...defaultSettings, ...saved };
  } catch (err) {
    console.error("Settings load error:", err.message);
    return { ...defaultSettings };
  }
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

let settings = loadSettings();

function normalizeCityKey(input) {
  if (!input) return null;
  const raw = String(input).trim().toLowerCase();
  const aliases = {
    "salamanca": "salamanca",
    "سالامانکا": "salamanca",
    "madrid": "madrid",
    "مادرید": "madrid",
    "tehran": "tehran",
    "تهران": "tehran",
    "ardabil": "ardabil",
    "اردبیل": "ardabil",
    "ardebil": "ardabil"
  };
  return aliases[raw] || raw;
}

function cityLabel(city) {
  return city.fa || city.name;
}

function todayRangeIndexes(hourlyTimes) {
  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return hourlyTimes
    .map((t, idx) => ({ t, idx }))
    .filter(x => x.t.startsWith(today) && Number(x.t.slice(11, 13)) >= 8 && Number(x.t.slice(11, 13)) <= 23)
    .map(x => x.idx);
}

function hourLabel(iso) {
  return iso.slice(11, 16);
}

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
  if (!city) throw new Error("City not found");
  const [weatherRes, airRes] = await Promise.allSettled([
    axios.get(buildWeatherUrl(city), { timeout: 15000 }),
    axios.get(buildAirUrl(city), { timeout: 15000 })
  ]);
  const weather = weatherRes.status === "fulfilled" ? weatherRes.value.data : null;
  const air = airRes.status === "fulfilled" ? airRes.value.data : null;
  if (!weather) throw new Error("Weather API failed");
  return { city, weather, air };
}

function analyzeWeather(city, weather, air) {
  const h = weather.hourly || {};
  const indexes = todayRangeIndexes(h.time || []);
  const temps = indexes.map(i => h.temperature_2m?.[i]).filter(v => v !== undefined && v !== null);
  const apparent = indexes.map(i => h.apparent_temperature?.[i]).filter(v => v !== undefined && v !== null);
  const rain = indexes.map(i => h.precipitation_probability?.[i]).filter(v => v !== undefined && v !== null);
  const wind = indexes.map(i => h.wind_speed_10m?.[i]).filter(v => v !== undefined && v !== null);
  const uv = indexes.map(i => h.uv_index?.[i]).filter(v => v !== undefined && v !== null);
  const humidity = indexes.map(i => h.relative_humidity_2m?.[i]).filter(v => v !== undefined && v !== null);

  const rainHours = indexes
    .map(i => ({ time: h.time[i], value: h.precipitation_probability?.[i] }))
    .filter(x => typeof x.value === "number" && x.value >= settings.rainThreshold);

  const max = arr => arr.length ? Math.max(...arr) : null;
  const min = arr => arr.length ? Math.min(...arr) : null;
  const avg = arr => arr.length ? Math.round(arr.reduce((a,b)=>a+b,0) / arr.length) : null;

  const aqiValues = air?.hourly?.us_aqi
    ? indexes.map(i => air.hourly.us_aqi[i]).filter(v => v !== undefined && v !== null)
    : [];
  const aqiMax = max(aqiValues);

  const summary = {
    tempMax: max(temps),
    tempMin: min(temps),
    apparentMax: max(apparent),
    rainMax: max(rain),
    windMax: max(wind),
    uvMax: max(uv),
    humidityAvg: avg(humidity),
    aqiMax,
    sunrise: weather.daily?.sunrise?.[0]?.slice(11,16),
    sunset: weather.daily?.sunset?.[0]?.slice(11,16),
    rainHours
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
  if (summary.rainMax >= settings.rainThreshold) {
    parts.push(`در ${name} امروز احتمال بارندگی قابل توجه است و بهتر است چتر همراه داشته باشید.`);
  } else {
    parts.push(`در ${name} امروز احتمال بارندگی مهمی دیده نمی‌شود.`);
  }
  if (summary.tempMax !== null && summary.tempMin !== null) {
    parts.push(`بازه دما حدود ${summary.tempMin} تا ${summary.tempMax} درجه است.`);
  }
  if (summary.windMax >= settings.windWarningKmh) {
    parts.push(`باد می‌تواند شدید شود، برای موتور، دوچرخه و دلیوری احتیاط لازم است.`);
  }
  if (summary.uvMax >= settings.uvWarning) {
    parts.push(`شاخص UV بالاست، بهتر است در ساعات آفتابی از ضدآفتاب و کلاه استفاده شود.`);
  }
  if (summary.aqiMax >= 101) {
    parts.push(`کیفیت هوا برای افراد حساس مناسب نیست.`);
  }
  if (alerts.length === 0) {
    parts.push(`شرایط کلی روز پایدار است.`);
  }
  return parts.join(" ");
}

function formatReport(city, weather, air) {
  const { summary, alerts } = analyzeWeather(city, weather, air);
  const rainHoursText = summary.rainHours.length
    ? summary.rainHours.map(x => `   ⏰ ${hourLabel(x.time)} → ${x.value}%`).join("\n")
    : "   موردی بالای حد هشدار نیست.";

  const alertText = alerts.length ? alerts.map(a => `⚠️ ${a}`).join("\n") : "✅ هشدار مهمی ثبت نشده است.";
  const smart = aiLikeSummary(city, summary, alerts);

  return `🌤 گزارش هوشمند آب‌وهوا
📍 ${cityLabel(city)}
🕗 بازه بررسی: 08:00 تا 24:00
🌍 منطقه زمانی: ${TIMEZONE}

🌡 دما: ${summary.tempMin ?? "-"} تا ${summary.tempMax ?? "-"}°C
🥵 دمای محسوس حداکثر: ${summary.apparentMax ?? "-"}°C
🌧 بیشترین احتمال بارندگی: ${summary.rainMax ?? "-"}%
💨 بیشترین سرعت باد: ${summary.windMax ?? "-"} km/h
💧 میانگین رطوبت: ${summary.humidityAvg ?? "-"}%
☀️ UV Max: ${summary.uvMax ?? "-"}
😷 AQI Max: ${summary.aqiMax ?? "-"}
🌅 طلوع: ${summary.sunrise ?? "-"}
🌇 غروب: ${summary.sunset ?? "-"}

🌧 ساعت‌های بارندگی بالای ${settings.rainThreshold}%:
${rainHoursText}

${alertText}

🤖 خلاصه هوشمند:
${smart}`;
}

async function sendMessage(chatId, text, extra = {}) {
  if (!BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is missing");
  return axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...extra
  }, { timeout: 15000 });
}

async function answerCallback(callbackId) {
  if (!BOT_TOKEN || !callbackId) return;
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
      callback_query_id: callbackId
    }, { timeout: 5000 });
  } catch (err) {
    console.log("answerCallback ignored:", err.response?.data?.description || err.message);
  }
}

async function sendMainMenu(chatId) {
  return sendMessage(chatId, "🌤 منوی بات هواشناسی\nیک گزینه را انتخاب کنید:", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🌤 Salamanca", callback_data: "weather:salamanca" },
          { text: "🌤 Madrid", callback_data: "weather:madrid" }
        ],
        [
          { text: "🌤 Tehran", callback_data: "weather:tehran" },
          { text: "🌤 Ardabil", callback_data: "weather:ardabil" }
        ],
        [
          { text: "📊 Chart Salamanca", callback_data: "chart:salamanca" },
          { text: "📊 Chart Madrid", callback_data: "chart:madrid" }
        ],
        [
          { text: "📊 Chart Tehran", callback_data: "chart:tehran" },
          { text: "📊 Chart Ardabil", callback_data: "chart:ardabil" }
        ],
        [
          { text: "⚠️ Alert Status", callback_data: "alerts:status" },
          { text: "⚙️ Settings", callback_data: "settings:show" }
        ]
      ]
    }
  });
}

async function sendWeatherToTelegram(chatId, cityKey) {
  const { city, weather, air } = await fetchWeather(cityKey);
  const report = formatReport(city, weather, air);
  return sendMessage(chatId, report);
}

async function createChartBuffer(cityKey) {
  const { city, weather } = await fetchWeather(cityKey);
  const h = weather.hourly;
  const indexes = todayRangeIndexes(h.time);
  const labels = indexes.map(i => hourLabel(h.time[i]));
  const temp = indexes.map(i => h.temperature_2m[i]);
  const rain = indexes.map(i => h.precipitation_probability[i]);
  const wind = indexes.map(i => h.wind_speed_10m[i]);

  const width = 1000;
  const height = 600;
  const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, backgroundColour: "white" });
  const configuration = {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Temperature °C", data: temp, borderWidth: 3, tension: 0.25 },
        { label: "Rain Probability %", data: rain, borderWidth: 3, tension: 0.25 },
        { label: "Wind km/h", data: wind, borderWidth: 3, tension: 0.25 }
      ]
    },
    options: {
      responsive: false,
      plugins: {
        title: { display: true, text: `Weather Chart - ${city.name} - 08:00 to 24:00` },
        legend: { display: true }
      },
      scales: { y: { beginAtZero: true } }
    }
  };
  return chartJSNodeCanvas.renderToBuffer(configuration);
}

async function sendChartToTelegram(chatId, cityKey) {
  const key = normalizeCityKey(cityKey);
  if (!cities[key]) throw new Error("City not found");
  const buffer = await createChartBuffer(key);
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", `📊 نمودار آب‌وهوا: ${cityLabel(cities[key])}`);
  const blob = new Blob([buffer], { type: "image/png" });
  form.append("photo", blob, `weather-${key}.png`);
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
    method: "POST",
    body: form
  });
}

async function sendAllDailyReport(chatId = DEFAULT_CHAT_ID) {
  if (!chatId) throw new Error("TELEGRAM_CHAT_ID is missing");
  for (const key of settings.selectedCities) {
    try {
      await sendWeatherToTelegram(chatId, key);
    } catch (err) {
      await sendMessage(chatId, `❌ خطا در دریافت گزارش ${key}: ${err.message}`);
    }
  }
}

function shouldAlert(cityKey, alertText) {
  const key = `${cityKey}:${alertText}`;
  const now = Date.now();
  const cooldown = settings.alertCooldownMinutes * 60 * 1000;
  const last = alertMemory.get(key) || 0;
  if (now - last < cooldown) return false;
  alertMemory.set(key, now);
  return true;
}

async function checkRealTimeAlerts() {
  if (!settings.realTimeAlerts || !DEFAULT_CHAT_ID) return;
  for (const key of settings.selectedCities) {
    try {
      const { city, weather, air } = await fetchWeather(key);
      const { summary, alerts } = analyzeWeather(city, weather, air);
      if (!alerts.length) continue;
      const filtered = alerts.filter(a => shouldAlert(key, a));
      if (!filtered.length) continue;
      const smart = aiLikeSummary(city, summary, filtered);
      const text = `🚨 هشدار فوری آب‌وهوا
📍 ${cityLabel(city)}

${filtered.map(a => `⚠️ ${a}`).join("\n")}

🤖 تحلیل سریع:
${smart}`;
      await sendMessage(DEFAULT_CHAT_ID, text);
    } catch (err) {
      console.log("Real-time alert error:", key, err.message);
    }
  }
}

function scheduleJobs() {
  if (scheduledDailyTask) scheduledDailyTask.stop();
  if (scheduledAlertTask) scheduledAlertTask.stop();

  if (settings.dailyReport && process.env.ENABLE_INTERNAL_CRON !== "false") {
    const [hh, mm] = settings.sendTime.split(":").map(Number);
    scheduledDailyTask = cron.schedule(`${mm} ${hh} * * *`, () => {
      console.log("Daily report job started:", settings.sendTime);
      sendAllDailyReport().catch(err => console.error("Daily job error:", err.message));
    }, { timezone: TIMEZONE });
    console.log(`Daily report scheduled at ${settings.sendTime} (${TIMEZONE})`);
  }

  if (settings.realTimeAlerts && process.env.ENABLE_INTERNAL_CRON !== "false") {
    scheduledAlertTask = cron.schedule("*/30 * * * *", () => {
      console.log("Real-time alert check started");
      checkRealTimeAlerts().catch(err => console.error("Alert job error:", err.message));
    }, { timezone: TIMEZONE });
    console.log("Real-time alerts scheduled every 30 minutes");
  }
}

function adminAuth(req, res, next) {
  const token = req.headers["x-admin-password"] || req.query.password || req.body.password;
  if (token !== ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "weather-render-bot", time: new Date().toISOString(), settings });
});

app.get("/api/report-preview", async (req, res) => {
  try {
    const key = normalizeCityKey(req.query.city || "madrid");
    const { city, weather, air } = await fetchWeather(key);
    res.type("text/plain").send(formatReport(city, weather, air));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/chart", async (req, res) => {
  try {
    const key = normalizeCityKey(req.query.city || "madrid");
    const buffer = await createChartBuffer(key);
    res.set("Content-Type", "image/png").send(buffer);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/send-telegram", async (req, res) => {
  try {
    const key = req.query.city ? normalizeCityKey(req.query.city) : null;
    if (key) await sendWeatherToTelegram(DEFAULT_CHAT_ID, key);
    else await sendAllDailyReport(DEFAULT_CHAT_ID);
    res.json({ ok: true, sent: key || "all" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/set-webhook", async (req, res) => {
  try {
    if (!PUBLIC_URL) return res.status(400).json({ ok: false, error: "PUBLIC_URL is missing" });
    const webhookUrl = `${PUBLIC_URL.replace(/\/$/, "")}/webhook`;
    const result = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
      url: webhookUrl,
      allowed_updates: ["message", "callback_query"]
    });
    res.json({ ok: true, webhookUrl, telegram: result.data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.response?.data || err.message });
  }
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  try {
    if (update.callback_query) {
      const callback = update.callback_query;
      const chatId = callback.message.chat.id;
      const data = callback.data || "";
      console.log("Callback data:", data);
      answerCallback(callback.id);

      const parts = data.includes(":") ? data.split(":") : data.split("_");
      const action = parts[0];
      const cityKey = normalizeCityKey(parts[1]);

      if (action === "weather") {
        if (!cities[cityKey]) return sendMessage(chatId, "❌ شهر پیدا نشد.");
        return sendWeatherToTelegram(chatId, cityKey);
      }

      if (action === "chart") {
        if (!cities[cityKey]) return sendMessage(chatId, "❌ شهر پیدا نشد.");
        return sendChartToTelegram(chatId, cityKey);
      }

      if (action === "alerts") {
        return sendMessage(chatId, `⚠️ Real-Time Alerts: ${settings.realTimeAlerts ? "فعال" : "غیرفعال"}\n⏰ گزارش روزانه: ${settings.sendTime}\n🌧 حد بارندگی: ${settings.rainThreshold}%`);
      }

      if (action === "settings") {
        return sendMessage(chatId, `⚙️ تنظیمات فعلی\n⏰ ساعت ارسال: ${settings.sendTime}\n🌧 حد بارندگی: ${settings.rainThreshold}%\n💨 هشدار باد: ${settings.windWarningKmh} km/h\n\nبرای تغییر ساعت:\n/settime 07:30`);
      }
      return;
    }

    const msg = update.message;
    if (!msg || !msg.text) return;

    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const lower = text.toLowerCase();

    if (lower === "/start" || lower === "/menu") return sendMainMenu(chatId);

    if (lower.startsWith("/weather")) {
      const key = normalizeCityKey(text.split(/\s+/)[1] || "madrid");
      if (!cities[key]) return sendMessage(chatId, "❌ شهر پیدا نشد. مثال: /weather madrid");
      return sendWeatherToTelegram(chatId, key);
    }

    if (lower.startsWith("/chart")) {
      const key = normalizeCityKey(text.split(/\s+/)[1] || "madrid");
      if (!cities[key]) return sendMessage(chatId, "❌ شهر پیدا نشد. مثال: /chart tehran");
      return sendChartToTelegram(chatId, key);
    }

    if (lower === "/all") return sendAllDailyReport(chatId);

    if (lower.startsWith("/settime")) {
      const newTime = text.split(/\s+/)[1];
      if (!newTime || !/^\d{2}:\d{2}$/.test(newTime)) {
        return sendMessage(chatId, "❌ فرمت درست: /settime 08:00");
      }
      const [hh, mm] = newTime.split(":").map(Number);
      if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
        return sendMessage(chatId, "❌ ساعت نامعتبر است.");
      }
      settings.sendTime = newTime;
      saveSettings(settings);
      scheduleJobs();
      return sendMessage(chatId, `✅ ساعت ارسال روزانه تغییر کرد به ${newTime}`);
    }

    if (lower === "/settings") {
      return sendMessage(chatId, `⚙️ تنظیمات\n⏰ ساعت ارسال: ${settings.sendTime}\n⚠️ هشدار فوری: ${settings.realTimeAlerts ? "فعال" : "غیرفعال"}\n🌧 حد بارندگی: ${settings.rainThreshold}%`);
    }

    return sendMessage(chatId, "دستور نامعتبر است. /menu را بزنید.");
  } catch (err) {
    console.error("Webhook processing error:", err.response?.data || err.message);
  }
});

app.get("/api/admin/settings", adminAuth, (req, res) => {
  res.json({ ok: true, settings, cities });
});

app.post("/api/admin/settings", adminAuth, (req, res) => {
  try {
    const body = req.body || {};
    settings = {
      ...settings,
      ...Object.fromEntries(Object.entries(body).filter(([k]) => k in settings))
    };
    if (!/^\d{2}:\d{2}$/.test(settings.sendTime)) settings.sendTime = "08:00";
    settings.rainThreshold = Number(settings.rainThreshold);
    settings.windWarningKmh = Number(settings.windWarningKmh);
    settings.uvWarning = Number(settings.uvWarning);
    settings.heatWarningC = Number(settings.heatWarningC);
    settings.coldWarningC = Number(settings.coldWarningC);
    settings.alertCooldownMinutes = Number(settings.alertCooldownMinutes);
    saveSettings(settings);
    scheduleJobs();
    res.json({ ok: true, settings });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/admin/test-alerts", adminAuth, async (req, res) => {
  try {
    await checkRealTimeAlerts();
    res.json({ ok: true, message: "Alert check executed" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/admin/send-now", adminAuth, async (req, res) => {
  try {
    await sendAllDailyReport(DEFAULT_CHAT_ID);
    res.json({ ok: true, message: "Daily report sent" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

scheduleJobs();

app.listen(PORT, () => {
  console.log(`Weather Telegram Bot is running on port ${PORT}`);
});
