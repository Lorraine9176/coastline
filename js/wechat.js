// 微信 JS-SDK 定位（可选增强，仅微信内 + 已配置签名服务时启用）。
//
// 何时激活：
//   1) 运行环境是微信（/MicroMessenger/ 命中 UA）；
//   2) 下方 WX_SIGN_ENDPOINT 已填写你部署的签名服务地址；
//   3) 公众号后台「JS接口安全域名」已配置为你自己的根域名（github.io 子路径无法验证，需自定义域名）。
// 任一不满足 → 本模块自动降级为浏览器 navigator.geolocation（HTTPS 下在微信内已可用，属「够用」档）。
//
// 坐标系：wx.getLocation 取 type:'gcj02'，与高德一致，无需二次转换。

// 把这里改成你部署的签名服务地址，例如 'https://yourdomain.example.com/wx-sign'
export const WX_SIGN_ENDPOINT = '';

export function isWechat() {
  return /micromessenger/i.test(navigator.userAgent);
}

let wxReady = false;
let wxScriptPromise = null;

export function loadWxJs() {
  if (window.wx) return Promise.resolve();
  if (wxScriptPromise) return wxScriptPromise;
  wxScriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://res.wx.qq.com/open/js/jweixin-1.6.0.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('wx-js-load-failed'));
    document.head.appendChild(s);
  });
  return wxScriptPromise;
}

// 初始化 wx.config。返回 Promise<boolean>：是否成功。
export async function initWxConfig() {
  if (!isWechat() || !WX_SIGN_ENDPOINT) return false;
  try {
    await loadWxJs();
    // 微信要求签名用的 url 是「当前页面 URL 去掉 # 及其后部分」（不含 query 也建议保持一致）
    const url = location.origin + location.pathname;
    const r = await fetch(`${WX_SIGN_ENDPOINT}?url=${encodeURIComponent(url)}`).then((x) => x.json());
    return await new Promise((resolve) => {
      window.wx.config({
        debug: false,
        appId: r.appId,
        timestamp: r.timestamp,
        nonceStr: r.nonceStr,
        signature: r.signature,
        jsApiList: ['getLocation'],
      });
      window.wx.ready(() => {
        wxReady = true;
        resolve(true);
      });
      window.wx.error(() => resolve(false));
    });
  } catch (e) {
    return false;
  }
}

export function wxLocationAvailable() {
  return wxReady && isWechat() && !!window.wx;
}

// 轮询式采集（微信无 watchPosition，用定时器调 wx.getLocation）。
// 复用 geo.haversine 动态调整采样间隔，逻辑与 gps.js 的浏览器路径一致。
import { haversine } from './geo.js?v=11';

export function startWxRecording({ onPoint, onTick } = {}) {
  let points = [];
  let timer = null;
  let interval = 3000;
  let last = null;

  const tick = () => {
    window.wx.getLocation({
      type: 'gcj02', // 与高德坐标系一致
      success: (res) => {
        const p = [res.longitude, res.latitude];
        points.push({ lng: p[0], lat: p[1], t: Date.now() });
        if (last) {
          const d = haversine(last, p); // km
          interval = d * 1000 > 5 ? 3000 : 10000;
        }
        last = p;
        onPoint && onPoint(p, points);
        timer = setTimeout(tick, interval);
      },
      fail: (err) => {
        onTick && onTick({ error: err });
        timer = setTimeout(tick, interval);
      },
      complete: () => {},
    });
  };

  tick();

  return {
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
      return points;
    },
    getPoints() {
      return points;
    },
  };
}
