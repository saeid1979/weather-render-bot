const map = L.map('map').setView([38.5, 23], 4);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap' }).addTo(map);
let markers = [];
function colorByStatus(status){ return status === 'danger' ? '#ef4444' : status === 'warning' ? '#f59e0b' : status === 'error' ? '#64748b' : '#22c55e'; }
function markerIcon(status){
  const color = colorByStatus(status);
  return L.divIcon({ className:'', html:`<div style="width:24px;height:24px;background:${color};border:3px solid white;border-radius:50%;box-shadow:0 4px 14px #0008"></div>`, iconSize:[24,24], iconAnchor:[12,12] });
}
async function loadMap(){
  const res = await fetch('/api/map-data');
  const data = await res.json();
  markers.forEach(m=>map.removeLayer(m)); markers = [];
  document.getElementById('updated').textContent = data.time ? `آخرین بروزرسانی: ${new Date(data.time).toLocaleString()}` : '';
  const bounds = [];
  for(const c of data.cities){
    if(!c.lat || !c.lon) continue;
    const s = c.summary || {};
    const alerts = (c.alerts || []).length ? c.alerts.map(a=>`<div>⚠️ ${a}</div>`).join('') : '<div>✅ هشدار مهمی نیست</div>';
    const html = `<div class="popup"><b>📍 ${c.fa || c.name}</b><br><span class="meta">${c.name || c.key}</span><hr>🌡 دما: ${s.tempMin ?? '-'} تا ${s.tempMax ?? '-'}°C<br>🌧 بارندگی: ${s.rainMax ?? '-'}%<br>💨 باد: ${s.windMax ?? '-'} km/h<br>☀️ UV: ${s.uvMax ?? '-'}<br>😷 AQI: ${s.aqiMax ?? '-'}<hr>${alerts}<br><a href="${c.reportUrl}" target="_blank">گزارش متنی</a><a href="${c.chartUrl}" target="_blank">نمودار</a></div>`;
    const m = L.marker([c.lat, c.lon], { icon: markerIcon(c.status) }).bindPopup(html).addTo(map);
    markers.push(m); bounds.push([c.lat, c.lon]);
  }
  if(bounds.length) map.fitBounds(bounds, { padding:[40,40] });
}
loadMap();
setInterval(loadMap, 10 * 60 * 1000);
