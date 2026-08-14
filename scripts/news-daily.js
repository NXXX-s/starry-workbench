/* ============================================================
   scripts/news-daily.js — GitHub Actions 定时任务
   每天 08:00（北京时间，UTC 00:00）：
   1) 抓取新闻（三角洲 Reddit+官网 / AI 五大 RSS 源）写入 Supabase
   2) 向配置了推送的用户发送「今日任务提醒」
   运行：node scripts/news-daily.js
   环境变量：SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
   ============================================================ */
'use strict';
const { createClient } = require('@supabase/supabase-js');
const Parser = require('rss-parser');
const cheerio = require('cheerio');

const parser = new Parser({ timeout: 15000 });

const AI_SOURCES = [
  { url: 'https://www.jiqizhixin.com/rss',          name: '机器之心',  lang: 'zh' },
  { url: 'https://www.qbitai.com/feed',             name: '量子位',    lang: 'zh' },
  { url: 'https://www.ithome.com/rss/',             name: 'IT之家',    lang: 'zh' },
  { url: 'https://openai.com/news/rss.xml',         name: 'OpenAI 官方', lang: 'en' },
  { url: 'https://rss.arxiv.org/rss/cs.AI',         name: 'arXiv cs.AI', lang: 'en' },
  { url: 'https://huggingface.co/blog/feed.xml',    name: 'HuggingFace', lang: 'en' }
];

async function fetchRSS(src){
  try{
    const feed = await parser.parseURL(src.url);
    return (feed.items || []).slice(0, 10).map(it => ({
      title: (it.title || '').trim().slice(0, 200),
      summary: ((it.contentSnippet || it.content || '').trim().slice(0, 180)),
      url: it.link,
      source: src.name,
      lang: src.lang,
      published_at: new Date(it.isoDate || it.pubDate || Date.now()).toISOString()
    })).filter(x => x.title && x.url);
  }catch(e){ return []; }
}

/* ============================================================
   三角洲新闻源（RSS + 关键词过滤）：
   PC Gamer / IGN（英文）+ 机核（中文）+ Google News 兜底（GitHub 服务器可达）
   ============================================================ */
const DELTA_RSS = [
  { url: 'https://www.pcgamer.com/rss/', name: 'PC Gamer', lang: 'en' },
  { url: 'https://feeds.ign.com/ign/all', name: 'IGN', lang: 'en' },
  { url: 'https://www.gcores.com/rss', name: '机核', lang: 'zh' }
];
const DELTA_RE = /delta\s?force|hawk\s?ops|三角洲/i;

async function fetchDeltaRSS(){
  const results = await Promise.all(DELTA_RSS.map(async s => {
    try{
      const feed = await parser.parseURL(s.url);
      return (feed.items || [])
        .filter(it => DELTA_RE.test((it.title || '') + ' ' + (it.contentSnippet || '')))
        .slice(0, 6)
        .map(it => ({
          title: (it.title || '').trim().slice(0, 200),
          summary: ((it.contentSnippet || '').trim().slice(0, 180)),
          url: it.link,
          source: s.name,
          lang: s.lang,
          published_at: new Date(it.isoDate || it.pubDate || Date.now()).toISOString()
        }))
        .filter(x => x.title && x.url);
    }catch(e){ return []; }
  }));
  return results.flat();
}

/* Google News 聚合（GitHub Runner 可达；本地网络不通会自动跳过） */
async function fetchGoogleNews(){
  try{
    const feed = await parser.parseURL('https://news.google.com/rss/search?q=' + encodeURIComponent('三角洲行动 OR "Delta Force"') + '&hl=zh-CN&gl=CN&ceid=CN:zh-Hans');
    return (feed.items || []).filter(it => DELTA_RE.test((it.title || '') + ' ' + (it.contentSnippet || '')))
      .slice(0, 6)
      .map(it => ({
        title: (it.title || '').trim().slice(0, 200),
        summary: ((it.contentSnippet || '').trim().slice(0, 180)),
        url: it.link,
        source: 'Google 新闻',
        lang: /[\u4e00-\u9fa5]/.test(it.title || '') ? 'zh' : 'en',
        published_at: new Date(it.isoDate || it.pubDate || Date.now()).toISOString()
      }));
  }catch(e){ return []; }
}

