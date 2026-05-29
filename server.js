require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cron = require("node-cron");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEFAULT_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PUBLIC_URL = process.env.PUBLIC_URL;
const TIMEZONE = process.env.TIMEZONE || "Europe/Madrid";
const RAIN_THRESHOLD = Number(process.env.RAIN_THRESHOLD || 50);
const UV_WARNING = Number(process.env.UV_WARNING || 7);
const WIND_WARNING_KMH = Number(process.env.WIND_WARNING_KMH || 45);
const ENABLE_INTERNAL_CRON = String(process.env.ENABLE_INTERNAL_CRON || "true").toLowerCase() === "true";

const cities = {
  salamanca: { id:"salamanca", label:"Salamanca 🇪🇸", name:"Salamanca, Spain", lat:40.9701, lon:-5.6635, timezone:"Europe/Madrid" },
  madrid: { id:"madrid", label:"Madrid 🇪🇸", name:"Madrid, Spain", lat:40.4168, lon:-3.7038, timezone:"Europe/Madrid" },
  tehran: { id:"tehran", label:"Tehran 🇮🇷", name:"Tehran, Iran", lat:35.6892, lon:51.3890, timezone:"Asia/Tehran" },
  ardabil: { id:"ardabil", label:"Ardabil 🇮🇷", name:"Ardabil, Iran", lat:38.2498, lon:48.2933, timezone:"Asia/Tehran" },
};

function normalizeCity(input) {
  if (!input) return null;
  const clean = String(input).trim().toLowerCase()
    .replace("/", "").replace("weather_", "").replace("chart_", "").replace("city_", "");
  const aliases = {
    sala:"salamanca", salamanca:"salamanca",
    mad:"madrid", madrid:"madrid",
    tehran:"tehran", teheran:"tehran", "تهران":"tehran",
    ardabil:"ardabil", ardebil:"ardabil", "اردبیل":"ardabil"
  };
  return aliases[clean] || clean;
}

async function telegram(method, payload) {
  if (!BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is missing");
  const { data } = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, payload);
  return data;
}
async function sendMessage(chatId, text, extra={}) {
  return telegram("sendMessage", { chat_id:chatId, text, parse_mode:"HTML", disable_web_page_preview:true, ...extra });
}
async function sendPhoto(chatId, photo, caption="", extra={}) {
  return telegram("sendPhoto", { chat_id:chatId, photo, caption, parse_mode:"HTML", ...extra });
}
function mainKeyboard() {
  return { inline_keyboard: [
    [{ text:"🌤 Salamanca", callback_data:"weather:salamanca" }, { text:"🌤 Madrid", callback_data:"weather:madrid" }],
    [{ text:"🌤 Tehran", callback_data:"weather:tehran" }, { text:"🌤 Ardabil", callback_data:"weather:ardabil" }],
    [{ text:"📊 Chart Salamanca", callback_data:"chart:salamanca" }, { text:"📊 Chart Madrid", callback_data:"chart:madrid" }],
    [{ text:"📊 Chart Tehran", callback_data:"chart:tehran" }, { text:"📊 Chart Ardabil", callback_data:"chart:ardabil" }],
    [{ text:"🌍 All cities", callback_data:"all" }]
  ]};
}
function helpText() {
  return ["🤖 <b>Weather Telegram Bot</b>","","دستورها:","/start","/menu","/all","/weather madrid","/chart tehran","","یا از دکمه‌های زیر شهر را انتخاب کن."].join("\n");
}

async function fetchWeather(cityKey) {
  const city = cities[cityKey];
  if (!city) throw new Error(`City not found: ${cityKey}`);
  const p = new URLSearchParams({
    latitude: city.lat, longitude: city.lon, timezone: city.timezone || TIMEZONE,
    current:"temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code",
    hourly:"temperature_2m,apparent_temperature,precipitation_probability,relative_humidity_2m,wind_speed_10m,uv_index",
    daily:"temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max,wind_speed_10m_max",
    forecast_days:"1"
  });
  const { data: weather } = await axios.get(`https://api.open-meteo.com/v1/forecast?${p.toString()}`, { timeout:20000 });
  let airQuality = null;
  try {
    const aq = new URLSearchParams({ latitude:city.lat, longitude:city.lon, timezone:city.timezone || TIMEZONE, current:"european_aqi,pm10,pm2_5", forecast_days:"1" });
    const { data } = await axios.get(`https://air-quality-api.open-meteo.com/v1/air-quality?${aq.toString()}`, { timeout:15000 });
    airQuality = data.current || null;
  } catch(e) {}
  return { city, weather, airQuality };
}
function todayWindowIndexes(times) {
  const out=[]; for (let i=0;i<times.length;i++){ const h=Number(String(times[i]).slice(11,13)); if(h>=8 && h<=23) out.push(i); } return out;
}
function fmtHour(t){ return String(t).slice(11,16); }
function avg(arr){ return arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : null; }
function aqiLabel(aqi){ if(aqi==null) return "نامشخص"; if(aqi<=20) return "خیلی خوب"; if(aqi<=40) return "خوب"; if(aqi<=60) return "متوسط"; if(aqi<=80) return "ضعیف"; if(aqi<=100) return "ناسالم"; return "خیلی ناسالم"; }

