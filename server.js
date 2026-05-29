require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const cron = require("node-cron");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEFAULT_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PUBLIC_URL = process.env.PUBLIC_URL;
const TIMEZONE = process.env.TIMEZONE || "Europe/Madrid";
const RAIN_THRESHOLD = Number(process.env.RAIN_THRESHOLD || 50);
const PORT = process.env.PORT || 3000;

const TELEGRAM_API = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : null;

const cities = {
  salamanca: {
    key: "salamanca",
    name: "Salamanca, Spain",
    label: "Salamanca",
    lat: 40.9701,
    lon: -5.6635,
  },
  madrid: {
    key: "madrid",
    name: "Madrid, Spain",
    label: "Madrid",
    lat: 40.4168,
    lon: -3.7038,
  },
  tehran: {
    key: "tehran",
    name: "Tehran, Iran",
    label: "Tehran",
    lat: 35.6892,
    lon: 51.3890,
  },
  ardabil: {
    key: "ardabil",
    name: "Ardabil, Iran",
    label: "Ardabil",
    lat: 38.2498,
    lon: 48.2933,
  },
};

function normalizeCity(input) {
  if (!input) return null;
  const key = String(input).trim().toLowerCase().replace("/", "").replace("@", "");
  const aliases = {
    sal: "salamanca",
    salamanca: "salamanca",
    madrid: "madrid",
    mad: "madrid",
    tehran: "tehran",
    teheran: "tehran",
    teh: "tehran",
    ardabil: "ardabil",
    ardebil: "ardabil",
    ard: "ardabil",
  };
  return aliases[key] || key;
}

function parseCallbackData(data) {
  // Supports both new format weather:madrid and old format weather_madrid
  const raw = String(data || "").trim().toLowerCase();

  if (raw.includes(":")) {
    const [action, city] = raw.split(":");
    return { action, city: normalizeCity(city) };
  }

  if (raw.includes("_")) {
    const [action, ...rest] = raw.split("_");
    return { action, city: normalizeCity(rest.join("_")) };
  }

  return { action: raw, city: null };
}

function getMainKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🌤 Salamanca", callback_data: "weather:salamanca" },
        { text: "📊 Chart", callback_data: "chart:salamanca" },
      ],
      [
        { text: "🌤 Madrid", callback_data: "weather:madrid" },
        { text: "📊 Chart", callback_data: "chart:madrid" },
      ],
      [
        { text: "🌤 Tehran", callback_data: "weather:tehran" },
        { text: "📊 Chart", callback_data: "chart:tehran" },
      ],
      [
        { text: "🌤 Ardabil", callback_data: "weather:ardabil" },
        { text: "📊 Chart", callback_data: "chart:ardabil" },
      ],
      [
        { text: "🌍 All cities", callback_data: "all:all" },
      ],
    ],
  };
}

async function telegram(method, payload) {
  if (!TELEGRAM_API) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing");
  }
  const res = await axios.post(`${TELEGRAM_API}/${method}`, payload, { timeout: 20000 });
  return res.data;
}

async function safeAnswerCallbackQuery(callbackId, text = "در حال آماده‌سازی...") {
  if (!callbackId) return;
  try {
    // Must be called quickly. If the query is old, Telegram returns 400; we ignore it.
    await telegram("answerCallbackQuery", {
      callback_query_id: callbackId,
      text,
      show_alert: false,
    });
  } catch (err) {
    console.log("answerCallbackQuery ignored:", err.response?.data || err.message);
  }
}

async function sendMessage(chatId, text, extra = {}) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  });
}

async function sendMenu(chatId) {
  return sendMessage(
    chatId,
    "🌦 <b>Weather Bot Menu</b>\n\nیک شهر را انتخاب کن یا دستور بفرست:\n/weather madrid\n/chart tehran\n/all",
    { reply_markup: getMainKeyboard() }
  );
}

function getWeatherUrl(city) {
  const params = new URLSearchParams({
    latitude: city.lat,
    longitude: city.lon,
    timezone: TIMEZONE,
    forecast_days: "1",
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "precipitation",
      "wind_speed_10m"
    ].join(","),
    hourly: [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "precipitation_probability",
      "precipitation",
      "wind_speed_10m",
      "uv_index"
    ].join(","),
    daily: [
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
      "uv_index_max",
      "wind_speed_10m_max",
      "sunrise",
      "sunset"
    ].join(","),
  });

  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

async function fetchWeather(cityKey) {
  const key = normalizeCity(cityKey);
  const city = cities[key];
  if (!city) throw new Error(`City not found: ${cityKey}`);

  const { data } = await axios.get(getWeatherUrl(city), { timeout: 20000 });
  return { city, data };
}

function hourFromIso(iso) {
  return String(iso || "").slice(11, 16);
}