async function fetchDelta(){
  const items = [];
  try{
    const res = await fetch('https://www.reddit.com/r/DeltaForce_Global/new.json?limit=15', {
      headers: { 'User-Agent': 'starry-deck/1.0' }
    });
    if(res.ok){
      const j = await res.json();
      (j.data.children || []).forEach(c => {
        const d = c.data || {};
        if(d.title && d.url){
          items.push({
            title: d.title.trim().slice(0, 200),
            summary: ((d.selftext || '').trim().slice(0, 180)),
            url: 'https://www.reddit.com' + (d.permalink || ''),
            source: 'Reddit r/DeltaForce_Global',
            lang: 'en',
            published_at: new Date((d.created_utc || Date.now() / 1000) * 1000).toISOString()
          });
        }
      });
    }
  }catch(e){ /* reddit 不可用则跳过 */ }
  try{
    const res = await fetch('https://www.deltaforcegame.com/', { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if(res.ok){
      const html = await res.text();
      const $ = cheerio.load(html);
      const seen = new Set();
      $('a').each((_, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().trim();
        if(!href || !text || text.length < 12 || text.length > 120) return;
        if(seen.has(text) || items.length >= 6) return;
        seen.add(text);
        items.push({
          title: text.slice(0, 200),
          summary: '',
          url: href.startsWith('http') ? href : 'https://www.deltaforcegame.com' + href,
          source: '三角洲行动 官网',
          lang: 'en',
          published_at: new Date().toISOString()
        });
      });
    }
  }catch(e){ /* 官网不可用则跳过 */ }
  /* RSS 源（PC Gamer / IGN / 机核）+ Google News 兜底 */
  const [rssItems, googleItems] = await Promise.all([fetchDeltaRSS(), fetchGoogleNews()]);
  items.push(...rssItems, ...googleItems);
  return items;
}

/* ---------- 每日任务提醒（微信 Server酱 / 飞书） ---------- */
async function sendFeishu(webhook, text){
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg_type: 'text', content: { text } })
  });
  return res.ok;
}
async function sendServerChan(key, title, desp){
  const res = await fetch('https://sctapi.ftqq.com/' + key + '.send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ title, desp })
  });
  return res.ok;
}
async function dailyDigests(sb){
  const { data: users } = await sb
    .from('user_settings')
    .select('user_id, feishu_webhook, serverchan_key')
    .or('feishu_webhook.neq.,serverchan_key.neq.');
  if(!users || !users.length) return 0;
  const [quotes, news] = await Promise.all([
    sb.from('quotes').select('*').order('id'),
    sb.from('news').select('title, category, source').order('published_at', { ascending: false }).limit(4)
  ]);
  const qs = quotes.data || [];
  const d = new Date(), s = new Date(d.getFullYear(), 0, 0);
  const q = qs.length ? qs[Math.floor((d - s) / 864e5) % qs.length] : null;
  const dNews = (news.data || []).filter(n => n.category === 'delta').slice(0, 2);
  const aNews = (news.data || []).filter(n => n.category === 'ai').slice(0, 2);

  let notified = 0;
  for(const u of users){
    const { data: todos } = await sb.from('todos')
      .select('text, cat').eq('user_id', u.user_id).eq('done', false)
      .order('created_at').limit(8);
    const title = '⚡ 星穹机甲 · ' + (d.getMonth() + 1) + '月' + d.getDate() + '日 任务提醒';
    const lines = [
      '📋 今日待办' + (todos && todos.length ? '（' + todos.length + ' 项未完成）' : '：全部完成，太棒了！')
    ];
    (todos || []).forEach((t, i) => lines.push((i + 1) + '. [' + t.cat + '] ' + t.text));
    if(q) lines.push('', '✨ 今日箴言：「' + q.text + '」—— ' + q.author);
    if(dNews.length) lines.push('', '🎖 三角洲头条：' + dNews[0].title + '（' + dNews[0].source + '）');
    if(aNews.length) lines.push('🤖 AI 头条：' + aNews[0].title + '（' + aNews[0].source + '）');
    const desp = lines.join('\n');
    let ok = true;
    if(u.feishu_webhook){ try{ ok = (await sendFeishu(u.feishu_webhook, title + '\n\n' + desp)) && ok; }catch(e){ ok = false; } }
    if(u.serverchan_key){ try{ ok = (await sendServerChan(u.serverchan_key, title, desp)) && ok; }catch(e){ ok = false; } }
    if(ok) notified++;
  }
  return notified;
}

/* ---------- 无效邮箱生命周期处理 ----------
   规则：注册时邮箱无效 → 标记；每日提醒管理员（每天一次）；
   超过配置期限（1/7/30/180/365 天，0=永久）自动删除账号 */