function createReportText(bundle) {
  const {city, weather, airQuality} = bundle;
  const h = weather.hourly || {}, d = weather.daily || {}, c = weather.current || {};
  const idx = todayWindowIndexes(h.time || []);
  const pick = (name) => idx.map(i => h[name]?.[i]).filter(v => typeof v === "number");
  const temps=pick("temperature_2m"), feels=pick("apparent_temperature"), rains=pick("precipitation_probability"), winds=pick("wind_speed_10m"), hums=pick("relative_humidity_2m"), uvs=pick("uv_index");
  const rainHours = idx.map(i=>({time:h.time[i], rain:h.precipitation_probability?.[i]})).filter(x=>typeof x.rain==="number" && x.rain>RAIN_THRESHOLD);
  const maxRain = rains.length ? Math.max(...rains) : d.precipitation_probability_max?.[0];
  const maxWind = winds.length ? Math.max(...winds) : d.wind_speed_10m_max?.[0];
  const maxUv = uvs.length ? Math.max(...uvs) : d.uv_index_max?.[0];
  const minTemp = temps.length ? Math.min(...temps) : d.temperature_2m_min?.[0];
  const maxTemp = temps.length ? Math.max(...temps) : d.temperature_2m_max?.[0];
  const maxFeel = feels.length ? Math.max(...feels) : c.apparent_temperature;
  const sunrise = d.sunrise?.[0] ? String(d.sunrise[0]).slice(11,16) : "نامشخص";
  const sunset = d.sunset?.[0] ? String(d.sunset[0]).slice(11,16) : "نامشخص";
  const warnings=[];
  if(rainHours.length) warnings.push(`☔ احتمال بارندگی بالای ${RAIN_THRESHOLD}%`);
  if(typeof maxWind==="number" && maxWind>=WIND_WARNING_KMH) warnings.push("💨 باد نسبتاً شدید");
  if(typeof maxUv==="number" && maxUv>=UV_WARNING) warnings.push("☀️ UV بالا");
  if(airQuality?.european_aqi>=80) warnings.push("😷 کیفیت هوا ضعیف یا ناسالم");

  let text = `🌤 <b>گزارش آب‌وهوا: ${city.name}</b>\n🕗 بازه بررسی: 08:00 تا 24:00\n\n`;
  text += `🌡 دما: ${minTemp ?? "-"}°C تا ${maxTemp ?? "-"}°C\n`;
  text += `🥵 دمای محسوس بیشینه: ${maxFeel ?? "-"}°C\n`;
  text += `🌧 بیشترین احتمال بارندگی: ${maxRain ?? "-"}%\n`;
  text += `💨 بیشترین سرعت باد: ${maxWind ?? "-"} km/h\n`;
  text += `💧 رطوبت میانگین: ${avg(hums) ?? c.relative_humidity_2m ?? "-"}%\n`;
  text += `☀️ UV بیشینه: ${maxUv ?? "-"}\n🌅 طلوع: ${sunrise}\n🌇 غروب: ${sunset}\n`;
  if(airQuality){ text += `😷 AQI اروپا: ${airQuality.european_aqi ?? "-"} (${aqiLabel(airQuality.european_aqi)})\nPM2.5: ${airQuality.pm2_5 ?? "-"} | PM10: ${airQuality.pm10 ?? "-"}\n`; }
  if(rainHours.length) text += `\n⚠️ <b>ساعت‌های بارندگی بالای ${RAIN_THRESHOLD}%:</b>\n` + rainHours.map(x=>`⏰ ${fmtHour(x.time)} → ${x.rain}%`).join("\n") + "\n";
  else text += `\n✅ در بازه 08:00 تا 24:00 احتمال بارندگی بالای ${RAIN_THRESHOLD}% دیده نشد.\n`;
  if(warnings.length) text += `\n🚨 <b>هشدارها:</b>\n${warnings.join("\n")}\n`;
  text += "\n🧠 <b>خلاصه:</b>\n";
  text += rainHours.length ? `امروز در ${city.label} از ساعت‌های ${rainHours.map(x=>fmtHour(x.time)).join(", ")} احتمال بارندگی بالاست.` : `امروز در ${city.label} وضعیت بارندگی مهمی در بازه روزانه دیده نمی‌شود.`;
  return text;
}
function chartUrl(bundle) {
  const {city, weather} = bundle, h=weather.hourly||{}, idx=todayWindowIndexes(h.time||[]);
  const labels=idx.map(i=>fmtHour(h.time[i]));
  const cfg={type:"line",data:{labels,datasets:[
    {label:"Temp °C",data:idx.map(i=>h.temperature_2m?.[i]??null),borderColor:"rgb(255,99,132)",backgroundColor:"rgba(255,99,132,0.1)",yAxisID:"y",tension:.25},
    {label:"Rain %",data:idx.map(i=>h.precipitation_probability?.[i]??null),borderColor:"rgb(54,162,235)",backgroundColor:"rgba(54,162,235,0.1)",yAxisID:"y1",tension:.25},
    {label:"Wind km/h",data:idx.map(i=>h.wind_speed_10m?.[i]??null),borderColor:"rgb(75,192,192)",backgroundColor:"rgba(75,192,192,0.1)",yAxisID:"y",tension:.25}
  ]},options:{plugins:{title:{display:true,text:`${city.name} | 08:00 - 24:00`},legend:{display:true,position:"bottom"}},scales:{y:{beginAtZero:true,position:"left",title:{display:true,text:"°C / km/h"}},y1:{beginAtZero:true,max:100,position:"right",grid:{drawOnChartArea:false},title:{display:true,text:"Rain %"}}}}};
  return `https://quickchart.io/chart?width=900&height=500&format=png&c=${encodeURIComponent(JSON.stringify(cfg))}`;
}
async function sendWeatherReport(chatId, cityKey){
  const key=normalizeCity(cityKey); if(!cities[key]) return sendMessage(chatId,"❌ شهر پیدا نشد. شهرهای مجاز: salamanca, madrid, tehran, ardabil");
  const bundle=await fetchWeather(key);
  return sendMessage(chatId, createReportText(bundle), {reply_markup:{inline_keyboard:[[{text:`📊 نمودار ${bundle.city.label}`, callback_data:`chart:${key}`}],[{text:"🔙 منو", callback_data:"menu"}]]}});
}
async function sendWeatherChart(chatId, cityKey){
  const key=normalizeCity(cityKey); if(!cities[key]) return sendMessage(chatId,"❌ شهر پیدا نشد. شهرهای مجاز: salamanca, madrid, tehran, ardabil");
  const bundle=await fetchWeather(key);
  return sendPhoto(chatId, chartUrl(bundle), `📊 نمودار آب‌وهوا برای ${bundle.city.name}\n08:00 تا 24:00`, {reply_markup:{inline_keyboard:[[{text:`🌤 گزارش ${bundle.city.label}`, callback_data:`weather:${key}`}],[{text:"🔙 منو", callback_data:"menu"}]]}});
}
async function sendAllCitiesReport(chatId){
  let text=`🌍 <b>گزارش روزانه همه شهرها</b>\n🕗 بازه بررسی: 08:00 تا 24:00\n\n`;
  for(const key of Object.keys(cities)){
    try{ const b=await fetchWeather(key); text += createReportText(b)+"\n\n----------------\n\n"; if(text.length>3300){ await sendMessage(chatId,text); text=""; } }
    catch(e){ text += `❌ خطا در دریافت اطلاعات ${cities[key].name}\n\n`; }
  }
  if(text.trim()) await sendMessage(chatId,text,{reply_markup:mainKeyboard()});
}

