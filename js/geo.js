// 纯地理/统计函数。坐标统一为 [lng, lat]（高德原生格式）。
// 这些函数无副作用、无 DOM 依赖，可被 node:test 单测。

const R = 6371; // 地球半径 km
const toRad = (d) => (d * Math.PI) / 180;

/** 两点球面距离（km），a/b 均为 [lng, lat] */
export function haversine(a, b) {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** 轨迹总长度（km），pts 为 [[lng,lat], ...] */
export function trackLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += haversine(pts[i - 1], pts[i]);
  return s;
}

/** 平均速度 km/h */
export function avgSpeed(distanceKm, durationSec) {
  if (!durationSec) return 0;
  return (distanceKm / (durationSec / 3600));
}

/** 汇总统计：次数 / 累计里程 / 累计时长 / 最快 / 最长 */
export function aggregateStats(recs) {
  const count = recs.length;
  const totalKm = recs.reduce((a, r) => a + (r.distance || 0), 0);
  const totalSec = recs.reduce((a, r) => a + (r.durationSec || 0), 0);
  const fastest = recs.reduce((m, r) => {
    const sp = avgSpeed(r.distance || 0, r.durationSec || 0);
    return sp > (m?.speed || 0) ? { speed: sp, id: r.id, name: r.name } : m;
  }, null);
  const longest = recs.reduce(
    (m, r) => ((r.distance || 0) > (m?.distance || 0) ? r : m),
    null
  );
  return {
    count,
    totalKm: +totalKm.toFixed(1),
    totalMin: Math.round(totalSec / 60),
    totalSec,
    fastest: fastest ? { ...fastest, speed: +fastest.speed.toFixed(1) } : null,
    longest: longest ? { distance: longest.distance, name: longest.name, id: longest.id } : null,
  };
}

/** 格式化时长（秒 → "1小时2分" / "35分"） */
export function fmtDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}小时${m}分`;
  return `${m}分`;
}

/** 格式化为日期时间 */
export function fmtDateTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 路线难度自动评级（基于距离 km）。PRD §10 开放问题 */
export function rateDifficulty(distanceKm) {
  if (distanceKm == null || isNaN(distanceKm)) return '未知';
  if (distanceKm < 15) return '轻松';
  if (distanceKm < 25) return '中等';
  if (distanceKm < 40) return '进阶';
  return '挑战';
}

// ---- 实时转向导航辅助（纯函数，可 node 单测） ----

/** 沿路线累计距离（米），返回与 polyline 等长数组，cum[0]=0 */
export function routeCumDist(polyline) {
  const cum = [0];
  for (let i = 1; i < polyline.length; i++) {
    cum.push(cum[i - 1] + haversine(polyline[i - 1], polyline[i]) * 1000);
  }
  return cum;
}

/** 方位角（度，0=北，顺时针）：从 a 到 b，a/b 为 [lng,lat] */
function bearing(a, b) {
  const φ1 = toRad(a[1]);
  const φ2 = toRad(b[1]);
  const dλ = toRad(b[0] - a[0]);
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/** 把点投影到路线上，返回 { traveled(米), distToRoute(米), segIndex, proj:[lng,lat] } */
export function projectOnRoute(polyline, cum, pt) {
  let best = { traveled: 0, distToRoute: Infinity, segIndex: 0, proj: polyline[0] };
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const segLen2 = dx * dx + dy * dy;
    let t = segLen2 > 0 ? ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / segLen2 : 0;
    t = Math.max(0, Math.min(1, t));
    const proj = [a[0] + t * dx, a[1] + t * dy];
    const d = haversine(pt, proj) * 1000; // 米
    if (d < best.distToRoute) {
      const traveled = cum[i] + haversine(a, proj) * 1000;
      best = { traveled, distToRoute: d, segIndex: i, proj };
    }
  }
  return best;
}

/**
 * 从 polyline 几何提取转向点：相邻段方位角变化超阈值的顶点记为一次转向。
 * 返回 [{ index, lng, lat, dist(米，距起点), turnDeg, dir:'left'|'right', sharp }]。
 * 这是无需高德再返回的纯几何法，预设/自定义/保存的任意路线都适用。
 */
export function extractManeuvers(polyline, minTurnDeg = 22) {
  if (polyline.length < 3) return [];
  const cum = routeCumDist(polyline);
  const out = [];
  for (let i = 1; i < polyline.length - 1; i++) {
    const b1 = bearing(polyline[i - 1], polyline[i]);
    const b2 = bearing(polyline[i], polyline[i + 1]);
    let delta = b2 - b1;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    if (Math.abs(delta) >= minTurnDeg) {
      out.push({
        index: i,
        lng: polyline[i][0],
        lat: polyline[i][1],
        dist: cum[i],
        turnDeg: delta,
        dir: delta > 0 ? 'right' : 'left',
        sharp: Math.abs(delta) >= 60,
      });
    }
  }
  return out;
}
