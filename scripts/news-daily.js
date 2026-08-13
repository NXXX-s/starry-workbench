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
  console.log(JSON.stringify({ ok: true, fetched: rows.length, added, notified, at: new Date().toISOString() }));
}

main().catch(e => { console.error(e); process.exit(1); });
