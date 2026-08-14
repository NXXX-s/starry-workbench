/* ============================================================
   星穹机甲 · 创作者工作台 — 应用逻辑
   ============================================================ */
'use strict';

/* ---------- 工具 ---------- */
const $ = id => document.getElementById(id);
let toastTimer = null;
function toast(msg){
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function relTime(iso){
  if(!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if(s < 3600) return Math.max(1, Math.floor(s/60)) + ' 分钟前';
  if(s < 86400) return Math.floor(s/3600) + ' 小时前';
  if(s < 86400*30) return Math.floor(s/86400) + ' 天前';
  return new Date(iso).toLocaleDateString('zh-CN');
}
const CAT_COLOR = { '剪辑':'#00f5ff', '设计':'#ff2e93', '情报':'#ffd166', '阅读':'#8b5cff', '其他':'#8a93c9' };

/* ---------- Supabase 初始化 ---------- */
if(!window.APP_CONFIG || !window.APP_CONFIG.supabaseUrl || window.APP_CONFIG.supabaseUrl.includes('YOUR-PROJECT')){
  $('auth-err').textContent = '⚠ 请先配置 js/config.js（参考 config.example.js）';
}
const sb = window.supabase.createClient(
  window.APP_CONFIG.supabaseUrl,
  window.APP_CONFIG.supabaseAnonKey
);
let USER = null, PROFILE = null, IS_ADMIN = false;
const DB = { todos:[], assets:[], sbs:[], ideas:[], pals:[], comps:[], reqs:[], news:[], books:[], quotes:[], shelf:[], settings:{}, adminUsers:[], config:{}, notifs:[], materials:[], mreadIds:new Set() };

function setSync(txt){ $('sync-state').textContent = txt; }
function authErr(msg){ $('auth-err').textContent = msg; }

/* ---------- 邮箱有效性检查（格式 + MX 记录，阿里 DoH 国内可达） ---------- */
function emailFormatOk(email){ return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email); }
async function emailMxOk(email){
  try{
    const domain = email.split('@')[1];
    const res = await fetch('https://dns.alidns.com/resolve?name=' + encodeURIComponent(domain) + '&type=MX', { headers: { 'accept': 'application/dns-json' } });
    if(!res.ok) return null;                       // HTTP 异常 → 未知
    const j = await res.json();
    if(!j || typeof j !== 'object') return null;
    if(!Array.isArray(j.Answer)) return false;     // 有效响应但无 MX 记录（NXDOMAIN/无MX）→ 明确无效
    return j.Answer.length > 0;
  }catch(e){ return null; }                        // 网络异常 → 未知
}

/* ---------- 登录 / 注册 ---------- */
let authMode = 'login';
document.querySelectorAll('[data-amode]').forEach(b => b.addEventListener('click', () => {
  authMode = b.dataset.amode;
  document.querySelectorAll('[data-amode]').forEach(x => x.classList.toggle('active', x === b));
  $('nick-row').style.display = authMode === 'register' ? 'block' : 'none';
  $('auth-btn').textContent = authMode === 'register' ? '✨ 创建账号' : '⚡ 进入工作台';
  authErr('');
}));
$('auth-btn').addEventListener('click', async () => {
  const email = $('auth-email').value.trim(), pass = $('auth-pass').value;
  if(!email || !pass){ authErr('请填写邮箱和密码'); return; }
  if(pass.length < 6){ authErr('密码至少 6 位'); return; }
  const btn = $('auth-btn'); btn.disabled = true; authErr('');
  try{
    if(authMode === 'register'){
      const { data, error } = await sb.auth.signUp({ email, password: pass });
      if(error) throw error;
      const nick = $('auth-nick').value.trim();
      if(nick && data.user){
        await sb.from('profiles').update({ nickname: nick }).eq('id', data.user.id);
      }
      /* 邮箱有效性检查：格式 + MX 记录（无效也允许注册，但标记并通知管理员） */
      if(data.user){
        let valid = null;
        const fmt = emailFormatOk(email);
        const mx = fmt ? await emailMxOk(email) : false;
        if(fmt && mx === null) valid = null;      // 网络异常 → 未知，不标记
        else valid = fmt && mx !== false;         // 明确无效 → false
        const patch = { email_valid: valid, email_checked_at: new Date().toISOString() };
        if(valid === false) patch.invalid_flagged_at = new Date().toISOString();
        try{ await sb.from('profiles').update(patch).eq('id', data.user.id); }catch(e){}
        toast(valid === false ? '⚠ 注册成功，但邮箱无效，管理员将收到提醒' : '✨ 注册成功，邮箱验证通过');
      } else {
        toast('✨ 注册成功');
      }
      /* 自动确认已开启：注册即登录；否则留在登录页 */
      if(data.session){
        onAuth(data.session.user);
      } else {
        authMode = 'login';
        document.querySelectorAll('[data-amode]')[0].click();
      }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password: pass });
      if(error) throw error;
    }
  }catch(e){
    const m = e.message || '';
    authErr(/email.*invalid|invalid.*email|email_address_invalid/i.test(m)
      ? '该邮箱无法注册（无效或不允许的邮箱），请换个邮箱试试'
      : (/rate\s?limit/i.test(m) ? '注册太频繁，请等几分钟再试' : m));
  }finally{ btn.disabled = false; }
});
$('logout-btn').addEventListener('click', () => { sb.auth.signOut(); });

async function restoreSession(){
  const { data } = await sb.auth.getSession();
  if(data.session) onAuth(data.session.user);
}
sb.auth.onAuthStateChange((_ev, session) => {
  if(session) onAuth(session.user);
  else onLogout();
});
function onAuth(user){
  USER = user;
  $('auth-gate').style.display = 'none';
  $('app').style.display = 'flex';
  loadAll();
}
function onLogout(){
  USER = null; PROFILE = null;
  $('app').style.display = 'none';
  $('auth-gate').style.display = 'grid';
  $('auth-pass').value = '';
}

