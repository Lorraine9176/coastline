// 实时 GPS 轨迹采集（自适应采样间隔）。
// 依赖 geo.js 的 haversine 判断是否在移动，从而动态调整采样密度：
//   移动中 3s 采样一次，近似静止 10s 一次，兼顾精度与耗电。
import { haversine } from './geo.js?v=11';
import { isWechat, wxLocationAvailable, startWxRecording } from './wechat.js?v=11';

export function startRecording({ onPoint, onTick } = {}) {
  // 微信内且 JS-SDK 已就绪时走微信定位（最稳）；否则走浏览器 geolocation（默认）。
  if (isWechat() && wxLocationAvailable()) {
    return startWxRecording({ onPoint, onTick });
  }
  let points = [];
  let timer = null;
  let interval = 3000;
  let last = null;

  const sample = () => {
    if (!('geolocation' in navigator)) {
      onTick && onTick({ error: { code: -1, message: '设备不支持定位' } });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = [pos.coords.longitude, pos.coords.latitude];
        points.push({ lng: p[0], lat: p[1], t: Date.now() });
        if (last) {
          const d = haversine(last, p); // 米级近似（返回 km，*1000 得米）
          interval = d * 1000 > 5 ? 3000 : 10000;
        }
        last = p;
        onPoint && onPoint(p, points);
        timer = setTimeout(sample, interval);
      },
      (err) => {
        onTick && onTick({ error: err });
        timer = setTimeout(sample, interval);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  };

  sample();

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
