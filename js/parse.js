// 高德路径结果 → 统一 [lng, lat] 数组。纯函数，零浏览器依赖，便于单测。
// 高德 AMap.Riding.search 回调结构：result.routes[].rides[].path
// 坐标可能是 LngLat 对象，也可能是 [lng, lat] 数组，这里统一成 [lng, lat]。

/** 单个坐标点 → [lng, lat]；无法识别返回 null */
export function toLngLatArray(p) {
  if (!p) return null;
  if (Array.isArray(p)) return [Number(p[0]), Number(p[1])];
  if (typeof p.getLng === 'function') return [p.getLng(), p.getLat()];
  if (p.lng != null && p.lat != null) return [Number(p.lng), Number(p.lat)];
  return null;
}

/**
 * 把高德骑行方案（result.routes[0]）解析为 [lng, lat] 路径数组。
 * 优先取 routes[0].rides[].path（高德标准结构），兜底取 routes[0].path。
 */
export function routeToCoords(route) {
  const coords = [];
  if (route && Array.isArray(route.rides)) {
    for (const seg of route.rides) {
      if (!seg || !Array.isArray(seg.path)) continue;
      for (const pt of seg.path) {
        const c = toLngLatArray(pt);
        if (c) coords.push(c);
      }
    }
  }
  if (!coords.length && route && Array.isArray(route.path)) {
    for (const pt of route.path) {
      const c = toLngLatArray(pt);
      if (c) coords.push(c);
    }
  }
  return coords;
}