/* ---------- 导航 ---------- */
const CRUMB = { home:'首页', edit:'剪辑工作台', design:'设计工作台', materials:'每日素材', news:'新闻情报', books:'书单阅读', todo:'待办清单' };
function nav(id){
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $('view-' + id).classList.add('active');
  document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === id));
  $('crumb').textContent = CRUMB[id];
  chibiReact(id);
  window.scrollTo({ top: 0 });
}
document.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => nav(b.dataset.nav)));
document.querySelectorAll('[data-jump]').forEach(c => c.addEventListener('click', () => nav(c.dataset.jump)));
/* ---------- 铃铛：管理员通知 ---------- */
function renderBellBadge(){
  const badge = $('bell-badge');
  const unread = DB.notifs.filter(x => !x.read).length;
  if(IS_ADMIN && unread > 0){
    badge.style.display = 'block';
    badge.textContent = unread > 9 ? '9+' : unread;
  } else badge.style.display = 'none';
}
$('bell').addEventListener('click', async () => {
  if(IS_ADMIN && DB.notifs.length){
    $('notif-list').innerHTML = DB.notifs.map(x => `
      <div class="notif-item${x.read ? '' : ' unread'}">
        <b>${esc(x.title)}</b>
        <p>${esc(x.body)}</p>
        <small>${new Date(x.created_at).toLocaleString('zh-CN')}</small>
      </div>`).join('') || '<div class="empty">暂无提醒</div>';
    $('notif-modal').classList.add('show');
    /* 打开即全部已读 */
    try{
      await sb.from('notifications').update({ read: true }).eq('user_id', USER.id).is('read', false);
      DB.notifs.forEach(x => x.read = true);
      renderBellBadge();
    }catch(e){}
  } else nav('news');
});
$('notif-close').addEventListener('click', () => $('notif-modal').classList.remove('show'));
$('notif-modal').addEventListener('click', e => { if(e.target === $('notif-modal')) $('notif-modal').classList.remove('show'); });
document.addEventListener('keydown', e => { if(e.key === 'Escape') $('reader').classList.remove('show'); });

/* ---------- 全量加载 ---------- */
async function loadAll(){
  setSync('☁ 同步中…');
  try{
    const [p, t, a, s, i, pa, c, r, n, b, q, sh, st, co, nt, dm, mr] = await Promise.all([
      sb.from('profiles').select('*').single(),
      sb.from('todos').select('*').order('created_at'),
      sb.from('assets').select('*').order('created_at', { ascending: false }),
      sb.from('storyboards').select('*').order('shot_no'),
      sb.from('inspirations').select('*').order('created_at', { ascending: false }),
      sb.from('palettes').select('*').order('created_at', { ascending: false }),
      sb.from('components').select('*').order('created_at', { ascending: false }),
      sb.from('requirements').select('*').order('created_at', { ascending: false }),
      sb.from('news').select('*').order('published_at', { ascending: false }).limit(30),
      sb.from('books').select('*').order('rate', { ascending: false }),
      sb.from('quotes').select('*').order('id'),
      sb.from('shelf').select('*'),
      sb.from('user_settings').select('*').maybeSingle(),
      sb.from('app_config').select('key,value'),
      sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(20),
      sb.from('daily_materials').select('*').order('created_at', { ascending: false }).limit(80),
      sb.from('material_reads').select('material_id')
    ]);
    PROFILE = p.data || { nickname: '创作者', avatar_emoji: '✨' };
    DB.todos = t.data || []; DB.assets = a.data || []; DB.sbs = s.data || [];
    DB.ideas = i.data || []; DB.pals = pa.data || []; DB.comps = c.data || [];
    DB.reqs = r.data || []; DB.news = n.data || []; DB.books = b.data || [];
    DB.quotes = q.data || []; DB.shelf = sh.data || []; DB.settings = st.data || {};
    DB.config = Object.fromEntries((co.data || []).map(x => [x.key, x.value]));
    DB.notifs = nt.data || [];
    DB.materials = dm.data || [];
    DB.mreadIds = new Set((mr.data || []).map(x => x.material_id));
    /* 管理员探测（非管理员会抛错，静默忽略） */
    IS_ADMIN = false; DB.adminUsers = [];
    try{
      const { data: au } = await sb.rpc('admin_list_users');
      if(Array.isArray(au)){ IS_ADMIN = true; DB.adminUsers = au; }
    }catch(e){ /* 非管理员 */ }
    renderBellBadge();
    setSync('☁ 已同步 · 📱 多端互通');
    renderAll();
  }catch(e){
    setSync('⚠ 同步失败：' + (e.message || e));
    toast('⚠ 数据加载失败，请检查网络');
  }
}

function renderAll(){
  $('user-nick').textContent = PROFILE.nickname || '创作者';
  renderHome(); renderTodos(); renderAssets(); renderSbs();
  renderIdeas(); renderPals(); renderComps(); renderReqs();
  renderNews(); renderBooks(); renderShelf(); renderQuote();
  renderAdminPanel(); renderMaterials();
}

/* ---------- 账号管理（管理员） ---------- */
function renderAdminPanel(){
  if(!IS_ADMIN) return;
  const ttl = parseInt(DB.config.invalid_email_ttl_days || '7', 10);
  $('set-ttl').value = String(ttl);
  $('set-mret').value = String(parseInt(DB.config.material_retention_days || '1', 10));
  $('admin-list').innerHTML = DB.adminUsers.map(u => {
    const inv = u.email_valid === false;
    let invTxt = '';
    if(inv && u.invalid_flagged_at){
      const days = Math.floor((Date.now() - new Date(u.invalid_flagged_at).getTime()) / 864e5);
      invTxt = ttl > 0 ? `剩余 ${Math.max(0, ttl - days)} 天` : '永久保留';
    }
    return `<div class="admin-row">
      <div class="ar-main"><b>${esc(u.nickname)}${u.id === USER.id ? '（我）' : ''}</b>
        ${inv ? `<span class="badge-inv">⚠ 邮箱无效 · ${invTxt}</span>` : ''}
        <small>${esc(u.email)} · 注册 ${new Date(u.created_at).toLocaleDateString('zh-CN')}${u.last_sign_in_at ? ' · 最近登录 ' + new Date(u.last_sign_in_at).toLocaleDateString('zh-CN') : ''}${u.banned_until ? ' · <span style="color:var(--magenta)">⛔ 已封禁</span>' : ''}</small></div>
      <div class="ar-actions">
        <button data-uid="${u.id}" data-act="admin">${u.is_admin ? '取消管理' : '设为管理'}</button>
        <button data-uid="${u.id}" data-act="ban">${u.banned_until ? '解封' : '封禁7天'}</button>
        <button data-uid="${u.id}" data-act="del" class="danger">删除</button>
      </div>
    </div>`;
  }).join('') || '<div class="empty">暂无用户</div>';
  $('admin-list').querySelectorAll('button').forEach(btn => btn.addEventListener('click', async () => {
    const uid = btn.dataset.uid, act = btn.dataset.act;
    const u = DB.adminUsers.find(x => x.id === uid);
    if(!u) return;
    try{
      if(act === 'admin'){
        await sb.rpc('admin_set_admin', { uid, make_admin: !u.is_admin });
        toast(u.is_admin ? '👑 已取消该用户管理员' : '👑 已设为管理员');
      }else if(act === 'ban'){
        if(!u.banned_until && !confirm('确认封禁 ' + (u.email || u.nickname) + ' 7 天？封禁期间无法登录。')) return;
        await sb.rpc('admin_ban_user', { uid, days: u.banned_until ? 0 : 7 });
        toast(u.banned_until ? '✅ 已解封' : '⛔ 已封禁 7 天');
      }else if(act === 'del'){
        if(u.id === USER.id){ toast('⚠ 不能删除自己的账号'); return; }
        if(!confirm('确认删除账号 ' + (u.email || u.nickname) + '？\n该用户的所有数据将永久清除，不可恢复！')) return;
        await sb.rpc('admin_delete_user', { uid });
        toast('🗑 账号已删除');
      }
      loadAll();
    }catch(e){ toast('⚠ ' + (e.message || '操作失败')); }
  }));
}