async function processInvalidEmails(sb){
  const out = { flagged: 0, reminded: 0, deleted: 0 };
  try{
    const { data: cfg } = await sb.from('app_config').select('key,value');
    const map = Object.fromEntries((cfg || []).map(c => [c.key, c.value]));
    const ttl = parseInt(map.invalid_email_ttl_days || '7', 10);
    const { data: flagged } = await sb.rpc('cron_invalid_users');
    if(!flagged || !flagged.length) return out;
    const { data: admins } = await sb.from('admins').select('user_id');
    const adminIds = (admins || []).map(a => a.user_id);
    const now = Date.now();
    const today = new Date().toISOString().slice(0, 10);
    for(const u of flagged){
      const days = (now - new Date(u.flagged_at).getTime()) / 864e5;
      out.flagged++;
      if(ttl > 0 && days >= ttl){
        try{ await sb.rpc('cron_delete_user', { uid: u.user_id }); out.deleted++; }catch(e){ console.error('自动清除失败:', u.email, e.message); }
        continue;
      }
      const { data: prof } = await sb.from('profiles').select('invalid_reminded_at').eq('id', u.user_id).maybeSingle();
      const last = prof && prof.invalid_reminded_at ? new Date(prof.invalid_reminded_at).toISOString().slice(0, 10) : '';
      if(last === today) continue;   // 今天已提醒过
      const left = ttl > 0 ? Math.max(1, Math.ceil(ttl - days)) : null;
      const msg = '用户 ' + u.email + ' 的邮箱无法验证，已注册 ' + Math.floor(days) + ' 天。'
        + (left ? '距自动清除还有 ' + left + ' 天，可手动删除或延长期限。' : '已设置为永久保留，请人工处理。');
      for(const aid of adminIds){
        try{
          await sb.from('notifications').insert({ user_id: aid, title: '⚠ 无效邮箱待处理', body: msg });
          const { data: st } = await sb.from('user_settings').select('feishu_webhook,serverchan_key').eq('user_id', aid).maybeSingle();
          if(st && st.feishu_webhook){ try{ await sendFeishu(st.feishu_webhook, '⚠ 无效邮箱待处理\n\n' + msg); }catch(e){} }
          if(st && st.serverchan_key){ try{ await sendServerChan(st.serverchan_key, '⚠ 无效邮箱待处理', msg); }catch(e){} }
        }catch(e){ /* 单个管理员失败不阻断 */ }
      }
      await sb.from('profiles').update({ invalid_reminded_at: new Date().toISOString() }).eq('id', u.user_id);
      out.reminded++;
    }
  }catch(e){ console.error('无效邮箱处理失败(不阻断):', e.message); }
  return out;
}

/* ---------- 每日素材库（视频 + 设计灵感） ----------
   视频：Wikimedia Commons API（免密钥，6 类）；设计：设计媒体 RSS（4 源，关键词分型）
   缩略图下载后上传到本项目 Storage（国内可加载），过期素材自动清理 */
const VIDEO_TYPES = [
  { type: '自然', q: 'nature timelapse' },
  { type: '城市', q: 'city night' },
  { type: '科技', q: 'technology' },
  { type: '美食', q: 'food' },
  { type: '旅行', q: 'travel' },
  { type: '人物', q: 'people' }
];
const DESIGN_FEEDS = [
  { url: 'https://tympanus.net/codrops/feed/',            name: 'Codrops' },
  { url: 'https://www.smashingmagazine.com/feed/',       name: 'Smashing Magazine' },
  { url: 'https://tutorialzine.com/feed',                name: 'Tutorialzine' },
  { url: 'https://www.creativebloq.com/rss',             name: 'Creative Bloq' }
];
const DESIGN_TYPE_RE = [
  ['动效', /animat|motion|动效/i], ['图标', /icon/i], ['品牌', /brand|logo|identity|品牌/i],
  ['海报', /poster|print|海报/i], ['APP', /app|mobile|ios|android|应用|移动/i],
  ['网页', /web|website|landing|ui|ux|网页|界面/i]
];
const md5 = s => { const c = require('crypto').createHash('md5').update(s).digest('hex'); return c; };

