let ADMIN_PASSWORD = localStorage.getItem('ADMIN_PASSWORD') || '';
function qs(id){ return document.getElementById(id); }
function login(){ ADMIN_PASSWORD = qs('password').value.trim(); localStorage.setItem('ADMIN_PASSWORD', ADMIN_PASSWORD); showAdmin(); }
function showAdmin(){ if(!ADMIN_PASSWORD) return; qs('login').classList.add('hidden'); qs('admin').classList.remove('hidden'); loadUsers(); loadLogs(); }
async function api(url, options={}){
  const res = await fetch(url, { ...options, headers: { 'Content-Type':'application/json', 'x-admin-password': ADMIN_PASSWORD, ...(options.headers||{}) } });
  const data = await res.json().catch(()=>({ok:false,error:'Invalid JSON'}));
  if(!res.ok) throw data;
  return data;
}
async function loadUsers(){
  try{
    const {users}=await api('/api/admin/users');
    const rows = users.map(u=>`<tr><td>${u.chatId}</td><td>${u.firstName||''}</td><td>${u.username||''}</td><td>${u.language||''}</td><td>${u.city||''}</td><td>${u.sendTime||''}</td><td>${u.rainThreshold||''}%</td><td>${u.isAdmin?'Admin':'User'}</td><td>${u.isActive!==false?'فعال':'غیرفعال'}</td><td><button onclick='editUser(${JSON.stringify(u).replace(/'/g,"&#39;")})'>ویرایش</button><button class="danger" onclick="deleteUser('${u.chatId}')">حذف</button></td></tr>`).join('');
    qs('usersTable').innerHTML = `<thead><tr><th>Chat ID</th><th>نام</th><th>Username</th><th>Lang</th><th>City</th><th>Time</th><th>Rain</th><th>Role</th><th>Status</th><th>عملیات</th></tr></thead><tbody>${rows}</tbody>`;
  }catch(e){ alert(e.error || JSON.stringify(e)); }
}
function editUser(u){ qs('u_chatId').value=u.chatId||''; qs('u_firstName').value=u.firstName||''; qs('u_username').value=u.username||''; qs('u_language').value=u.language||'fa'; qs('u_city').value=u.city||'madrid'; qs('u_sendTime').value=u.sendTime||'08:00'; qs('u_rain').value=u.rainThreshold||50; qs('u_admin').checked=!!u.isAdmin; }
async function saveUser(){
  try{
    await api('/api/admin/users',{method:'POST',body:JSON.stringify({chatId:qs('u_chatId').value.trim(),firstName:qs('u_firstName').value.trim(),username:qs('u_username').value.trim(),language:qs('u_language').value,city:qs('u_city').value,sendTime:qs('u_sendTime').value.trim(),rainThreshold:Number(qs('u_rain').value),isAdmin:qs('u_admin').checked})});
    await loadUsers(); alert('ذخیره شد');
  }catch(e){ alert(e.error || JSON.stringify(e)); }
}
async function deleteUser(chatId){ if(!confirm('حذف شود؟')) return; await api('/api/admin/users/'+chatId,{method:'DELETE'}); loadUsers(); }
async function sendBroadcast(){
  const text = qs('broadcastText').value.trim();
  if(!text){ qs('broadcastResult').innerHTML='<p class="bad">متن پیام خالی است.</p>'; return; }
  qs('broadcastResult').innerHTML='<p>در حال ارسال...</p>';
  try{
    const r = await api('/api/admin/broadcast',{method:'POST',body:JSON.stringify({text})});
    let html = `<div class="result"><h3>نتیجه ارسال همگانی</h3><p>کل: ${r.total} | ✅ موفق: ${r.sent} | ❌ ناموفق: ${r.failed}</p><table><thead><tr><th>Chat ID</th><th>User</th><th>Status</th><th>Error</th></tr></thead><tbody>`;
    html += r.results.map(x=>`<tr class="${x.ok?'ok':'fail'}"><td>${x.chatId}</td><td>${x.firstName||''} ${x.username||''}</td><td>${x.ok?'✅ ارسال شد':'❌ خطا: '+x.status}</td><td>${x.description||''}</td></tr>`).join('');
    html += '</tbody></table></div>';
    qs('broadcastResult').innerHTML = html;
    loadLogs();
  }catch(e){ qs('broadcastResult').innerHTML = `<p class="bad">خطا: ${e.error || JSON.stringify(e)}</p>`; }
}
async function loadLogs(){
  try{
    const {logs}=await api('/api/admin/logs');
    const rows = logs.map(l=>`<tr><td>${l.time}</td><td>${l.type}</td><td>${l.message}</td><td><pre>${JSON.stringify(l.meta||{})}</pre></td></tr>`).join('');
    qs('logsTable').innerHTML=`<thead><tr><th>Time</th><th>Type</th><th>Message</th><th>Meta</th></tr></thead><tbody>${rows}</tbody>`;
  }catch(e){ console.error(e); }
}
async function clearLogs(){ if(!confirm('همه لاگ‌ها پاک شود؟')) return; await api('/api/admin/logs/clear',{method:'POST'}); loadLogs(); }
showAdmin();