function filterToday8to24(hourly) {
  const indexes = [];
  for (let i = 0; i < hourly.time.length; i++) {
    const hour = Number(String(hourly.time[i]).slice(11, 13));
    if (hour >= 8 && hour <= 23) indexes.push(i);
  }
  return indexes;
}

function makeWeatherSummary(city, data) {
  const h = data.hourly;
  const d = data.daily;
  const c = data.current;
  const indexes = filterToday8to24(h);

  const rainHours = indexes
    .map(i => ({ time: hourFromIso(h.time[i]), value: h.precipitation_probability[i] ?? 0 }))
    .filter(x => Number(x.value) >= RAIN_THRESHOLD);

  const maxRain = Math.max(...indexes.map(i => Number(h.precipitation_probability[i] || 0)));
  const avgTemp = indexes.length
    ? indexes.reduce((sum, i) => sum + Number(h.temperature_2m[i] || 0), 0) / indexes.length
    : 0;

  const uvMax = d.uv_index_max?.[0] ?? null;
  const windMax = d.wind_speed_10m_max?.[0] ?? null;

  const warnings = [];
  if (maxRain >= RAIN_THRESHOLD) warnings.push(`☔ احتمال بارندگی بالای ${RAIN_THRESHOLD}٪ وجود دارد.`);
  if (Number(windMax) >= Number(process.env.WIND_WARNING_KMH || 45)) warnings.push("💨 هشدار باد نسبتاً شدید.");
  if (Number(uvMax) >= Number(process.env.UV_WARNING || 7)) warnings.push("☀️ هشدار UV بالا.");

  let rainText = "✅ از ساعت 08:00 تا 24:00 احتمال بارندگی بالای حد هشدار دیده نشد.";
  if (rainHours.length) {
    rainText = "🌧 <b>ساعت‌های احتمال بارندگی بالا:</b>\n" +
      rainHours.map(x => `⏰ ${x.time} → ${x.value}%`).join("\n");
  }

  return [
    `🌦 <b>Daily Weather Report</b>`,
    `📍 <b>${city.name}</b>`,
    ``,
    `🕗 بازه بررسی: 08:00 تا 24:00`,
    `🌡 دمای فعلی: ${c.temperature_2m ?? "-"}°C`,
    `🤒 دمای محسوس: ${c.apparent_temperature ?? "-"}°C`,
    `📈 بیشینه امروز: ${d.temperature_2m_max?.[0] ?? "-"}°C`,
    `📉 کمینه امروز: ${d.temperature_2m_min?.[0] ?? "-"}°C`,
    `🌧 بیشترین احتمال بارندگی: ${maxRain}%`,
    `💧 رطوبت فعلی: ${c.relative_humidity_2m ?? "-"}%`,
    `💨 بیشترین سرعت باد: ${windMax ?? "-"} km/h`,
    `☀️ UV Max: ${uvMax ?? "-"}`,
    `🌅 طلوع: ${hourFromIso(d.sunrise?.[0])}`,
    `🌇 غروب: ${hourFromIso(d.sunset?.[0])}`,
    ``,
    rainText,
    ``,
    warnings.length ? `⚠️ <b>هشدارها:</b>\n${warnings.join("\n")}` : `✅ هشدار مهمی برای امروز ثبت نشد.`,
    ``,
    `📋 <b>خلاصه:</b> میانگین دمای بازه روز حدود ${avgTemp.toFixed(1)}°C است و بیشترین احتمال بارندگی ${maxRain}% است.`,
  ].join("\n");
}

async function sendWeatherReport(chatId, cityKey) {
  const { city, data } = await fetchWeather(cityKey);
  const text = makeWeatherSummary(city, data);
  return sendMessage(chatId, text, { reply_markup: getMainKeyboard() });
}

