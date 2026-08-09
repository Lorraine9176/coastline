# 路线规划修复与骑行道优化 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复自定义骑行规划失败、深圳湾预设路线入海的 bug，并新增"沿海·骑行道优先（山海连城骑行道）"规划选项。

**架构:** 高德 JS API 骑行规划不支持"贴海/绿道"策略，也不支持途经点。当前 `coast` 模式用"中点向南偏移 0.02°"伪造途经点，落点在海里导致规划失败。改法：新建 `corridor.js` 存放深圳沿海骑行道（山海连城/滨海骑行道）参考走廊点，`planRiding` 的 `coast/greenway` 模式从中点附近的走廊点取一个"在陆地道路上的"途经点，分两段规划，从而贴着真实骑行道走且不再失败。预设路线改用 `greenway` 模式并在规划失败时回退到"贴岸"的精确折线。

**Tech Stack:** 原生 ES Module + 高德 JS API 2.0（AMap.Riding）+ Node `--test`（纯函数单测）。Key 为 JS API 类型，无法调 REST，路线只能在浏览器端规划，最终需用户在浏览器/手机验证。

---

## 根因（Phase 1 结论）

1. **自定义规划失败**：`js/amap.js` 的 `planRiding` 在 `mode==='coast'` 时计算 `midLat - 0.02`（往南推≈2.2km）。深圳海在南侧，途经点落入深圳湾 → 高德对海里点无法规划 → reject。且自定义规划默认模式即 `coast`，故一规划就挂。
2. **深圳湾骑到海里**：因 `coast` 规划失败，`presets.js` 的 `ensurePresetRoutes` 回退到写死的 `polyline`（深圳湾那条是粗略折线，切入水体）。修好 #1 后真实规划走实际道路不再入海；但写死折线也需改成贴岸，作为离线兜底。

---

## Task 1: 新建沿海骑行道走廊 + 修复 coast 规划根因

**Files:**
- Create: `js/corridor.js`
- Modify: `js/amap.js`（`planRiding`，约 61-84 行）
- Test: `tests/corridor.test.js`

**Step 1: 写失败测试 `tests/corridor.test.js`**

```js
import { pickCorridorWaypoint, GREENWAYS } from '../js/corridor.js';

test('GREENWAYS 非空且为 [lng,lat]', () => {
  assert.ok(Array.isArray(GREENWAYS) && GREENWAYS.length > 0);
  assert.equal(GREENWAYS[0].length, 2);
});

test('中点附近取走廊点作为途经点', () => {
  const origin = [113.933, 22.480];   // 红树林
  const dest = [113.978, 22.506];     // 深圳湾口岸
  const wp = pickCorridorWaypoint(origin, dest);
  assert.ok(wp && wp.length === 2);
  // 途经点应靠近深圳湾滨海骑行道（纬度约 22.48~22.50，经度介于起终点之间）
  assert.ok(wp[1] > 22.47 && wp[1] < 22.51);
  assert.ok(wp[0] > 113.93 && wp[0] < 113.98);
});

test('内陆场景也能返回一个点（不抛错）', () => {
  const wp = pickCorridorWaypoint([114.0, 22.55], [114.1, 22.60]);
  assert.ok(wp);
});
```

**Step 2: 运行测试确认失败**

Run: `node --test tests/corridor.test.js`
Expected: FAIL（`corridor.js` 不存在）

**Step 3: 最小实现 `js/corridor.js`**

```js
// 深圳沿海骑行道走廊参考点（山海连城 / 滨海骑行道 / 海滨绿道 采样）。
// 用于 "沿海·骑行道优先" 规划：取离起终点中点最近的走廊点作途经点，分两段走真实道路。
export const GREENWAYS = [
  // 深圳湾滨海骑行道（西→东）
  [113.933, 22.480], [113.945, 22.483], [113.955, 22.487],
  [113.965, 22.492], [113.975, 22.498], [113.981, 22.505],
  // 蛇口滨海
  [113.878, 22.478], [113.895, 22.484], [113.885, 22.472], [113.865, 22.465],
  // 盐田 / 大鹏 海滨骑行道 / 绿道
  [114.215, 22.560], [114.300, 22.590], [114.320, 22.600],
  [114.360, 22.620], [114.420, 22.630], [114.510, 22.580],
  [114.525, 22.585], [114.560, 22.625],
];

// 取离 (origin,dest) 中点最近的走廊点。返回 [lng,lat] 或 null。
export function pickCorridorWaypoint(origin, destination) {
  if (!GREENWAYS.length) return null;
  const midLng = (origin[0] + destination[0]) / 2;
  const midLat = (origin[1] + destination[1]) / 2;
  let best = null, bestD = Infinity;
  for (const p of GREENWAYS) {
    const d =
      (p[0] - midLng) * (p[0] - midLng) + (p[1] - midLat) * (p[1] - midLat);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}
```