app.get("/api/health",(req,res)=>res.json({ok:true,service:"weather-render-telegram-bot",time:new Date().toISOString(),cities:Object.keys(cities)}));
app.get("/api/report-preview",async(req,res)=>{try{const key=normalizeCity(req.query.city||"madrid"); if(!cities[key]) return res.status(404).json({ok:false,error:"City not found"}); res.type("text/plain").send(createReportText(await fetchWeather(key)));}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.get("/api/chart",async(req,res)=>{try{const key=normalizeCity(req.query.city||"madrid"); if(!cities[key]) return res.status(404).json({ok:false,error:"City not found"}); res.redirect(chartUrl(await fetchWeather(key)));}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.get("/api/send-telegram",async(req,res)=>{try{const chatId=req.query.chat_id||DEFAULT_CHAT_ID; if(!chatId) return res.status(500).json({ok:false,error:"TELEGRAM_CHAT_ID is missing"}); const key=normalizeCity(req.query.city||"all"); if(key==="all") await sendAllCitiesReport(chatId); else { await sendWeatherReport(chatId,key); await sendWeatherChart(chatId,key); } res.json({ok:true,sent:true,city:key});}catch(e){console.error("Send Telegram error:",e.response?.data||e.message); res.status(500).json({ok:false,error:e.response?.data||e.message});}});
app.get("/api/set-webhook",async(req,res)=>{try{if(!PUBLIC_URL) return res.status(500).json({ok:false,error:"PUBLIC_URL is missing"}); const webhookUrl=`${PUBLIC_URL.replace(/\/$/,"")}/webhook`; const result=await telegram("setWebhook",{url:webhookUrl,allowed_updates:["message","callback_query"]}); res.json({ok:true,webhookUrl,telegram:result});}catch(e){console.error("Set webhook error:",e.response?.data||e.message); res.status(500).json({ok:false,error:e.response?.data||e.message});}});
app.get("/api/webhook-info",async(req,res)=>{try{res.json({ok:true,telegram:await telegram("getWebhookInfo",{})});}catch(e){res.status(500).json({ok:false,error:e.response?.data||e.message});}});

app.post("/webhook", async (req,res)=>{
  res.sendStatus(200);
  const update=req.body;
  try{
    if(update.callback_query){
      const cb=update.callback_query, chatId=cb.message?.chat?.id, data=String(cb.data||"");
      console.log("Callback data:", data);
      await telegram("answerCallbackQuery",{callback_query_id:cb.id});
      if(!chatId) return;
      if(data==="menu") return sendMessage(chatId, helpText(), {reply_markup:mainKeyboard()});
      if(data==="all") return sendAllCitiesReport(chatId);
      const [action, rawCity]=data.split(":"); const cityKey=normalizeCity(rawCity);
      if(!cities[cityKey]) return sendMessage(chatId, `❌ شهر پیدا نشد: ${rawCity || data}`);
      if(action==="weather") return sendWeatherReport(chatId, cityKey);
      if(action==="chart") return sendWeatherChart(chatId, cityKey);
      return sendMessage(chatId,"❌ دستور دکمه نامعتبر است.");
    }
    if(update.message){
      const chatId=update.message.chat.id, text=String(update.message.text||"").trim();
      console.log("Message:", text);
      if(text==="/start" || text==="/menu") return sendMessage(chatId, helpText(), {reply_markup:mainKeyboard()});
      if(text==="/all") return sendAllCitiesReport(chatId);
      if(text.startsWith("/weather")) return sendWeatherReport(chatId, text.split(/\s+/)[1] || "madrid");
      if(text.startsWith("/chart")) return sendWeatherChart(chatId, text.split(/\s+/)[1] || "madrid");
      return sendMessage(chatId, helpText(), {reply_markup:mainKeyboard()});
    }
  }catch(e){ console.error("Webhook error:", e.response?.data || e.message); }
});
if(ENABLE_INTERNAL_CRON){
  cron.schedule("0 8 * * *", async()=>{ try{ if(!DEFAULT_CHAT_ID) return console.log("Daily report skipped: TELEGRAM_CHAT_ID is missing"); console.log("Running daily 08:00 weather report..."); await sendAllCitiesReport(DEFAULT_CHAT_ID); }catch(e){console.error("Daily cron error:",e.response?.data||e.message);} }, {timezone:TIMEZONE});
}
app.get("/",(req,res)=>res.sendFile(__dirname+"/public/index.html"));
const port=process.env.PORT || 3000;
app.listen(port,()=>{ console.log(`Weather Telegram Bot is running on port ${port}`); console.log(`Cities: ${Object.keys(cities).join(", ")}`); });
