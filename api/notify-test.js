/* ============================================================
   /api/notify-test — 设置页「测试推送」：验证 JWT 后向用户的
   微信（Server酱）/ 飞书机器人发送一条测试消息
   ============================================================ */
'use strict';
const { createClient } = require('@supabase/supabase-js');

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

module.exports = async function handler(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if(!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY){
    return res.status(500).json({ error: 'env missing' });
  }
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if(!token) return res.status(401).json({ error: 'unauthorized' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: user, error: ue } = await sb.auth.getUser(token);
  if(ue || !user) return res.status(401).json({ error: 'invalid token' });

  const { data: st } = await sb.from('user_settings').select('*').eq('user_id', user.id).maybeSingle();
  const feishu = (st && st.feishu_webhook) || '';
  const sckey = (st && st.serverchan_key) || '';
  if(!feishu && !sckey) return res.status(400).json({ error: '尚未配置推送渠道，请先保存微信/飞书设置' });

  const title = '⚡ 星穹机甲 · 测试消息';
  const desp = '推送链路已打通 ✅\n\n每天 08:00 你会在这里收到：\n· 未完成待办清单\n· 今日箴言\n· 三角洲 / AI 新闻头条';
  const results = [];
  if(feishu){
    try{ results.push('飞书:' + (await sendFeishu(feishu, title + '\n' + desp) ? 'ok' : 'fail')); }
    catch(e){ results.push('飞书:fail(' + e.message + ')'); }
  }
  if(sckey){
    try{ results.push('微信:' + (await sendServerChan(sckey, title, desp) ? 'ok' : 'fail')); }
    catch(e){ results.push('微信:fail(' + e.message + ')'); }
  }
  const ok = results.every(r => r.endsWith('ok'));
  res.status(ok ? 200 : 500).json({ ok, results });
};
