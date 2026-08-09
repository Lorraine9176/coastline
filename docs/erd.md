# 海岸线 · 深圳沿海骑行助手 — ERD（实体关系图）

> 用途：梳理产品已迭代多版后的数据模型，统一语言，支撑功能优化与问题排查。
> 数据层：浏览器 IndexedDB（`coastline` v2），4 个对象仓库：`routes / records / presetCache / settings`。
> 另有静态配置 `PRESETS`（代码内常量，非持久化）。
> 坐标统一 `[lng, lat]`（高德原生）；`polyline` 为 `[[lng,lat], ...]`。

---

## 1. 实体总览

```
┌─────────────┐        ┌──────────────────┐        ┌──────────────┐
│  PresetRoute │ 1 ── 1 │   PresetCache    │        │    Route     │
│  (静态配置)   │        │  (预设真实路线缓存)│        │  (我的路线)    │
└─────────────┘        └──────────────────┘        └──────┬───────┘
       ▲                                                   │ 1
       │ routeId（多态引用）                                 │
       └──────────────────────┬───────────────────────────┘
                           ┌───┴────┐
                           │ Record │ 0..*  （骑行记录）
                           └────────┘
                                │
                          settings（键值配置，弱关联）
```

## 2. 实体定义

### 2.1 PresetRoute（经典沿海路线 · 静态配置）
来源：`js/presets.js` 的 `PRESETS` 常量。**不入库**，随版本发布。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键，如 `szw`、`ytt` |
| name | string | 展示名，如「深圳湾公园环线」 |
| desc | string | 简介 |
| start | [lng,lat] | 起点坐标 |
| end | [lng,lat] | 终点坐标 |
| mode | string | 规划模式：`greenway`（沿海骑行道优先） |
| distance | number | 估算里程 km（规划失败兜底） |
| difficulty | string | 难度（`rateDifficulty`） |

### 2.2 PresetCache（预设真实路线缓存）
来源：`db.presetCache`，`_id = PresetRoute.id`。PRD §3.2：首次用高德骑行规划算出真实 `polyline` 并固化，避免每次实时算。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键 = PresetRoute.id |
| polyline | [[lng,lat]] | 真实骑行路线坐标串 |
| distance | number | 真实里程 km |
| durationSec | number | 预计骑行秒数 |

**关系**：PresetRoute `1 ── 1` PresetCache（同 id）。导航时优先取 PresetCache，缺失则回退 PresetRoute.polyline。

### 2.3 Route（我的路线 · 用户保存）
来源：`db.routes`，由预设「保存为我的路线」或自定义规划保存产生。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键，如 `rt<timestamp>` |
| name | string | 路线名（重名校验：`routeNameExists`） |
| polyline | [[lng,lat]] | 路线坐标串 |
| distance | number | 里程 km |
| durationSec | number | 预计秒数（自定义可能为 null） |
| preferMode | string | `shortest` \| `greenway` |
| loop | boolean | 是否环线（终点回起点） |
| difficulty | string | 难度 |
| createdAt | number | 创建时间戳 |

**业务规则**：
- 名称唯一（不含自身）。同名保存被拒（首页/规划页/预设页统一校验）。
- 首页与规划页共用 `fillMyRoutes` 渲染，点击进入 `/route/:id` 详情。

### 2.4 Record（骑行记录）
来源：`db.records`，每次骑行结束写入（GPS 实时或手动补录）。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键，如 `r<timestamp>` |
| routeId | string? | 关联路线主键（配合 routeType 定位来源） |
| routeType | string? | `preset` \| `custom` \| `null`，消除 routeId 多态歧义 |
| name | string | 骑行名（取自路线名，或「骑行」） |
| polyline | [[lng,lat]] | 实际轨迹（GPS 点不足时回退为规划路线，避免空轨迹） |
| start | [lng,lat]? | 起点坐标（取自轨迹首点；回退场景取规划路线首点） |
| end | [lng,lat]? | 终点坐标（取自轨迹末点；回退场景取规划路线末点） |
| distance | number | 里程 km（**实际**：GPS 采到 ≥2 点取真实轨迹长度；点不足回退规划路线时为估算值） |
| estimated | boolean | `true`=里程为规划路线估算（无有效 GPS 轨迹），历史/回放/结果页标注「(估算)」 |
| durationSec | number | 时长秒 |
| avgSpeed | number | 均速 km/h |
| startedAt | number | 开始时间戳 |
| endedAt | number | 结束时间戳 |
| source | string | `gps` \| `manual` |