/* ---------- 首页 ---------- */
function renderHome(){
  const h = new Date().getHours();
  const greet = h < 6 ? '夜深了，' : h < 12 ? '早上好，' : h < 18 ? '下午好，' : '晚上好，';
  $('greet-name').innerHTML = greet + '<span class="g">' + esc(PROFILE.nickname || '创作者') + '</span>';
  $('greet-date').textContent = new Date().toLocaleDateString('zh-CN', { year:'numeric', month:'long', day:'numeric', weekday:'long' });
  const today = DB.news.filter(n => new Date(n.published_at).toDateString() === new Date().toDateString()).length;
  $('stat-todos').textContent = DB.todos.filter(t => !t.done).length;
  $('stat-assets').textContent = DB.assets.length;
  $('stat-ideas').textContent = DB.ideas.length;
  $('stat-news').textContent = today;
  $('todo-pending').textContent = DB.todos.filter(t => !t.done).length + ' 项未完成';
  $('news-last').textContent = DB.news.length ? '最近更新 · ' + relTime(DB.news[0].published_at) : '今日已更新';
  $('bell-badge').style.display = today ? 'block' : 'none';
  $('bell-badge').textContent = today;
  /* 首页情报速览 */
  $('home-news').innerHTML = DB.news.slice(0, 4).map(n => `
    <div class="news-item" onclick="window.open('${esc(n.url)}','_blank')">
      <span class="tag ${n.category === 'delta' ? 'dz' : 'ai'}">${n.category === 'delta' ? '三角洲' : 'AI'}</span>
      <div><div class="t">${esc(n.title)}</div><div class="m">${esc(n.source)} · ${relTime(n.published_at)}</div></div>
    </div>`).join('') || '<div class="empty">还没有新闻，等每日 08:00 自动更新</div>';
  /* 首页待办 */
  const top = DB.todos.slice(0, 5);
  $('home-todos').innerHTML = top.map(t => todoItemHTML(t)).join('') || '<div class="empty">今天还没有待办</div>';
  bindTodoEvents($('home-todos'));
  const done = DB.todos.filter(t => t.done).length, total = DB.todos.length;
  const bar = $('home-bar');
  bar.style.display = total ? 'block' : 'none';
  if(total){ bar.querySelector('i').style.width = Math.round(done/total*100) + '%'; $('home-bar-label').textContent = done + ' / ' + total + ' 项完成'; }
}

/* ---------- 待办 ---------- */
function todoItemHTML(t){
  return `<div class="todo-item ${t.done ? 'done' : ''}" data-id="${t.id}">
    <input type="checkbox" ${t.done ? 'checked' : ''}>
    <span class="t">${esc(t.text)}</span>
    <span class="c" style="color:${CAT_COLOR[t.cat] || 'var(--muted)'};border-color:${CAT_COLOR[t.cat] || 'var(--line)'}33">${esc(t.cat)}</span>
    <button class="del" title="删除">✕</button></div>`;
}
function bindTodoEvents(container){
  container.querySelectorAll('.todo-item').forEach(item => {
    const id = item.dataset.id;
    item.querySelector('input').addEventListener('change', async e => {
      const done = e.target.checked;
      item.classList.toggle('done', done);
      await sb.from('todos').update({ done }).eq('id', id);
      if(done){ chibiReact('todo-done'); }
      toast(done ? '✨ 完成！' : '已恢复待办');
      renderAll();
    });
    item.querySelector('.del').addEventListener('click', async e => {
      e.stopPropagation();
      await sb.from('todos').delete().eq('id', id);
      toast('已删除待办');
      renderAll();
    });
  });
}
function renderTodos(){
  $('todo-list').innerHTML = DB.todos.map(todoItemHTML).join('') || '<div class="empty">清单空空，添加第一个待办吧</div>';
  bindTodoEvents($('todo-list'));
  const done = DB.todos.filter(t => t.done).length, total = DB.todos.length;
  const bar = $('todo-bar');
  bar.style.display = total ? 'block' : 'none';
  if(total){ bar.querySelector('i').style.width = Math.round(done/total*100) + '%'; $('todo-bar-label').textContent = done + ' / ' + total + ' 项完成'; }
}
$('todo-add').addEventListener('click', async () => {
  const text = $('todo-input').value.trim();
  if(!text) return;
  await sb.from('todos').insert({ text, cat: $('todo-cat').value });
  $('todo-input').value = '';
  toast('☑ 已添加待办');
  loadAll();
});
$('todo-input').addEventListener('keydown', e => { if(e.key === 'Enter') $('todo-add').click(); });

