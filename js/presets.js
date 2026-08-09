// 深圳沿海预设路线。
// 每条含真实起终点，运行时用高德骑行规划算出真实 polyline 并固化缓存（PRD §3.2：
// "预设 polyline 预先用高德算好并固化，避免每次实时算"）。polyline 仅作离线/规划失败兜底。
import { planRiding } from './amap.js?v=11';
import * as db from './db.js?v=11';

export const PRESETS = [
  {
    id: 'szw',
    name: '深圳湾公园环线',
    desc: '平坦滨海绿道，红树林与海景，新手友好',
    start: [113.933, 22.480], // 红树林自然保护区（滨海骑行道西端）
    end: [113.981, 22.505],   // 深圳湾口岸（滨海骑行道东端）
    mode: 'greenway',
    distance: 13,
    // 兜底折线：贴岸采样点，避免规划失败回退时骑进海里
    polyline: [
      [113.933, 22.480], [113.945, 22.483], [113.955, 22.487],
      [113.965, 22.492], [113.975, 22.498], [113.981, 22.505],
    ],
  },
  {
    id: 'yt',
    name: '盐田海滨栈道线',
    desc: '海景 + 海滨栈道 + 隧道，风景绝佳',
    start: [114.215, 22.560], // 盐田海鲜街
    end: [114.300, 22.590],   // 大梅沙
    mode: 'greenway',
    distance: 20,
    polyline: [
      [114.215, 22.560],
      [114.230, 22.565],
      [114.245, 22.570],
      [114.255, 22.575],
      [114.300, 22.590],
    ],
  },
  {
    id: 'dp',
    name: '大鹏较场尾–杨梅坑',
    desc: '周末向，山海公路，最美海岸段',
    start: [114.525, 22.585], // 较场尾
    end: [114.560, 22.625],   // 杨梅坑
    mode: 'greenway',
    distance: 30,
    polyline: [
      [114.525, 22.585],
      [114.535, 22.600],
      [114.545, 22.610],
      [114.555, 22.620],
      [114.560, 22.625],
    ],
  },
  {
    id: 'sk',
    name: '蛇口–海上世界–深圳湾',
    desc: '城市海岸线，串联多个地标',
    start: [113.878, 22.478], // 蛇口邮轮中心
    end: [113.945, 22.495],   // 深圳湾体育中心
    mode: 'greenway',
    distance: 18,
    polyline: [
      [113.878, 22.478],
      [113.895, 22.484],
      [113.905, 22.485],
      [113.920, 22.490],
      [113.945, 22.495],
    ],
  },
];

export function getPreset(id) {
  return PRESETS.find((p) => p.id === id) || null;
}

// 规划并缓存全部预设路线；已缓存且版本匹配则直接返回。任一条失败回退到硬编码 polyline。
// PRESET_CACHE_V 变更后会强制重新规划（清掉旧缓存）。
// 返回 { [id]: { id, polyline, distance, durationSec } }
const PRESET_CACHE_V = 3;
export async function ensurePresetRoutes(AMap) {
  const out = {};
  await Promise.all(
    PRESETS.map(async (p) => {
      try {
        const cached = await db.getPresetCache(p.id);
        if (cached && cached.v === PRESET_CACHE_V && cached.polyline && cached.polyline.length > 1) {
          out[p.id] = cached;
          return;
        }
        const r = await planRiding(AMap, p.start, p.end, p.mode || 'coast');
        const data = {
          id: p.id,
          v: PRESET_CACHE_V,
          polyline: r.polyline,
          distance: r.distance,
          durationSec: r.durationSec,
        };
        await db.putPresetCache(data);
        out[p.id] = data;
      } catch (e) {
        out[p.id] = {
          id: p.id,
          polyline: p.polyline,
          distance: p.distance,
          durationSec: null,
        };
      }
    })
  );
  return out;
}
