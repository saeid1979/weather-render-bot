let current = null;
const $ = id => document.getElementById(id);

function password(){ return $("password").value.trim(); }
function out(x){ $("output").textContent = typeof x === "string" ? x : JSON.stringify(x,null,2); }

async function api(path, options={}){
  const headers = {"Content-Type":"application/json","x-admin-password":password(), ...(options.headers||{})};
  const res = await fetch(path, {...options, headers});
  const data = await res.json().catch(()=>({ok:false,error:"Invalid JSON"}));
  if(!res.ok) throw data;
  return data;
}

async function loadSettings(){
  try{
    const data = await api("/api/admin/settings");
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
      label.innerHTML = `<input type="checkbox" class="cityCheck" value="${c.key}" ${s.selectedCities.includes(c.key)?"checked":""}> ${c.fa || c.name}`;
      box.appendChild(label);
    });
    out(data);
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
  }catch(e){ out(e); }
}

async function sendNow(){
  try{ out(await api("/api/admin/send-now",{method:"POST",body:"{}"})); }
  catch(e){ out(e); }
}

async function testAlerts(){
  try{ out(await api("/api/admin/test-alerts",{method:"POST",body:"{}"})); }
  catch(e){ out(e); }
}
