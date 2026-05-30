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

  const botOptions = (data.bots || [{key:'main'}]).map(b=>`<option value="${b.key}">${b.key}${b.isDefault?' (default)':''}</option>`).join('');
  ['userBotKey','broadcastBotKey','quickBotKey'].forEach(id=>{ if($(id)) $(id).innerHTML = `<option value="">همه / پیش‌فرض</option>` + botOptions; });

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
      <td>${c.key}</td><td>${c.fa || ''}</td><td>${c.es || ''}</td><td>${c.ar || ''}</td><td>${c.name}</td><td>${c.lat}</td><td>${c.lon}</td>
      <td><button class="small" onclick="editCity('${c.key}')">ویرایش</button><button class="small danger" onclick="deleteCity('${c.key}')">حذف</button></td>
    </tr>`).join('');
  $("cityList").innerHTML = `<table><thead><tr><th>Key</th><th>فارسی</th><th>Español</th><th>العربية</th><th>English</th><th>Lat</th><th>Lon</th><th>عملیات</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function editCity(key){
  const c = current?.cities?.[key];
  if(!c) return;
  $("cityKey").value = c.key;
  $("cityName").value = c.name;
  $("cityFa").value = c.fa || '';
  $("cityEs").value = c.es || '';
  $("cityAr").value = c.ar || '';
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
      es: $("cityEs").value.trim(),
      ar: $("cityAr").value.trim(),
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
    const rows = data.users.map(u=>`<tr>
      <td>${u.botKey || 'main'}</td>
      <td>${u.chatId}</td>
      <td>${u.firstName || ''} ${u.lastName || ''}</td>
      <td>${u.username ? '@'+u.username : ''}</td>
      <td>${u.language || u.languageCode || ''}</td>
      <td>${u.city || ''}</td>
      <td>${u.sendTime || ''}</td>
      <td>${u.rainThreshold ?? ''}%</td>
      <td>${u.isActive === false ? 'غیرفعال' : 'فعال'}</td>
      <td>${u.isAdmin ? 'Admin' : ''}</td>
      <td>${u.lastSeen || ''}</td>
      <td><button class="small" onclick="editUser('${u.storageKey || ((u.botKey||'main')+':'+u.chatId)}')">ویرایش</button><button class="small" onclick="testUser('${u.chatId}','${u.botKey || 'main'}')">تست ارسال</button><button class="small danger" onclick="deleteUser('${u.chatId}','${u.botKey || 'main'}')">غیرفعال</button></td>
    </tr>`).join('');
    window.__users = data.users;
    $("usersBox").innerHTML = `<table><thead><tr><th>Bot</th><th>Chat ID</th><th>نام</th><th>Username</th><th>Lang</th><th>City</th><th>Time</th><th>Rain</th><th>Status</th><th>Role</th><th>Last Seen</th><th>عملیات</th></tr></thead><tbody>${rows}</tbody></table>`;
  }catch(e){ out(e); }
}

function editUser(storageKey){
  const u = (window.__users || []).find(x => String(x.storageKey || ((x.botKey||'main')+':'+x.chatId)) === String(storageKey) || String(x.chatId) === String(storageKey));
  if(!u) return;
  if($("userBotKey")) $("userBotKey").value = u.botKey || 'main';
  $("userChatId").value = u.chatId || '';
  $("userFirstName").value = u.firstName || '';
  $("userUsername").value = u.username || '';
  $("userLanguage").value = u.language || 'fa';
  $("userCity").value = u.city || 'madrid';
  $("userSendTime").value = u.sendTime || '08:00';
  $("userRainThreshold").value = u.rainThreshold || 50;
  $("userIsAdmin").checked = !!u.isAdmin;
  showTab('users');
}

async function saveUser(){
  try{
    const body = {
      botKey: $("userBotKey") ? ($("userBotKey").value || 'main') : 'main',
      chatId: $("userChatId").value.trim(),
      firstName: $("userFirstName").value.trim(),
      username: $("userUsername").value.trim(),
      language: $("userLanguage").value,
      city: $("userCity").value.trim() || 'madrid',
      sendTime: $("userSendTime").value || '08:00',
      rainThreshold: Number($("userRainThreshold").value || 50),
      isAdmin: $("userIsAdmin").checked,
      isActive: true
    };
    const data = await api('/api/admin/users', {method:'POST', body:JSON.stringify(body)});
    out(data);
    await loadUsers();
  }catch(e){ out(e); }
}

async function deleteUser(chatId, botKey='main'){
  if(!confirm(`کاربر ${botKey}:${chatId} غیرفعال شود؟`)) return;
  try{ out(await api(`/api/admin/users/${chatId}?botKey=${encodeURIComponent(botKey)}`, {method:'DELETE'})); await loadUsers(); }
  catch(e){ out(e); }
}

async function broadcast(){
  try{
    const text = $("broadcastText").value.trim();
    const botKey = $("broadcastBotKey") ? $("broadcastBotKey").value : '';
    const data = await api('/api/admin/broadcast', {method:'POST', body:JSON.stringify({text, botKey})});
    out(data);
    if(data.results){
      const rows = data.results.map(r=>`<tr><td>${r.ok?'✅':'❌'}</td><td>${r.botKey}</td><td>${r.chatId}</td><td>${r.username||''}</td><td>${r.status}</td><td>${r.description||''}</td></tr>`).join('');
      $("broadcastResults").innerHTML = `<table><thead><tr><th>نتیجه</th><th>Bot</th><th>Chat ID</th><th>Username</th><th>Status</th><th>توضیح</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
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
  try{ out(await api("/api/admin/send-daily-to-all",{method:"POST",body:"{}"})); await loadLogs(); }
  catch(e){ out(e); }
}

async function testUser(chatId, botKey='main'){
  try{ out(await api(`/api/admin/test-user/${encodeURIComponent(botKey)}/${encodeURIComponent(chatId)}`)); await loadLogs(); }
  catch(e){ out(e); }
}

async function sendCityNow(){
  try{ out(await api('/api/admin/send-city',{method:'POST',body:JSON.stringify({city:$("quickCity").value, botKey: $("quickBotKey") ? $("quickBotKey").value : ''})})); }
  catch(e){ out(e); }
}

async function testAlerts(){
  try{ out(await api("/api/admin/test-alerts",{method:"POST",body:"{}"})); }
  catch(e){ out(e); }
}
