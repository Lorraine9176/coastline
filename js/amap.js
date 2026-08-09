// 高德地图封装：加载、建图、绘线、骑行规划。
// 坐标内部统一 [lng, lat]，与高德原生一致。
import { AMAP_KEY, AMAP_SECURITY, DEFAULT_CENTER, DEFAULT_ZOOM } from './config.js?v=11';
import { pickCorridorWaypoint } from './corridor.js?v=11';
import { routeToCoords } from './parse.js?v=11';

let _promise = null;

/** 动态加载高德 JS API。未配置 Key 时 reject('NO_KEY')。 */
export function loadAmap() {
  if (_promise) return _promise;
  if (!AMAP_KEY) return Promise.reject(new Error('NO_KEY'));
  window._AMapSecurityConfig = { securityJsCode: AMAP_SECURITY };
  _promise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://webapi.amap.com/maps?v=2.0&key=${AMAP_KEY}&plugin=AMap.Riding,AMap.Scale,AMap.ToolBar`;
    s.onload = () => resolve(window.AMap);
    s.onerror = () => reject(new Error('LOAD_FAIL'));
    document.head.appendChild(s);
  });
  return _promise;
}

/** 创建地图实例 */
export function createMap(container, center = DEFAULT_CENTER, zoom = DEFAULT_ZOOM) {
  return loadAmap().then((AMap) => new AMap.Map(container, { zoom, center, viewMode: '2D' }));
}

/** 在地图上绘制路线 + 起终点标记。markers=false 时不画起终点标记（用于概览，避免杂乱） */
export function drawRoute(AMap, map, polyline, { color = '#0a84ff', weight = 6, fit = true, markers = true } = {}) {
  const path = polyline.map((p) => new AMap.LngLat(p[0], p[1]));
  const line = new AMap.Polyline({
    path,
    strokeColor: color,
    strokeWeight: weight,
    strokeOpacity: 0.9,
    showDir: true,
    lineJoin: 'round',
  });
  map.add(line);
  const marks = [];
  if (markers && polyline.length) {
    const start = new AMap.Marker({ position: path[0], title: '起点' });
    const end = new AMap.Marker({ position: path[path.length - 1], title: '终点' });
    map.add(start);
    map.add(end);
    marks.push(start, end);
    if (fit) map.setFitView([line, ...marks]);
  } else if (fit) {
    map.setFitView([line]);
  }
  return { line, marks };
}

function searchLeg(AMap, o, d) {
  return new Promise((resolve, reject) => {
    const riding = new AMap.Riding({ hideMarkers: true });
    riding.search(o, d, (status, result) => {
      // 高德骑行规划结果结构：result.routes[].rides[].path
      if (status === 'complete' && result.routes && result.routes.length) {
        resolve(result.routes[0]);
      } else {
        const info = result && result.info ? ` (${result.info})` : '';
        reject(new Error('规划失败：' + status + info));
      }
    });
  });
}

/**
 * 骑行路径规划。
 * mode: 'shortest' 高德推荐最短；'coast'/'greenway' 近似沿海/骑行道优先
 *   （取离起终点中点最近的沿海骑行道走廊点作途经点，分两段规划，从而贴岸走真实道路）。
 * 返回 { polyline:[[lng,lat]...], distance(km), durationSec }
 */
export function planRiding(AMap, origin, destination, mode = 'shortest') {
  if (mode === 'coast' || mode === 'greenway') {
    const wp = pickCorridorWaypoint(origin, destination);
    // 始终尝试沿走廊途经点分两段规划（贴沿海骑行道），仅当与端点近乎重合才跳过。
    // 两段任一失败由 .catch 降级为单段最短，不会整体报“规划失败”。
    if (wp) {
      const coincident =
        (Math.abs(wp[0] - origin[0]) < 1e-4 && Math.abs(wp[1] - origin[1]) < 1e-4) ||
        (Math.abs(wp[0] - destination[0]) < 1e-4 && Math.abs(wp[1] - destination[1]) < 1e-4);
      if (!coincident) {
        return Promise.all([searchLeg(AMap, origin, wp), searchLeg(AMap, wp, destination)])
          .then(([a, b]) => ({
            polyline: [...routeToCoords(a), ...routeToCoords(b)],
            distance: +(((a.distance || 0) + (b.distance || 0)) / 1000).toFixed(2),
            durationSec: (a.time || 0) + (b.time || 0),
          }))
          .catch(() => singleLeg(AMap, origin, destination));
      }
    }
  }
  return singleLeg(AMap, origin, destination);
}

function singleLeg(AMap, origin, destination) {
  return searchLeg(AMap, origin, destination).then((route) => ({
    polyline: routeToCoords(route),
    distance: +((route.distance || 0) / 1000).toFixed(2),
    durationSec: route.time || 0,
  }));
}