**Step 4: 修改 `js/amap.js` 的 `planRiding`**

```js
import { pickCorridorWaypoint } from './corridor.js';

export function planRiding(AMap, origin, destination, mode = 'shortest') {
  if (mode === 'coast' || mode === 'greenway') {
    const wp = pickCorridorWaypoint(origin, destination);
    // 途经点需与起终点有明显距离，否则没必要分段
    const far =
      wp &&
      (Math.abs(wp[0] - origin[0]) > 0.005 || Math.abs(wp[1] - origin[1]) > 0.005) &&
      (Math.abs(wp[0] - destination[0]) > 0.005 || Math.abs(wp[1] - destination[1]) > 0.005);
    if (far) {
      return Promise.all([searchLeg(AMap, origin, wp), searchLeg(AMap, wp, destination)]).then(
        ([a, b]) => ({
          polyline: [...a.path, ...b.path].map((ll) => [ll.lng, ll.lat]),
          distance: +((a.distance + b.distance) / 1000).toFixed(2),
          durationSec: a.time + b.time,
        })
      );
    }
  }
  return searchLeg(AMap, origin, destination).then((ride) => ({
    polyline: ride.path.map((ll) => [ll.lng, ll.lat]),
    distance: +(ride.distance / 1000).toFixed(2),
    durationSec: ride.time,
  }));
}
```

**Step 5: 运行测试确认通过**

Run: `node --test tests/corridor.test.js`
Expected: PASS

**Step 6: Commit**

```bash
git add js/corridor.js js/amap.js tests/corridor.test.js
git commit -m "fix: 用沿海骑行道走廊点替代海里途经点，修复 coast 规划失败"
```

---

## Task 2: 修复深圳湾预设入海 + 改 greenway 模式

**Files:**
- Modify: `js/presets.js`（深圳湾 preset 的 start/end/mode/polyline）

**Step 1: 改深圳湾 preset**

把起终点对齐真实滨海骑行道端点，模式改 `greenway`，写死兜底折线改为贴岸采样点（避免离线回退入海）：

```js
{
  id: 'szw',
  name: '深圳湾公园环线',
  desc: '平坦滨海绿道，红树林与海景，新手友好',
  start: [113.933, 22.480], // 红树林自然保护区（滨海骑行道西端）
  end: [113.981, 22.505],   // 深圳湾口岸（滨海骑行道东端）
  mode: 'greenway',
  distance: 13,
  polyline: [
    [113.933, 22.480], [113.945, 22.483], [113.955, 22.487],
    [113.965, 22.492], [113.975, 22.498], [113.981, 22.505],
  ],
},
```

其余 3 条预设 mode 统一改为 `greenway`（让预设走骑行道走廊）。

**Step 2: 语法检查**

Run: `node --check js/presets.js`
Expected: 无输出（通过）

---

## Task 3: 自定义规划新增"沿海·骑行道优先"选项

**Files:**
- Modify: `js/app.js`（`renderPlan` 的 chips，约 184-190 行；保存路线命名，约 244 行）

**Step 1: 改 chips 标签与模式**

```html
<div class="mode">
  <button class="chip active" data-mode="shortest">最短</button>
  <button class="chip" data-mode="greenway">沿海·骑行道优先</button>
</div>
```

默认 `mode = 'shortest'`（最短最稳，避免一进来就走走廊）；用户可选骑行道优先。

**Step 2: 保存路线命名**

```js
name: mode === 'greenway' ? '沿海骑行道' : '最短路线',
```

**Step 3: 语法检查**

Run: `node --check js/app.js`
Expected: 通过

---

## Task 4: 验证

**Step 1: 全量语法检查**

Run: `for f in js/*.js sw.js; do node --check "$f" && echo "OK $f"; done`

**Step 2: 全量单测**

Run: `node --test tests/`
Expected: 全部 PASS

**Step 3: 重启本地 8090 服务并确认可达**

Run: 重启 `python3 -m http.server 8090`（run_in_background），`curl` 首页 200。

**Step 4: 浏览器/手机验证（用户侧）**
- 自定义规划：选起终点 → 默认"最短"应成功；切"沿海·骑行道优先"也应成功（不再报规划失败）。
- 深圳湾预设：路线应贴着深圳湾岸线，不再入海。
- 注：地图与规划依赖浏览器+真实高德 JS API，需用户在手机/桌面浏览器最终确认。

---

## 风险与说明

- 高德骑行规划**不支持**真正的"绿道/风景优先"策略，本方案用"走廊途经点"近似，结果依赖高德对途经点的道路吸附，可能仍走邻近机动车道。这是 API 能力上限，已在 PRD/说明文档标注。
- `pickCorridorWaypoint` 取"离中点最近"的走廊点，若起终点远离海岸可能绕路；属已知取舍。
- 真实路线效果只能在浏览器端验证（JS API Key 限制），本计划的逻辑/单测可在 Node 端保证正确性。
