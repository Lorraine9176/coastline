// 微信 JS-SDK 签名服务（必须服务端运行，避免暴露 appSecret）。
//
// 前置：
//   1) 公众号 appId / appSecret（在公众号后台「开发 → 基本配置」获取）
//   2) 公众号后台「设置 → 公众号设置 → 功能设置 → JS接口安全域名」填你的根域名（需能放验证文件）
//   3) 本服务部署在与「JS接口安全域名」同根域的 HTTPS 地址上，并处理 CORS
//
// 运行：
//   WX_APPID=xxx WX_SECRET=yyy PORT=3000 ALLOW_ORIGIN=https://yourdomain.example.com node server/wx-sign.mjs
//
// 前端 js/wechat.js 的 WX_SIGN_ENDPOINT 填本服务的 /wx-sign 地址即可。

import http from 'node:http';
import crypto from 'node:crypto';

const APPID = process.env.WX_APPID || '';
const SECRET = process.env.WX_SECRET || '';
const PORT = Number(process.env.PORT || 3000);
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';

let tokenCache = { v: '', exp: 0 };
let ticketCache = { v: '', exp: 0 };

async function getToken() {
  const now = Date.now();
  if (tokenCache.v && now < tokenCache.exp) return tokenCache.v;
  const r = await fetch(
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${APPID}&secret=${SECRET}`
  ).then((x) => x.json());
  if (!r.access_token) throw new Error('token_fail:' + (r.errmsg || ''));
  tokenCache = { v: r.access_token, exp: now + (r.expires_in - 300) * 1000 };
  return r.access_token;
}

async function getTicket() {
  const now = Date.now();
  if (ticketCache.v && now < ticketCache.exp) return ticketCache.v;
  const token = await getToken();
  const r = await fetch(
    `https://api.weixin.qq.com/cgi-bin/ticket/getticket?access_token=${token}&type=jsapi`
  ).then((x) => x.json());
  if (!r.ticket) throw new Error('ticket_fail:' + (r.errmsg || ''));
  ticketCache = { v: r.ticket, exp: now + (r.expires_in - 300) * 1000 };
  return r.ticket;
}

function sha1(str) {
  return crypto.createHash('sha1').update(str, 'utf8').digest('hex');
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.url && req.url.startsWith('/wx-sign')) {
    try {
      const u = new URL(req.url, 'http://localhost');
      const url = u.searchParams.get('url') || '';
      const ticket = await getTicket();
      const noncestr = crypto.randomBytes(8).toString('hex');
      const timestamp = Math.floor(Date.now() / 1000);
      const raw = `jsapi_ticket=${ticket}&noncestr=${noncestr}&timestamp=${timestamp}&url=${url}`;
      const signature = sha1(raw);
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ appId: APPID, timestamp, nonceStr: noncestr, signature }));
    } catch (e) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: String(e.message || e) }));
    }
  }
  res.statusCode = 404;
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`wx-sign listening on :${PORT} (appId=${APPID || '未配置，请设 WX_APPID/WX_SECRET'})`);
});