/* ---------- 素材库 ---------- */
$('asset-add').addEventListener('click', async () => {
  const file = $('asset-file').files[0];
  if(!file){ toast('📎 请先选择要上传的文件'); return; }
  const name = $('asset-name').value.trim() || file.name;
  const type = $('asset-type').value;
  const path = USER.id + '/' + Date.now() + '_' + file.name.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
  $('asset-add').disabled = true;
  try{
    const { error: upErr } = await sb.storage.from('assets').upload(path, file);
    if(upErr) throw upErr;
    const { data: pub } = sb.storage.from('assets').getPublicUrl(path);
    await sb.from('assets').insert({
      name, type, storage_path: path,
      size_mb: Math.round(file.size / 104857.6) / 10,
      duration: type === '视频' ? '—' : ''
    });
    toast('⬆ 上传成功：' + name);
    $('asset-file').value = ''; $('asset-name').value = '';
    loadAll();
  }catch(e){
    toast('⚠ 上传失败：' + (e.message || e));
  }finally{ $('asset-add').disabled = false; }
});
function assetThumb(type){
  const g = {
    '视频':'linear-gradient(135deg,#1a1a3e,#3b1d6e 60%,#ff2e93)',
    '音频':'linear-gradient(135deg,#12213f,#0e4d64)',
    '图片':'linear-gradient(135deg,#3d1d5e,#8b5cff)',
    '工程':'linear-gradient(135deg,#4a1030,#ff2e93)'
  }[type] || 'linear-gradient(135deg,#12183f,#2a2f5e)';
  const em = { '视频':'🎬','音频':'🎧','图片':'🖼️','工程':'📦' }[type] || '📁';
  return { g, em };
}
function renderAssets(){
  $('asset-count').textContent = DB.assets.length + ' 个文件';
  $('asset-grid').innerHTML = DB.assets.map(a => {
    const { g, em } = assetThumb(a.type);
    const { data: pub } = sb.storage.from('assets').getPublicUrl(a.storage_path);
    return `<div class="asset mech" data-id="${a.id}">
      <div class="thumb" style="background:${g}">${em}<span class="dur">${esc(a.duration || a.size_mb + 'MB')}</span></div>
      <h4 title="${esc(a.name)}">${esc(a.name)}</h4>
      ${a.url ? `<a class="asset-link" href="${esc(a.url)}" target="_blank" rel="noopener">🔗 打开来源</a>` : ''}
      <div class="m"><span>${esc(a.type)}</span>${a.storage_path ? `<a href="${pub.publicUrl}" target="_blank" style="color:var(--cyan);text-decoration:none">下载 ↗</a>` : ''}</div>
      <button class="del" title="删除">✕</button></div>`;
  }).join('') || '<div class="empty">还没有素材，点击「上传素材」添加（视频/音频/图片/工程压缩包）</div>';
  $('asset-grid').querySelectorAll('.asset').forEach(card => {
    card.querySelector('.del').addEventListener('click', async e => {
      e.stopPropagation();
      const id = card.dataset.id, a = DB.assets.find(x => x.id === id);
      if(a && a.storage_path) await sb.storage.from('assets').remove([a.storage_path]);
      await sb.from('assets').delete().eq('id', id);
      toast('已删除素材');
      loadAll();
    });
  });
}

/* ---------- 分镜 ---------- */
$('sb-add').addEventListener('click', async () => {
  const title = $('sb-title').value.trim();
  if(!title){ toast('请填写镜头内容'); return; }
  await sb.from('storyboards').insert({
    project: '未命名项目',
    shot_no: DB.sbs.length + 1,
    title, scene: $('sb-scene').value.trim(), status: $('sb-status').value
  });
  $('sb-title').value = ''; $('sb-scene').value = '';
  toast('🎬 镜头已添加');
  loadAll();
});
const SB_STATUS = { '待拍摄':'todo', '已拍摄':'ok', '剪辑中':'wip' };
function renderSbs(){
  $('sb-count').textContent = DB.sbs.length + ' 个镜头';
  $('sb-list').innerHTML = DB.sbs.map((s, i) => `
    <div class="sb mech" data-id="${s.id}">
      <div class="no">${String(s.shot_no).padStart(2, '0')}</div>
      <div><h4>${esc(s.title)} <span class="st ${SB_STATUS[s.status] || 'todo'}" data-st>${esc(s.status)}</span></h4>
      ${s.scene ? `<p>${esc(s.scene)}</p>` : ''}</div>
      <button class="del" title="删除">✕</button>
    </div>`).join('') || '<div class="empty">还没有分镜脚本，添加第一个镜头吧</div>';
  $('sb-list').querySelectorAll('.sb').forEach(card => {
    card.querySelector('[data-st]').addEventListener('click', async e => {
      e.stopPropagation();
      const order = ['待拍摄', '已拍摄', '剪辑中'];
      const next = order[(order.indexOf(DB.sbs.find(x => x.id === card.dataset.id).status) + 1) % 3];
      await sb.from('storyboards').update({ status: next }).eq('id', card.dataset.id);
      loadAll();
    });
    card.querySelector('.del').addEventListener('click', async e => {
      e.stopPropagation();
      await sb.from('storyboards').delete().eq('id', card.dataset.id);
      toast('已删除镜头');
      loadAll();
    });
  });
}

/* ---------- 灵感 ---------- */
const IDEA_GRADS = [
  'linear-gradient(135deg,#0a0a1e,#8b5cff 70%,#00f5ff)',
  'linear-gradient(135deg,#2b1055,#7597de 60%,#e2a9f3)',
  'linear-gradient(135deg,#051937,#004d7a 60%,#00f5ff)',
  'linear-gradient(135deg,#f6d365,#fda085)',
  'linear-gradient(135deg,#42275a,#734b6d 60%,#e0aaff)',
  'linear-gradient(135deg,#0f2027,#2c5364 60%,#00f5ff)'
];
$('idea-add').addEventListener('click', async () => {
  const title = $('idea-title').value.trim();
  if(!title){ toast('请填写灵感标题'); return; }
  await sb.from('inspirations').insert({ title, tag: $('idea-tag').value.trim() || '灵感', url: $('idea-url').value.trim() });
  $('idea-title').value = ''; $('idea-tag').value = ''; $('idea-url').value = '';
  toast('💡 灵感已收藏');
  loadAll();
});
function renderIdeas(){
  $('idea-count').textContent = DB.ideas.length + ' 条';
  $('idea-grid').innerHTML = DB.ideas.map((x, i) => `
    <div class="idea mech" data-id="${x.id}">
      <div class="thumb" style="background:${IDEA_GRADS[i % IDEA_GRADS.length]}">💡</div>
      <h4>${esc(x.title)}</h4>
      <div class="m"><span>${esc(x.tag)}</span>${x.url ? '<a href="' + esc(x.url) + '" target="_blank" style="color:var(--cyan);text-decoration:none">↗</a>' : ''}</div>
      <button class="del" title="删除">✕</button></div>`).join('') || '<div class="empty">还没有灵感，收藏第一条吧</div>';
  $('idea-grid').querySelectorAll('.idea').forEach(card => {
    card.querySelector('.del').addEventListener('click', async e => {
      e.stopPropagation();
      await sb.from('inspirations').delete().eq('id', card.dataset.id);
      toast('已删除灵感');
      loadAll();
    });
  });
}

