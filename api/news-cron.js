/* ============================================================
   /api/news-cron — 每日新闻抓取（Vercel Cron 每日 00:00 UTC = 08:00 北京）
   来源：三角洲（Reddit + 官网） / AI（机器之心、量子位、OpenAI、arXiv、HuggingFace）
   ============================================================ */
'use strict';
const { createClient } = require('@supabase/supabase-js');
const Parser = require('rss-parser');
const cheerio = require('cheerio');

const parser = new Parser({ timeout: 15000 });

const AI_SOURCES = [
  { url: 'https://www.jiqizhixin.com/rss',          name: '机器之心',  lang: 'zh' },
  { url: 'https://www.qbitai.com/feed',             name: '量子位',    lang: 'zh' },
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
  return items;
}

module.exports = async function handler(req, res){
  if(req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if(!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY){
    return res.status(500).json({ error: 'env missing' });
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
    const { data, error } = await sb.from('news').upsert(rows, { onConflict: 'url', ignoreDuplicates: true });
    if(error) return res.status(500).json({ error: error.message });
    added = data ? data.length : rows.length;
  }
  res.status(200).json({ ok: true, fetched: rows.length, added, at: new Date().toISOString() });
};