function chartUrlFor(city, data) {
  const h = data.hourly;
  const indexes = filterToday8to24(h);
  const labels = indexes.map(i => hourFromIso(h.time[i]));
  const temps = indexes.map(i => Number(h.temperature_2m[i] || 0));
  const rain = indexes.map(i => Number(h.precipitation_probability[i] || 0));
  const wind = indexes.map(i => Number(h.wind_speed_10m[i] || 0));

  const chartConfig = {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Temp °C", data: temps, yAxisID: "y" },
        { label: "Rain %", data: rain, yAxisID: "y1" },
        { label: "Wind km/h", data: wind, yAxisID: "y" },
      ],
    },
    options: {
      title: {
        display: true,
        text: `${city.name} | 08:00 - 24:00`,
      },
      legend: {
        display: true,
        position: "bottom",
      },
      scales: {
        yAxes: [
          { id: "y", type: "linear", position: "left" },
          { id: "y1", type: "linear", position: "right", ticks: { min: 0, max: 100 } },
        ],
      },
    },
  };

  return `https://quickchart.io/chart?width=900&height=500&format=png&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
}

async function sendWeatherChart(chatId, cityKey) {
  const { city, data } = await fetchWeather(cityKey);
  const photo = chartUrlFor(city, data);
  return telegram("sendPhoto", {
    chat_id: chatId,
    photo,
    caption: `📊 Weather chart for ${city.name} | 08:00 - 24:00`,
    reply_markup: getMainKeyboard(),
  });
}

async function sendAllCities(chatId) {
  for (const key of Object.keys(cities)) {
    await sendWeatherReport(chatId, key);
  }
}

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "weather-render-bot", time: new Date().toISOString() });
});

app.get("/api/set-webhook", async (req, res) => {
  try {
    if (!BOT_TOKEN) return res.status(400).json({ ok: false, error: "TELEGRAM_BOT_TOKEN is missing" });
    if (!PUBLIC_URL) return res.status(400).json({ ok: false, error: "PUBLIC_URL is missing" });

    const webhookUrl = `${PUBLIC_URL.replace(/\/$/, "")}/webhook`;
    const result = await telegram("setWebhook", { url: webhookUrl });
    res.json({ ok: true, webhookUrl, telegram: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.response?.data || err.message });
  }
});

app.get("/api/webhook-info", async (req, res) => {
  try {
    const result = await telegram("getWebhookInfo", {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.response?.data || err.message });
  }
});

app.get("/api/report-preview", async (req, res) => {
  try {
    const cityKey = normalizeCity(req.query.city || "madrid");
    const { city, data } = await fetchWeather(cityKey);
    res.type("text/plain").send(makeWeatherSummary(city, data));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.response?.data || err.message });
  }
});

app.get("/api/chart", async (req, res) => {
  try {
    const cityKey = normalizeCity(req.query.city || "madrid");
    const { city, data } = await fetchWeather(cityKey);
    res.redirect(chartUrlFor(city, data));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.response?.data || err.message });
  }
});

app.get("/api/send-telegram", async (req, res) => {
  try {
    const chatId = req.query.chat_id || DEFAULT_CHAT_ID;
    if (!chatId) return res.status(400).json({ ok: false, error: "TELEGRAM_CHAT_ID is missing" });

    const cityKey = normalizeCity(req.query.city || "madrid");
    await sendWeatherReport(chatId, cityKey);
    res.json({ ok: true, sent: "weather", city: cityKey });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.response?.data || err.message });
  }
});

app.post("/webhook", async (req, res) => {
  const update = req.body;

  // Important: answer Telegram immediately to avoid retries/timeouts.
  res.sendStatus(200);

  try {
    if (update.callback_query) {
      const callback = update.callback_query;
      const chatId = callback.message?.chat?.id;
      const data = callback.data || "";
      console.log("Callback data:", data);

      await safeAnswerCallbackQuery(callback.id);

      const { action, city } = parseCallbackData(data);

      if (action === "weather") {
        if (!cities[city]) return sendMessage(chatId, `❌ City not found: ${city || data}`, { reply_markup: getMainKeyboard() });
        return sendWeatherReport(chatId, city);
      }

      if (action === "chart") {
        if (!cities[city]) return sendMessage(chatId, `❌ City not found: ${city || data}`, { reply_markup: getMainKeyboard() });
        return sendWeatherChart(chatId, city);
      }

      if (action === "all") {
        return sendAllCities(chatId);
      }

      return sendMenu(chatId);
    }

    const message = update.message;
    if (!message || !message.chat) return;

    const chatId = message.chat.id;
    const text = (message.text || "").trim();
    const [cmdRaw, argRaw] = text.split(/\s+/);
    const cmd = (cmdRaw || "").toLowerCase();
    const arg = normalizeCity(argRaw || "madrid");

    console.log("Message:", text);

    if (cmd === "/start" || cmd === "/menu") {
      return sendMenu(chatId);
    }

    if (cmd === "/weather") {
      return sendWeatherReport(chatId, arg);
    }

    if (cmd === "/chart") {
      return sendWeatherChart(chatId, arg);
    }

    if (cmd === "/all") {
      return sendAllCities(chatId);
    }

    return sendMessage(chatId, "دستور نامعتبر است. از /menu استفاده کن.", { reply_markup: getMainKeyboard() });
  } catch (err) {
    console.log("Webhook error:", err.response?.data || err.message);
  }
});

// Optional internal daily cron. On Render free plan, service may sleep.
// For guaranteed scheduled jobs, use Render Cron Job that calls /api/send-telegram.
if (process.env.ENABLE_INTERNAL_CRON === "true") {
  cron.schedule("0 8 * * *", async () => {
    try {
      if (!DEFAULT_CHAT_ID) return console.log("Daily cron skipped: TELEGRAM_CHAT_ID missing");
      console.log("Running daily 08:00 weather report");
      await sendAllCities(DEFAULT_CHAT_ID);
    } catch (err) {
      console.log("Daily cron error:", err.response?.data || err.message);
    }
  }, { timezone: TIMEZONE });
}

app.listen(PORT, () => {
  console.log(`Weather Telegram Bot is running on port ${PORT}`);
});