/* ---------- 配色 ---------- */
$('pal-add').addEventListener('click', async () => {
  const name = $('pal-name').value.trim();
  if(!name){ toast('请填写方案名'); return; }
  const colors = $('pal-colors').value.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
  await sb.from('palettes').insert({ name, colors, fonts: $('pal-fonts').value.trim() });
  $('pal-name').value = ''; $('pal-colors').value = ''; $('pal-fonts').value = '';
  toast('🎨 配色方案已保存');
  loadAll();
});
function renderPals(){
  $('pal-count').textContent = DB.pals.length + ' 个';
  $('pal-grid').innerHTML = DB.pals.map(p => `
    <div class="sw mech" data-id="${p.id}">
      <h4>${esc(p.name)}</h4>
      <div class="dots">${(p.colors || []).map(c => `<i style="background:${esc(c)}"></i>`).join('')}</div>
      ${p.fonts ? `<p>字体：${esc(p.fonts)}</p>` : ''}
      <button class="del" title="删除">✕</button></div>`).join('') || '<div class="empty">还没有配色方案，保存第一个吧</div>';
  $('pal-grid').querySelectorAll('.sw').forEach(card => {
    card.querySelector('.del').addEventListener('click', async e => {
      e.stopPropagation();
      await sb.from('palettes').delete().eq('id', card.dataset.id);
      toast('已删除方案');
      loadAll();
    });
  });
}

/* ---------- 组件 ---------- */
$('comp-add').addEventListener('click', async () => {
  const name = $('comp-name').value.trim();
  if(!name){ toast('请填写组件名'); return; }
  await sb.from('components').insert({ name, version: $('comp-version').value.trim() || 'v1.0' });
  $('comp-name').value = ''; $('comp-version').value = '';
  toast('🧩 组件已登记');
  loadAll();
});
function renderComps(){
  $('comp-count').textContent = DB.comps.length + ' 个';
  $('comp-grid').innerHTML = DB.comps.map(c => `
    <div class="comp mech" data-id="${c.id}">
      <h4>${esc(c.name)}</h4><span class="v">${esc(c.version)}</span>
      <button class="del" title="删除">✕</button></div>`).join('') || '<div class="empty">还没有组件</div>';
  $('comp-grid').querySelectorAll('.comp').forEach(card => {
    card.querySelector('.del').addEventListener('click', async e => {
      e.stopPropagation();
      await sb.from('components').delete().eq('id', card.dataset.id);
      toast('已删除组件');
      loadAll();
    });
  });
}

