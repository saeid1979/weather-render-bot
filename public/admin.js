let current = null;
const $ = id => document.getElementById(id);

function password(){ return $("password").value.trim(); }
function out(x){ $("output").textContent = typeof x === "string" ? x : JSON.stringify(x,null,2); }

function showTab(name){
  document.querySelectorAll('.tab').forEach(x=>x.classList.add('hidden'));
  $(`tab-${name}`).classList.remove('hidden');
}

async function api(path, options={}){
  const headers = {"Content-Type":"application/json","x-admin-password":password(), ...(options.headers||{})};
  const res = await fetch(path, {...options, headers});
  const data = await res.json().catch(()=>({ok:false,error:"Invalid JSON"}));
  if(!res.ok) throw data;
  return data;
}

async function loadAll(){
  await loadSettings();
  await loadUsers();
  await loadLogs();
}

function fillSettings(data){
  current = data;
  const s = data.settings;
  $("sendTime").value = s.sendTime || "08:00";
  $("rainThreshold").value = s.rainThreshold;
  $("windWarningKmh").value = s.windWarningKmh;
  $("uvWarning").value = s.uvWarning;
  $("heatWarningC").value = s.heatWarningC;
  $("coldWarningC").value = s.coldWarningC;
  $("alertCooldownMinutes").value = s.alertCooldownMinutes;
  $("dailyReport").checked = !!s.dailyReport;
  $("realTimeAlerts").checked = !!s.realTimeAlerts;

  const box = $("cities");
  box.innerHTML = "";
  Object.values(data.cities).forEach(c=>{
    const label = document.createElement("label");
    label.className = 'city-check';
    label.innerHTML = `<input type="checkbox" class="cityCheck" value="${c.key}" ${s.selectedCities.includes(c.key)?"checked":""}> ${c.fa || c.name} <small>(${c.key})</small>`;
    box.appendChild(label);
  });

  const quick = $("quickCity");
  quick.innerHTML = Object.values(data.cities).map(c=>`<option value="${c.key}">${c.fa || c.name}</option>`).join('');

  renderCityList(data.cities);
}

async function loadSettings(){
  try{
    const data = await api("/api/admin/settings");
    fillSettings(data);
    out({ok:true,message:'پنل بارگذاری شد', settings:data.settings});
  }catch(e){ out(e); }
}

async function saveSettings(){
  try{
    const selectedCities = [...document.querySelectorAll(".cityCheck:checked")].map(x=>x.value);
    const body = {
      sendTime:$("sendTime").value,
      rainThreshold:Number($("rainThreshold").value),
      windWarningKmh:Number($("windWarningKmh").value),
      uvWarning:Number($("uvWarning").value),
      heatWarningC:Number($("heatWarningC").value),
      coldWarningC:Number($("coldWarningC").value),
      alertCooldownMinutes:Number($("alertCooldownMinutes").value),
      dailyReport:$("dailyReport").checked,
      realTimeAlerts:$("realTimeAlerts").checked,
      selectedCities
    };
    const data = await api("/api/admin/settings",{method:"POST",body:JSON.stringify(body)});
    out(data);
    await loadSettings();
  }catch(e){ out(e); }
}

function renderCityList(cities){
  const rows = Object.values(cities).map(c=>`
    <tr>
      <td>${c.key}</td><td>${c.fa || ''}</td><td>${c.name}</td><td>${c.lat}</td><td>${c.lon}</td>
      <td><button class="small" onclick="editCity('${c.key}')">ویرایش</button><button class="small danger" onclick="deleteCity('${c.key}')">حذف</button></td>
    </tr>`).join('');
  $("cityList").innerHTML = `<table><thead><tr><th>Key</th><th>فارسی</th><th>English</th><th>Lat</th><th>Lon</th><th>عملیات</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function editCity(key){
  const c = current?.cities?.[key];
  if(!c) return;
  $("cityKey").value = c.key;
  $("cityName").value = c.name;
  $("cityFa").value = c.fa || '';
  $("cityLat").value = c.lat;
  $("cityLon").value = c.lon;
  showTab('cities');
}

async function addCity(){
  try{
    const body = {
      key: $("cityKey").value.trim(),
      name: $("cityName").value.trim(),
      fa: $("cityFa").value.trim(),
      lat: Number($("cityLat").value),
      lon: Number($("cityLon").value)
    };
    const data = await api('/api/admin/cities', {method:'POST', body:JSON.stringify(body)});
    out(data);
    await loadSettings();
  }catch(e){ out(e); }
}

async function deleteCity(key){
  if(!confirm(`حذف شهر ${key}?`)) return;
  try{
    const data = await api(`/api/admin/cities/${key}`, {method:'DELETE'});
    out(data);
    await loadSettings();
  }catch(e){ out(e); }
}

async function loadUsers(){
  try{
    const data = await api('/api/admin/users');
    const rows = data.users.map(u=>`<tr><td>${u.chatId}</td><td>${u.firstName || ''} ${u.lastName || ''}</td><td>${u.username ? '@'+u.username : ''}</td><td>${u.languageCode || ''}</td><td>${u.lastSeen || ''}</td></tr>`).join('');
    $("usersBox").innerHTML = `<table><thead><tr><th>Chat ID</th><th>نام</th><th>Username</th><th>Lang</th><th>Last Seen</th></tr></thead><tbody>${rows}</tbody></table>`;
  }catch(e){ out(e); }
}

async function loadLogs(){
  try{
    const data = await api('/api/admin/logs');
    const rows = data.logs.map(l=>`<tr><td>${l.time}</td><td>${l.type}</td><td>${l.message}</td><td><code>${JSON.stringify(l.meta || {})}</code></td></tr>`).join('');
    $("logsBox").innerHTML = `<table><thead><tr><th>Time</th><th>Type</th><th>Message</th><th>Meta</th></tr></thead><tbody>${rows}</tbody></table>`;
  }catch(e){ out(e); }
}

async function clearLogs(){
  if(!confirm('همه لاگ‌ها پاک شود؟')) return;
  try{ out(await api('/api/admin/logs',{method:'DELETE'})); await loadLogs(); }
  catch(e){ out(e); }
}

async function sendNow(){
  try{ out(await api("/api/admin/send-now",{method:"POST",body:"{}"})); }
  catch(e){ out(e); }
}

async function sendCityNow(){
  try{ out(await api('/api/admin/send-city',{method:'POST',body:JSON.stringify({city:$("quickCity").value})})); }
  catch(e){ out(e); }
}

async function testAlerts(){
  try{ out(await api("/api/admin/test-alerts",{method:"POST",body:"{}"})); }
  catch(e){ out(e); }
}