async function fetchCommonsVideos(sb, rows){
  const out = [];
  for(const t of VIDEO_TYPES){
    try{
      const res = await fetch('https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search'
        + '&gsrsearch=' + encodeURIComponent('filetype:video ' + t.q) + '&gsrnamespace=6&gsrlimit=4'
        + '&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=640&origin=*',
        { headers: { 'User-Agent': 'starry-deck/1.0 (personal workbench)' } });
      if(!res.ok) continue;
      const j = await res.json();
      const pages = (j.query && j.query.pages) || {};
      for(const id of Object.keys(pages)){
        const pg = pages[id];
        const ii = pg.imageinfo && pg.imageinfo[0];
        if(!ii || !/^video\//.test(ii.mime || '') || !ii.thumburl) continue;
        out.push({
          category: 'video', type: t.type,
          title: (pg.title || '').replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ').slice(0, 120) || t.type + ' 素材',
          url: ii.descriptionurl, thumb: ii.thumburl, source: 'Wikimedia Commons'
        });
      }
    }catch(e){ /* 单个类型失败跳过 */ }
  }
  return out;
}

async function fetchDesignFeed(sb, rows){
  const out = [];
  for(const f of DESIGN_FEEDS){
    try{
      const feed = await parser.parseURL(f.url);
      for(const it of (feed.items || []).slice(0, 6)){
        const content = it['content:encoded'] || it.content || '';
        let thumb = it.thumbnail || '';
        if(!thumb && content){
          const $ = cheerio.load(content);
          const img = $('img').first().attr('src');
          if(img) thumb = img;
        }
        if(!thumb) thumb = null;   // 无图也收录，前端用占位卡片展示
        const text = (it.title || '') + ' ' + (it.contentSnippet || '');
        const hit = DESIGN_TYPE_RE.find(([, re]) => re.test(text));
        out.push({
          category: 'design',
          type: hit ? hit[0] : '网页',
          title: (it.title || '').trim().slice(0, 120),
          url: it.link,
          thumb,
          source: f.name
        });
      }
    }catch(e){ /* 源失败跳过 */ }
  }
  return out;
}

async function uploadThumb(sb, url, key){
  try{
    const res = await fetch(url, { headers: { 'User-Agent': 'starry-deck/1.0' } });
    if(!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const path = 'daily/' + new Date().toISOString().slice(0, 10) + '/' + md5(key) + '.jpg';
    const { error } = await sb.storage.from('assets').upload(path, new Blob([buf], { type: 'image/jpeg' }), { upsert: true, contentType: 'image/jpeg' });
    if(error) return null;
    return sb.storage.from('assets').getPublicUrl(path).data.publicUrl;
  }catch(e){ return null; }
}

async function fetchDailyMaterials(sb){
  const out = { video: 0, design: 0, deleted: 0 };
  try{
    const { data: cfg } = await sb.from('app_config').select('key,value');
    const map = Object.fromEntries((cfg || []).map(c => [c.key, c.value]));
    const retDays = parseInt(map.material_retention_days || '1', 10);

    const [vids, designs] = await Promise.all([fetchCommonsVideos(sb), fetchDesignFeed(sb)]);
    const rows = [];
    for(const m of [...vids, ...designs]){
      if(!m.url) continue;
      const thumb = m.thumb ? await uploadThumb(sb, m.thumb, m.url) : null;
      rows.push({ ...m, thumb, expires_at: retDays > 0 ? new Date(Date.now() + retDays * 864e5).toISOString() : null });
    }
    if(rows.length){
      const { error } = await sb.from('daily_materials').upsert(rows, { onConflict: 'url', ignoreDuplicates: true });
      if(!error){
        out.video = rows.filter(r => r.category === 'video').length;
        out.design = rows.filter(r => r.category === 'design').length;
      }
    }
    /* 过期清理：删行 + 删缩略图 */
    const { data: expired } = await sb.from('daily_materials').select('id,thumb').lt('expires_at', new Date().toISOString());
    for(const m of (expired || [])){
      await sb.from('daily_materials').delete().eq('id', m.id);
      if(m.thumb){
        const path = decodeURIComponent(m.thumb.split('/').slice(-2).join('/'));
        try{ await sb.storage.from('assets').remove([path]); }catch(e){}
      }
      out.deleted++;
    }
  }catch(e){ console.error('每日素材抓取失败(不阻断):', e.message); }
  return out;
}

async function main(){
  if(!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY){
    console.error('缺少环境变量 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const [ai, delta] = await Promise.all([
    Promise.all(AI_SOURCES.map(fetchRSS)),
    fetchDelta()
  ]);
  const rows = [
    ...ai.flat().map(r => ({ ...r, category: 'ai' })),
    ...delta.map(r => ({ ...r, category: 'delta' }))
  ];

  let added = 0;
  if(rows.length){
    const { error } = await sb.from('news').upsert(rows, { onConflict: 'url', ignoreDuplicates: true });
    if(error){ console.error('写入失败:', error.message); process.exit(1); }
    added = rows.length;
  }
  let notified = 0;
  try{ notified = await dailyDigests(sb); }catch(e){ console.error('提醒失败(不阻断):', e.message); }
  const inv = await processInvalidEmails(sb);
  const mats = await fetchDailyMaterials(sb);
  console.log(JSON.stringify({ ok: true, fetched: rows.length, added, notified, invalid: inv, materials: mats, at: new Date().toISOString() }));
}

main().catch(e => { console.error(e); process.exit(1); });