/* ---------- 需求 ---------- */
$('req-add').addEventListener('click', async () => {
  const title = $('req-title').value.trim();
  if(!title){ toast('请填写需求名'); return; }
  await sb.from('requirements').insert({ title, version: $('req-version').value.trim() || 'v1.0', status: $('req-status').value });
  $('req-title').value = ''; $('req-version').value = '';
  toast('📌 需求已创建');
  loadAll();
});
const REQ_ST = { '评审中':'rv', '进行中':'dg', '已发布':'pb', '草稿':'df' };
function renderReqs(){
  $('req-count').textContent = DB.reqs.length + ' 个';
  $('req-list').innerHTML = DB.reqs.map(r => `
    <div class="req" data-id="${r.id}">
      <b>${esc(r.title)}</b><span class="v">${esc(r.version)}</span>
      <select class="st2" style="background:var(--chip);border:1px solid var(--line);color:var(--txt);border-radius:20px;padding:3px 10px;font-size:10.5px;font-family:inherit;cursor:pointer;margin-left:auto">
        ${['评审中','进行中','已发布','草稿'].map(s => `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      <button class="del" title="删除">✕</button></div>`).join('') || '<div class="empty">还没有需求，创建第一个吧</div>';
  $('req-list').querySelectorAll('.req').forEach(row => {
    row.querySelector('select').addEventListener('change', async e => {
      await sb.from('requirements').update({ status: e.target.value }).eq('id', row.dataset.id);
      toast('状态已更新');
      loadAll();
    });
    row.querySelector('.del').addEventListener('click', async e => {
      e.stopPropagation();
      await sb.from('requirements').delete().eq('id', row.dataset.id);
      toast('已删除需求');
      loadAll();
    });
  });
}

/* ---------- 新闻 ---------- */
let newsTab = 'delta';
document.querySelectorAll('[data-ntab]').forEach(b => b.addEventListener('click', () => {
  if(b.dataset.ntab){ newsTab = b.dataset.ntab; document.querySelectorAll('[data-ntab]').forEach(x => x.classList.toggle('active', x === b)); renderNews(); }
}));
$('news-refresh').addEventListener('click', () => { loadAll(); toast('🔄 已刷新'); });
function renderNews(){
  const list = DB.news.filter(n => n.category === newsTab).slice(0, 20);
  $('news-list').innerHTML = list.map(n => `
    <div class="news-item" onclick="window.open('${esc(n.url)}','_blank')">
      <span class="tag ${n.category === 'delta' ? 'dz' : 'ai'}">${n.category === 'delta' ? '🎖 三角洲' : '🤖 AI'}</span>
      <div><div class="t">${esc(n.title)}</div>
      <div class="m"><span>${esc(n.source || '未知来源')}</span><span>${relTime(n.published_at)}</span><span class="tag lang">${n.lang === 'en' ? 'EN' : '中文'}</span></div></div>
    </div>`).join('') || '<div class="empty">暂无新闻 · 每日 08:00 自动抓取</div>';
  $('news-meta').textContent = DB.news.length
    ? '⏱ 每日 08:00 自动更新 · 中英双语 · 最近更新 ' + relTime(DB.news[0].published_at)
    : '⏱ 每日 08:00 自动更新 · 中英双语';
}

/* ---------- 书单 / 箴言 ---------- */
function renderQuote(){
  const qs = DB.quotes;
  if(!qs.length) return;
  const d = new Date(), s = new Date(d.getFullYear(), 0, 0);
  const idx = Math.floor((d - s) / 864e5) % qs.length;
  $('q-text').textContent = '「' + qs[idx].text + '」';
  $('q-author').textContent = '—— ' + qs[idx].author;
}
function renderBooks(){
  const shelfMap = {}; DB.shelf.forEach(x => shelfMap[x.book_id] = x);
  $('book-grid').innerHTML = DB.books.map(b => {
    const onShelf = shelfMap[b.id];
    return `<div class="book mech" data-id="${b.id}">
      <div class="cover" style="background:${esc(b.grad)}">${esc(b.emoji)}<span class="ctag">${esc(b.tag)}</span><span class="crate">${'★'.repeat(b.rate || 0)}</span></div>
      <h4>${esc(b.title)}</h4><div class="au">${esc(b.author)}</div>
      <div class="why">${esc(b.why)}</div>
      <div class="go"><button data-act="read">${b.chapters ? '📖 开始阅读' : '👍 想读'}</button>
      ${onShelf ? `<button data-act="shelf" style="border-color:rgba(0,245,255,.5);color:var(--cyan)">${esc(onShelf.status)}</button>` : ''}
      <button data-act="add">+ 书架</button></div></div>`;
  }).join('') || '<div class="empty">加载中…</div>';
  $('book-grid').querySelectorAll('.book').forEach(card => {
    const book = DB.books.find(x => x.id === card.dataset.id);
    card.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const act = btn.dataset.act;
        if(act === 'read' && book.chapters){ openReader(book); }
        else if(act === 'add'){
          await sb.from('shelf').upsert({ user_id: USER.id, book_id: book.id, status: '想读', progress: 0 }, { onConflict: 'user_id,book_id' });
          toast('📌 已加入书架');
          chibiReact('book-wish'); loadAll();
        } else if(act === 'shelf'){ nav('books'); }
      });
    });
  });
}
function renderShelf(){
  const bookMap = {}; DB.books.forEach(b => bookMap[b.id] = b);
  const order = { '在读':0, '想读':1, '读完':2 };
  const items = [...DB.shelf].sort((a, b) => (order[a.status] - order[b.status]));
  $('shelf-list').innerHTML = items.map(x => {
    const b = bookMap[x.book_id];
    if(!b) return '';
    return `<div class="shelf-item" data-id="${x.id}" data-book="${b.id}">
      <span class="em" style="background:${esc(b.grad)}">${esc(b.emoji)}</span>
      <div><b>${esc(b.title)}</b><small>${x.status} · ${b.chapters ? '内置可读' : '纸质/其他来源'}</small></div>
      <div class="sp"><div class="bar"><i style="width:${x.progress || 0}%"></i></div></div>
      <div class="act">
        ${b.chapters ? '<button data-st="在读">📖 读</button>' : ''}
        <button data-st="想读">想读</button><button data-st="读完">读完</button>
        <button data-del>✕</button></div></div>`;
  }).join('') || '<div class="empty">书架空空，去推荐里挑一本吧</div>';
  $('shelf-list').querySelectorAll('.shelf-item').forEach(row => {
    row.querySelectorAll('[data-st]').forEach(btn => btn.addEventListener('click', async () => {
      await sb.from('shelf').update({ status: btn.dataset.st, progress: btn.dataset.st === '读完' ? 100 : (row.querySelector('.bar i').style.width || 0) }).eq('id', row.dataset.id);
      const b = bookMap[row.dataset.book];
      if(btn.dataset.st === '在读' && b && b.chapters) openReader(b);
      toast('书架已更新'); loadAll();
    }));
    row.querySelector('[data-del]').addEventListener('click', async () => {
      await sb.from('shelf').delete().eq('id', row.dataset.id);
      toast('已移出书架'); loadAll();
    });
  });
}
document.querySelectorAll('[data-btab]').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('[data-btab]').forEach(x => x.classList.remove('active')); t.classList.add('active');
  $('btab-rec').style.display = t.dataset.btab === 'rec' ? 'block' : 'none';
  $('btab-shelf').style.display = t.dataset.btab === 'shelf' ? 'block' : 'none';
}));

/* ---------- 阅读器 ---------- */
let curBook = null, curCh = 0, fs = 16;
function openReader(b){
  curBook = b; curCh = 0;
  $('r-emo').textContent = b.emoji;
  $('r-title').textContent = b.title;
  const toc = $('r-toc'); toc.innerHTML = '';
  (b.chapters || []).forEach((c, i) => {
    const btn = document.createElement('button'); btn.textContent = c.t;
    btn.onclick = () => { curCh = i; renderCh(); };
    toc.appendChild(btn);
  });
  renderCh();
  $('reader').classList.add('show');
  chibiReact('books');
}
function renderCh(){
  const c = curBook.chapters[curCh];
  $('r-page').innerHTML = '<h2>' + esc(c.t) + '</h2>' + c.paras.map(p => '<p>' + esc(p) + '</p>').join('');
  $('r-toc').querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', i === curCh));
  $('r-prog').style.width = Math.round((curCh + 1) / curBook.chapters.length * 100) + '%';
  $('r-meta').textContent = curBook.author + ' · ' + c.t + ' · ' + (curCh + 1) + '/' + curBook.chapters.length + ' 章';
  $('r-page').scrollTop = 0;
}
$('r-close').onclick = () => $('reader').classList.remove('show');
$('r-prev').onclick = () => { if(curBook && curCh > 0){ curCh--; renderCh(); } };
$('r-next').onclick = () => { if(curBook && curCh < curBook.chapters.length - 1){ curCh++; renderCh(); } };
$('r-fs-m').onclick = () => { fs = Math.max(13, fs - 1); applyFs(); };
$('r-fs-p').onclick = () => { fs = Math.min(24, fs + 1); applyFs(); };
function applyFs(){ $('r-page').style.setProperty('--fs', fs + 'px'); $('r-fs-v').textContent = fs; }
$('r-night').onclick = function(){ this.classList.toggle('on'); $('reader').classList.toggle('night'); };

/* ---------- Q版卡芙卡 ---------- */
const chibi = $('chibi'), chibiBub = $('chibi-bubble');
const CHIBI_MSG = {
  home:['欢迎回来 ✨','今天想先做什么？','需要我推荐一本书吗？'],
  edit:['剪片的时候注意节奏哦 🎬','转场再想想？','素材记得分类！'],
  design:['这配色很有品味 ✨','字体搭配不错！','灵感收集得怎么样？'],
  news:['有新情报，快去看看吧 📡','三角洲有更新！','AI 圈今天也很热闹'],
  books:['看书啦？我推荐《鞋狗》👟','阅读要开护眼模式哦','孙子兵法 yyds！'],
  todo:['打勾勾最解压了 ☑','完成一项，奖励自己一下！'],
  'todo-done':['干得漂亮！✨','+1 完成，继续保持！','夸夸你～'],
  'book-wish':['好品味！已记下 📌','这本书值得读！'],
  idle:['需要咖啡吗？☕','拖着我走也可以哦～','双击有惊喜 ✨','卡芙卡在线陪工中…']
};
let bubTimer = null;
function chibiSay(msg){
  chibiBub.textContent = msg; chibiBub.classList.add('show');
  clearTimeout(bubTimer); bubTimer = setTimeout(() => chibiBub.classList.remove('show'), 3400);
}
function chibiReact(key){
  const arr = CHIBI_MSG[key] || CHIBI_MSG.idle;
  chibiSay(arr[Math.floor(Math.random() * arr.length)]);
}
function chibiBurst(){
  const emos = ['✨','❤️','💫','🎀','⭐'];
  for(let i = 0; i < 5; i++){
    const s = document.createElement('span'); s.className = 'part';
    s.textContent = emos[Math.floor(Math.random() * emos.length)];
    s.style.left = (30 + Math.random() * 70) + '%';
    s.style.animationDelay = (Math.random() * .3) + 's';
    document.body.appendChild(s); setTimeout(() => s.remove(), 1400);
  }
}
let chibiDrag = false, chibiMoved = false, cx0 = 0, cy0 = 0, ox0 = 0, oy0 = 0;
chibi.addEventListener('pointerdown', e => {
  chibiDrag = true; chibiMoved = false; cx0 = e.clientX; cy0 = e.clientY;
  const r = chibi.getBoundingClientRect(); ox0 = r.left; oy0 = r.top;
  chibi.setPointerCapture(e.pointerId);
});
chibi.addEventListener('pointermove', e => {
  if(!chibiDrag) return;
  const dx = e.clientX - cx0, dy = e.clientY - cy0;
  if(Math.abs(dx) + Math.abs(dy) > 6) chibiMoved = true;
  if(chibiMoved){
    chibi.style.left = Math.min(Math.max(ox0 + dx, 4), innerWidth - chibi.offsetWidth - 4) + 'px';
    chibi.style.top = Math.min(Math.max(oy0 + dy, 4), innerHeight - chibi.offsetHeight - 4) + 'px';
    chibi.style.right = 'auto'; chibi.style.bottom = 'auto';
  }
});
chibi.addEventListener('pointerup', () => {
  chibiDrag = false;
  if(!chibiMoved){
    chibi.classList.remove('jump'); void chibi.offsetWidth; chibi.classList.add('jump');
    chibiBurst(); chibiReact('idle');
  }
});
chibi.addEventListener('dblclick', () => { chibiBurst(); chibiSay('我是卡芙卡，星核猎手～🕸️'); });
chibi.addEventListener('contextmenu', e => { e.preventDefault(); chibiSay('拖着我走也可以哦～'); });
setInterval(() => { if(!chibiBub.classList.contains('show') && !chibiDrag && USER) chibiReact('idle'); }, 30000);

/* ---------- 3D 倾斜 + 视差 ---------- */
const finePtr = matchMedia('(pointer:fine)').matches && innerWidth > 1024;
const kafkaBg = document.querySelector('.kafka');
const orbs = [...document.querySelectorAll('.orb')];
if(finePtr){
  document.addEventListener('mousemove', e => {
    const nx = e.clientX / innerWidth * 2 - 1, ny = e.clientY / innerHeight * 2 - 1;
    orbs.forEach(o => { const d = +o.dataset.depth || 20; o.style.transform = 'translate(' + (nx * d).toFixed(1) + 'px,' + (ny * d * .6).toFixed(1) + 'px)'; });
    kafkaBg.style.setProperty('--px', (nx * -10).toFixed(1) + 'px');
    document.querySelectorAll('.view.active .mech').forEach(c => {
      const r = c.getBoundingClientRect();
      if(r.bottom < 0 || r.top > innerHeight) return;
      const dx = (e.clientX - (r.left + r.width / 2)) / r.width, dy = (e.clientY - (r.top + r.height / 2)) / r.height;
      c.style.transform = 'perspective(900px) rotateY(' + (dx * 6).toFixed(2) + 'deg) rotateX(' + (-dy * 6).toFixed(2) + 'deg) translateZ(4px)';
    });
  });
}

/* ---------- 每日素材 ---------- */
let matTab = 'video', matType = '';
const MAT_EMOJI = { '自然':'🌿', '城市':'🌃', '科技':'🤖', '美食':'🍜', '旅行':'✈️', '人物':'👤', '网页':'🖥', 'APP':'📱', '动效':'✨', '图标':'🔷', '品牌':'🏷', '海报':'🖼' };
function matFiltered(){
  return DB.materials.filter(m => m.category === matTab && (!matType || m.type === matType));
}
function renderMaterials(){
  const video = DB.materials.filter(m => m.category === 'video');
  const design = DB.materials.filter(m => m.category === 'design');
  $('mcnt-video').textContent = video.length;
  $('mcnt-design').textContent = design.length;
  $('mat-today').textContent = '今日 ' + (video.length + design.length) + ' 条素材';
  const types = [...new Set(DB.materials.filter(m => m.category === matTab).map(m => m.type))];
  $('mat-chips').innerHTML = '<button class="chip' + (matType === '' ? ' active' : '') + '" data-mt="">全部</button>'
    + types.map(t => `<button class="chip${matType === t ? ' active' : ''}" data-mt="${t}">${MAT_EMOJI[t] || '📦'} ${t}</button>`).join('');
  $('mat-chips').querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => { matType = b.dataset.mt; renderMaterials(); }));
  const list = matFiltered();
  $('mat-grid').innerHTML = list.length ? list.map(m => {
    const read = DB.mreadIds.has(m.id);
    return `<div class="mat-card mech${read ? '' : ' fresh'}" data-id="${m.id}">
      <div class="mt-thumb">${m.thumb ? `<img src="${esc(m.thumb)}" loading="lazy" alt="">` : `<div class="mt-ph">${MAT_EMOJI[m.type] || '📦'}</div>`}${read ? '' : '<span class="mt-new">NEW</span>'}</div>
      <div class="mt-body"><b>${esc(m.title)}</b><small>${MAT_EMOJI[m.type] || ''} ${esc(m.type)} · ${esc(m.source)} · ${relTime(m.created_at)}</small></div>
      <div class="mt-actions">
        <button class="mt-open" data-url="${esc(m.url)}">打开 ↗</button>
        <button class="mt-save">${m.category === 'video' ? '📥 收进素材库' : '💡 收进灵感'}</button>
      </div>
    </div>`;
  }).join('') : '<div class="empty">这个分类还没有素材，每天 08:00 自动刷新，稍后再来看看</div>';
  $('mat-grid').querySelectorAll('.mat-card').forEach(card => {
    card.querySelector('.mt-open').addEventListener('click', () => {
      markMatRead(card.dataset.id);
      window.open(card.querySelector('.mt-open').dataset.url, '_blank');
    });
    card.querySelector('.mt-save').addEventListener('click', async () => {
      const m = DB.materials.find(x => x.id === card.dataset.id);
      if(!m) return;
      try{
        if(m.category === 'video'){
          await sb.from('assets').insert({ name: m.title, type: '视频', storage_path: '', size_mb: 0, duration: '', url: m.url });
          toast('📥 已收进剪辑素材库');
        } else {
          await sb.from('inspirations').insert({ title: m.title, tag: m.type, url: m.url });
          toast('💡 已收进设计灵感库');
        }
        markMatRead(m.id);
        chibiReact('book-wish');
        loadAll();
      }catch(e){ toast('⚠ ' + (e.message || '收藏失败')); }
    });
  });
}
async function markMatRead(id){
  if(DB.mreadIds.has(id)) return;
  DB.mreadIds.add(id);
  try{ await sb.from('material_reads').upsert({ user_id: USER.id, material_id: id }, { onConflict: 'user_id,material_id' }); }catch(e){}
  renderMaterials();
}
document.querySelectorAll('[data-mtab]').forEach(b => b.addEventListener('click', () => {
  matTab = b.dataset.mtab; matType = '';
  document.querySelectorAll('[data-mtab]').forEach(x => x.classList.toggle('active', x === b));
  renderMaterials();
}));

/* ---------- 设置弹窗（推送 + 引导） ---------- */
async function getJWT(){
  const { data } = await sb.auth.getSession();
  return data.session ? data.session.access_token : '';
}
function openSettings(){
  $('set-serverchan').value = DB.settings.serverchan_key || '';
  $('set-feishu').value = DB.settings.feishu_webhook || '';
  $('settings-modal').classList.add('show');
}
$('settings-btn').addEventListener('click', openSettings);
$('settings-close').addEventListener('click', () => $('settings-modal').classList.remove('show'));
$('settings-modal').addEventListener('click', e => { if(e.target === $('settings-modal')) $('settings-modal').classList.remove('show'); });
$('set-save').addEventListener('click', async () => {
  const row = {
    feishu_webhook: $('set-feishu').value.trim(),
    serverchan_key: $('set-serverchan').value.trim()
  };
  const { error } = await sb.from('user_settings').upsert({ user_id: USER.id, ...row, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if(error){ toast('⚠ 保存失败：' + error.message); return; }
  DB.settings = row;
  toast('💾 推送设置已保存');
});
$('set-test').addEventListener('click', async () => {
  const btn = $('set-test'); btn.disabled = true;
  try{
    const res = await fetch('/api/notify-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + await getJWT() },
      body: JSON.stringify({})
    });
    const j = await res.json().catch(() => ({}));
    toast(j.ok ? '📤 测试消息已发送，去微信/飞书看看' : ('⚠ ' + (j.error || '发送失败')));
  }catch(e){ toast('⚠ 发送失败：' + e.message); }
  finally{ btn.disabled = false; }
});
$('set-tour').addEventListener('click', () => { $('settings-modal').classList.remove('show'); startTour(); });
$('set-ttl-save').addEventListener('click', async () => {
  try{
    await sb.rpc('admin_set_config', { cfg_key: 'invalid_email_ttl_days', cfg_value: $('set-ttl').value });
    DB.config.invalid_email_ttl_days = $('set-ttl').value;
    renderAdminPanel();
    toast('🧹 清除期限已保存（' + ($('set-ttl').options[$('set-ttl').selectedIndex].text) + '）');
  }catch(e){ toast('⚠ ' + (e.message || '保存失败')); }
});
$('set-mret-save').addEventListener('click', async () => {
  try{
    await sb.rpc('admin_set_config', { cfg_key: 'material_retention_days', cfg_value: $('set-mret').value });
    DB.config.material_retention_days = $('set-mret').value;
    toast('📦 素材保留期限已保存（' + ($('set-mret').options[$('set-mret').selectedIndex].text) + '）');
  }catch(e){ toast('⚠ ' + (e.message || '保存失败')); }
});

/* ---------- 新手引导（卡芙卡讲解） ---------- */
const TOUR_STEPS = [
  { sel: '.stats', msg: '这里是你的数据总览：今日待办、素材、灵感、情报一眼看全 📊' },
  { sel: 'edit', msg: '🎬 剪辑工作台：素材直接上传到云端（手机拍的也能传），分镜脚本随手记。' },
  { sel: 'design', msg: '🎨 设计工作台：灵感收藏、配色方案、组件登记、需求版本，UI 工作一条龙。' },
  { sel: 'materials', msg: '📦 每日素材：视频 + 设计灵感每天 08:00 自动刷新，分类型挑选，一键收进你的素材库/灵感库。' },
  { sel: 'news', msg: '📡 新闻情报：三角洲行动 + AI 前沿，每天 08:00 自动抓取，中英双语。' },
  { sel: 'books', msg: '📚 书单阅读：企业家书单 + 每日励志箴言 + 内置阅读器（孙子兵法、货殖列传可读）。' },
  { sel: 'todo', msg: '☑ 待办清单：打勾勾云端同步，手机上勾完电脑马上消失。' },
  { sel: 'chibi', msg: '我是卡芙卡～点我、拖我、双击我，陪你工作。设置里还能接微信/飞书，每天 08:00 把你的待办推到手机 💌' }
];
let tourIdx = 0;
function tourTarget(sel){
  if(sel === 'chibi') return document.getElementById('chibi');
  if(['edit','design','materials','news','books','todo','home'].includes(sel)){
    return [...document.querySelectorAll('[data-nav="' + sel + '"]')].find(el => el.offsetParent !== null) || null;
  }
  return document.querySelector(sel);
}
function tourShow(){
  const step = TOUR_STEPS[tourIdx];
  const el = tourTarget(step.sel);
  $('tour-msg').textContent = step.msg;
  $('tour-next').textContent = tourIdx === TOUR_STEPS.length - 1 ? '🚀 开始使用' : '下一步 →';
  if(el){
    const r = el.getBoundingClientRect();
    const pad = 10;
    const box = $('tour-box');
    box.style.left = Math.max(4, r.left - pad) + 'px';
    box.style.top = Math.max(4, r.top - pad) + 'px';
    box.style.width = (r.width + pad * 2) + 'px';
    box.style.height = (r.height + pad * 2) + 'px';
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } else {
    $('tour-box').style.width = '0px'; $('tour-box').style.height = '0px';
  }
  chibiSay('跟着我认识一下工作台吧～');
}
function startTour(){
  tourIdx = 0;
  $('tour-mask').classList.add('show');
  tourShow();
  localStorage.setItem('starry_tour_v1', 'done');
}
$('tour-next').addEventListener('click', () => {
  tourIdx++;
  if(tourIdx >= TOUR_STEPS.length){
    $('tour-mask').classList.remove('show');
    chibiSay('都记住啦！有问题随时双击我 ✨');
    toast('🎓 新手引导完成');
  } else tourShow();
});
$('tour-skip').addEventListener('click', () => {
  $('tour-mask').classList.remove('show');
  chibiSay('好～需要的时候点右上角 ❓ 再找我');
});
$('tour-btn').addEventListener('click', startTour);
/* 首次登录自动引导 */
if(!localStorage.getItem('starry_tour_v1')){
  window.addEventListener('load', () => setTimeout(() => { if(USER) startTour(); }, 900));
}

/* ---------- PWA / 启动 ---------- */
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
restoreSession();
