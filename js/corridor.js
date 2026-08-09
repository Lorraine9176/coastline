// 深圳沿海骑行道走廊参考点（山海连城 / 滨海骑行道 / 海滨绿道 采样）。
// 高德骑行规划不支持"贴海/绿道"策略，也不支持途经点；本文件用于
// "沿海·骑行道优先" 模式：取离起终点中点最近的走廊点作途经点，分两段走真实道路，
// 从而贴着实际骑行道走，且途经点一定在陆地道路上（不会像旧逻辑那样落入海里）。
export const GREENWAYS = [
  // 深圳湾滨海骑行道（西→东，贴岸）
  [113.933, 22.48], [113.945, 22.483], [113.955, 22.487],
  [113.965, 22.492], [113.975, 22.498], [113.981, 22.505],
  // 蛇口滨海
  [113.878, 22.478], [113.895, 22.484], [113.885, 22.472], [113.865, 22.465],
  // 盐田 / 大鹏 海滨骑行道 / 绿道
  [114.215, 22.56], [114.3, 22.59], [114.32, 22.6],
  [114.36, 22.62], [114.42, 22.63], [114.51, 22.58],
  [114.525, 22.585], [114.56, 22.625],
];

// 取离 (origin, destination) 中点最近的走廊点。返回 [lng,lat] 或 null。
export function pickCorridorWaypoint(origin, destination) {
  if (!GREENWAYS.length) return null;
  const midLng = (origin[0] + destination[0]) / 2;
  const midLat = (origin[1] + destination[1]) / 2;
  let best = null;
  let bestD = Infinity;
  for (const p of GREENWAYS) {
    const d = (p[0] - midLng) * (p[0] - midLng) + (p[1] - midLat) * (p[1] - midLat);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