**关系**：Record `0..* ── 1` Route/Preset（经 `routeId` + `routeType` 定位来源）。
> ✅ `routeId` 歧义已消除：Record 新增 `routeType`（`preset`/`custom`/`null`）。解析路线时按 `routeType` 确定性定位来源，不再"先预设后我的路线"猜测；旧数据无 `routeType` 时走兜底兼容（见 `resolveNavRoute`）。

### 2.5 Settings（设置 · 键值）
来源：`db.settings`，`{k, v}`。当前用于轻量偏好（如后续引导标记），暂无强实体关联。

## 3. 关系小结

| 关系 | 基数 | 外键 / 关联 | 备注 |
|------|------|------------|------|
| PresetRoute → PresetCache | 1:1 | `id` 同值 | 缓存命中即导航走真实路线 |
| Record → Route/Preset | 0..*:1 | `routeId`+`routeType` | 按 routeType 确定性定位，不再多态猜测 |
| Route → （导航运行时） | 运行时消费 | `polyline` | 不落库，转向点实时计算 |
| PresetCache → （导航运行时） | 运行时消费 | `polyline` | 同上 |

## 4. 功能 → 数据 映射（排查用）

| 功能 | 读写实体 | 常见排查点 |
|------|----------|-----------|
| 经典路线展示 / 规划 | 读 PresetRoute + PresetCache | 缓存为空→显示估算距离；规划失败→回退 `polyline` |
| 保存我的路线 | 写 Route（先 `routeNameExists` 校验） | 同名被拒；写入失败看 `status.err` |
| 自定义规划（最短/沿海/环线） | 临时态，保存才写 Route | 模式切换需 `doPlan`；`clearRoute` 防叠加；重选清空坐标 |
| 骑行记录（GPS/手动） | 写 Record | GPS 需定位权限；手动补录经 `manualEntry` 弹层 |
| 历史/回放 | 读 Record | `routeId` 多态解析失败→按「骑行」兜底 |
| 实时转向导航 | 运行时读 Route/PresetCache 的 `polyline` | 纯几何 `extractManeuvers` + `projectOnRoute`；语音用 `SpeechSynthesis(zh-CN)`；iOS 需手势解锁 |
| 我的（统计） | 读 Record 聚合 | `aggregateStats` 计算次数/里程/最快/最长 |

## 5. 待决 / 演进建议（非当前实现）

1. **~~Route 与 Preset 统一~~（已实施）**：Record 已新增 `routeType`（`preset`/`custom`/`null`）字段，导航入口经 URL `?type=` 透传，结合 `resolveNavRoute` 确定性解析，已消除 `routeId` 多态歧义。
2. **用户账户 / 云端同步**：当前全本地（IndexedDB），清除浏览器缓存即丢失。未来可加 `user` 实体与云同步。
3. **分段/分段难度**：长路线可按 `polyline` 切段，存 `Segment` 实体支持分段导航与难度细化。
4. **导航轨迹留存**：导航中实际轨迹已存于 Record.polyline，但未单独标记「是否沿规划路线」，可在 Record 加 `navigated` 标志。
5. **~~结束后骑行数据丢失~~（已实施）**：`finalizeRecorder` 改为「只要 `durationSec>0` 就落库」，GPS 点不足（桌面无信号/快速结束）时 `polyline` 回退为规划路线并补齐 `start`/`end`，保证起点/终点/路线/用时/时间不空缺。
6. **~~里程显示实际骑行长度~~（已实施）**：`finalizeRecorder` 优先取 GPS 真实轨迹长度（`pts>=2`）；点不足回退规划路线时置 `estimated=true`，历史/回放/结果页标注「(估算)」。手动补录新增可编辑的「实际里程」输入（默认路线长度，可按实际修改），不再强制显示预设长度。
7. **~~我的路线支持删除/重命名~~（已实施）**：`db.deleteRoute(id)` 新增；列表行与详情页均提供删除（应用内确认弹层 `confirmModal`，替代移动端被禁的 `window.confirm`）；详情页「重命名」弹层校验重名（`routeNameExists`）后 `putRoute` 覆盖同名 id。
