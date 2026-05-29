const map = L.map('map').setView([38.5, 23], 4);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '&copy; OpenStreetMap'
}).addTo(map);

let markers = [];
let lastCityKey = null;

function colorByStatus(status) {
  return status === 'danger' ? '#ef4444' : status === 'warning' ? '#f59e0b' : status === 'error' ? '#64748b' : '#22c55e';
}

function markerIcon(status) {
  const color = colorByStatus(status);
  return L.divIcon({
    className: '',
    html: `<div style="width:26px;height:26px;background:${color};border:3px solid white;border-radius:50%;box-shadow:0 4px 16px #0008;display:flex;align-items:center;justify-content:center;color:white;font-size:12px">●</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });
}

function value(v, suffix = '') {
  return v === null || v === undefined ? '-' : `${v}${suffix}`;
}

function statusText(status) {
  if (status === 'danger') return '🚨 هشدار شدید';
  if (status === 'warning') return '⚠️ نیاز به توجه';
  if (status === 'error') return '❌ خطا در دریافت اطلاعات';
  return '✅ عادی';
}

function rainHoursHtml(hours) {
  if (!hours || !hours.length) return '<div class="ok">موردی بالای حد هشدار نیست.</div>';
  return hours.map(x => `<div>⏰ ${String(x.time).slice(11, 16)} → ${x.value}%</div>`).join('');
}

function renderCityPanel(data) {
  const c = data.city;
  const s = data.summary || {};
  const alerts = data.alerts && data.alerts.length
    ? data.alerts.map(a => `<div class="alert">⚠️ ${a}</div>`).join('')
    : '<div class="ok">✅ هشدار مهمی نیست.</div>';

  document.getElementById('cityDetails').innerHTML = `
    <h2>${c.fa || c.name}</h2>
    <div class="meta">${c.name} | ${data.timezone}</div>
    <div class="info-card"><b>وضعیت:</b> ${statusText(data.status)}</div>
    <div class="metric">
      <div>🌡 دما<br><b>${value(s.tempMin, '°C')} تا ${value(s.tempMax, '°C')}</b></div>
      <div>🥵 محسوس<br><b>${value(s.apparentMax, '°C')}</b></div>
      <div>🌧 بارندگی<br><b>${value(s.rainMax, '%')}</b></div>
      <div>💨 باد<br><b>${value(s.windMax, ' km/h')}</b></div>
      <div>💧 رطوبت<br><b>${value(s.humidityAvg, '%')}</b></div>
      <div>☀️ UV<br><b>${value(s.uvMax)}</b></div>
      <div>😷 AQI<br><b>${value(s.aqiMax)}</b></div>
      <div>🌅/🌇<br><b>${value(s.sunrise)} / ${value(s.sunset)}</b></div>
    </div>
    <div class="info-card">
      <b>🌧 ساعت‌های بارندگی بالای حد هشدار</b>
      ${rainHoursHtml(s.rainHours)}
    </div>
    <div class="info-card">
      <b>هشدارها</b>
      ${alerts}
    </div>
    <div class="info-card">
      <b>🤖 خلاصه هوشمند</b>
      <p>${data.aiSummary || '-'}</p>
    </div>
    <div class="actions">
      <a href="${data.reportUrl}" target="_blank">گزارش متنی</a>
      <a href="${data.chartUrl}" target="_blank">نمودار</a>
      <button onclick="sendCityToTelegram('${c.key}')">ارسال به تلگرام</button>
      <button onclick="loadCityDetails('${c.key}')">بروزرسانی شهر</button>
    </div>
  `;
}

async function loadCityDetails(cityKey) {
  lastCityKey = cityKey;
  const panel = document.getElementById('cityDetails');
  panel.innerHTML = '⏳ در حال دریافت اطلاعات شهر...';
  try {
    const res = await fetch(`/api/city-details?city=${encodeURIComponent(cityKey)}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'خطا در دریافت اطلاعات');
    renderCityPanel(data);
  } catch (err) {
    panel.innerHTML = `<div class="alert">❌ ${err.message}</div>`;
  }
}

async function sendCityToTelegram(cityKey) {
  const panel = document.getElementById('cityDetails');
  try {
    const res = await fetch(`/api/send-telegram?city=${encodeURIComponent(cityKey)}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'ارسال ناموفق بود');
    panel.insertAdjacentHTML('afterbegin', '<div class="info-card ok">✅ گزارش این شهر به تلگرام ارسال شد.</div>');
  } catch (err) {
    panel.insertAdjacentHTML('afterbegin', `<div class="info-card alert">❌ ${err.message}</div>`);
  }
}

async function loadMap() {
  const res = await fetch('/api/map-data');
  const data = await res.json();
  markers.forEach(m => map.removeLayer(m));
  markers = [];
  document.getElementById('updated').textContent = data.time ? `آخرین بروزرسانی: ${new Date(data.time).toLocaleString()}` : '';
  const bounds = [];

  for (const c of data.cities) {
    if (!c.lat || !c.lon) continue;
    const s = c.summary || {};
    const alerts = (c.alerts || []).length ? c.alerts.map(a => `<div>⚠️ ${a}</div>`).join('') : '<div>✅ هشدار مهمی نیست</div>';
    const html = `
      <div class="popup">
        <b>📍 ${c.fa || c.name}</b><br>
        <span class="meta">${c.name || c.key}</span><hr>
        🌡 دما: ${value(s.tempMin, '°C')} تا ${value(s.tempMax, '°C')}<br>
        🌧 بارندگی: ${value(s.rainMax, '%')}<br>
        💨 باد: ${value(s.windMax, ' km/h')}<br>
        ☀️ UV: ${value(s.uvMax)}<br>
        😷 AQI: ${value(s.aqiMax)}<hr>
        ${alerts}<br>
        <button onclick="loadCityDetails('${c.key}')">نمایش اطلاعات کامل</button>
        <a href="${c.chartUrl}" target="_blank">نمودار</a>
      </div>`;
    const m = L.marker([c.lat, c.lon], { icon: markerIcon(c.status) })
      .bindPopup(html)
      .on('click', () => loadCityDetails(c.key))
      .addTo(map);
    markers.push(m);
    bounds.push([c.lat, c.lon]);
  }

  if (bounds.length) map.fitBounds(bounds, { padding: [40, 40] });
  if (lastCityKey) loadCityDetails(lastCityKey);
}

loadMap();
setInterval(loadMap, 10 * 60 * 1000);
