# 深圳沿海骑行助手 · 实现计划（Implementation Plan）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 交付一个移动端优先、零后端、可静态托管的 MVP Demo，覆盖"沿海路线规划 + 实时 GPS 骑行记录 + 历史统计"，并配套可执行的详细实现步骤。

**Architecture:** 纯静态前端（无构建步骤），单页应用用原生 JS + History 路由；地图用高德 JS API 2.0（CDN 加载，Key 走 config.js）；本地数据用浏览器 IndexedDB 直接封装（不引第三方库以零依赖）。部署时任意静态托管即可，手机浏览器直接打开。

**Tech Stack:** HTML5 / CSS3（移动优先）/ 原生 ES Module JS / 高德地图 JavaScript API 2.0 / IndexedDB / PWA（manifest + service worker）。纯函数逻辑（距离/统计）用 Node 内置 `node:test` 做单测。

---

## 目录结构（最终态）

```
/  (workspace root)
├─ index.html                 # 单页入口，挂载 #app
├─ manifest.webmanifest       # PWA 配置
├─ sw.js                      # service worker（离线缓存壳）
├─ README.md                  # 获取高德 Key + 部署说明
├─ styles/
│  └─ main.css                # 移动优先样式
├─ js/
│  ├─ config.js               # AMAP_KEY 配置（用户填）
│  ├─ db.js                   # IndexedDB 封装（routes/records/settings）
│  ├─ geo.js                  # 纯函数：haversine 距离、轨迹长度、统计聚合
│  ├─ amap.js                 # 高德加载 + 地图/路线绘制封装
│  ├─ presets.js              # 4 条深圳沿海预设路线（近似 polyline）
│  ├─ gps.js                  # 实时轨迹采集（自适应间隔）
│  ├─ router.js               # 极简 hash 路由
│  └─ app.js                  # 页面渲染（home/plan/record/history/stats/settings）
└─ tests/
   └─ geo.test.js             # node:test 单测纯函数
```

---

## Task 1: 项目骨架与配置

**Files:**
- Create: `index.html`, `styles/main.css`, `js/config.js`, `manifest.webmanifest`, `sw.js`

**Step 1: 写 index.html（移动优先入口）**
移动端 viewport，引 main.css 与高德安全密钥脚本占位，挂载 `#app`，注册 SW。

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#0a84ff" />
  <title>海岸线 · 深圳沿海骑行</title>
  <link rel="manifest" href="manifest.webmanifest" />
  <link rel="stylesheet" href="styles/main.css" />
</head>
<body>
  <div id="app"></div>
  <nav id="tabbar"></nav>
  <script type="module" src="js/app.js"></script>
</body>
</html>
```

**Step 2: 写 config.js（用户填 Key）**
```js
export const AMAP_KEY = '';        // ← 填你的高德 JS API Key
export const AMAP_SECURITY = '';   // ← 填安全密钥（2021.12 后必需）
```

**Step 3: 写 manifest + sw.js（PWA 壳）**
manifest 含 name/short_name/start_url/display=standalone/主题色/图标占位；sw.js 缓存核心静态资源，离线可开壳。

**Step 4: 提交**
```bash
git add -A && git commit -m "chore: scaffold mobile-first static shell + PWA"
```

---

## Task 2: 本地存储封装（IndexedDB）

**Files:**
- Create: `js/db.js`
- Test: `tests/db.test.js`（用 fake-indexeddb 或仅测纯函数，IDB 难单测，本任务主要保证 API 正确）

**Step 1: 实现 openDB / putRoute / getRoutes / putRecord / getRecords / getSettings / saveSettings**

```js
const DB_NAME = 'coastline', VERSION = 1;
export function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('routes'))
        db.createObjectStore('routes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('records'))
        db.createObjectStore('records', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings'))
        db.createObjectStore('settings', { keyPath: 'k' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
// putRoute / getRoutes / putRecord / getRecords / clearRecords 类似，封装事务 Promise 化
```

**Step 2: 提交**
```bash
git commit -m "feat: IndexedDB wrapper for routes/records/settings"
```

---

## Task 3: 纯函数 geo.js + 单测

**Files:**
- Create: `js/geo.js`, `tests/geo.test.js`

**Step 1: 写失败测试**
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { haversine, trackLength, aggregateStats } from '../js/geo.js';

test('haversine 北京→天津约 110km', () => {
  const d = haversine([39.90,116.40],[39.13,117.20]);
  assert.ok(Math.abs(d - 110) < 5);
});
test('trackLength 累加距离', () => {
  const len = trackLength([[22.48,113.93],[22.49,113.94],[22.50,113.95]]);
  assert.ok(len > 0 && len < 5);
});
test('aggregateStats 汇总次数/里程/时长', () => {
  const stats = aggregateStats([
    {distance:10,durationSec:3600},{distance:20,durationSec:1800}
  ]);
  assert.equal(stats.count, 2);
  assert.equal(stats.totalKm, 30);
  assert.equal(stats.totalMin, 90);
});
```

**Step 2: 跑测试确认失败**
```bash
node --test tests/
```
Expected: FAIL（模块未实现）

**Step 3: 写实现**
```js
export function haversine([lat1,lon1],[lat2,lon2]) {
  const R=6371, toR=d=>d*Math.PI/180;
  const dLat=toR(lat2-lat1), dLon=toR(lon2-lon1);
  const a=Math.sin(dLat/2)**2 + Math.cos(toR(lat1))*Math.cos(toR(lat2))*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
export function trackLength(pts){ let s=0; for(let i=1;i<pts.length;i++) s+=haversine(pts[i-1],pts[i]); return s; }
export function aggregateStats(recs){
  const count=recs.length;
  const totalKm=recs.reduce((a,r)=>a+r.distance,0);
  const totalMin=recs.reduce((a,r)=>a+r.durationSec,0)/60;
  const fastest=recs.reduce((m,r)=>r.distance/(r.durationSec/3600)>(m?.speed||0)?{speed:r.distance/(r.durationSec/3600),id:r.id}:m,null);
  const longest=recs.reduce((m,r)=>r.distance>(m?.distance||0)?r:m,null);
  return {count,totalKm:+totalKm.toFixed(1),totalMin:Math.round(totalMin),fastest,longest};
}
```

**Step 4: 跑测试确认通过**
```bash
node --test tests/
```
Expected: PASS

**Step 5: 提交**
```bash
git commit -m "feat: geo pure functions + unit tests"
```

---

## Task 4: 高德地图封装与预设路线

**Files:**
- Create: `js/amap.js`, `js/presets.js`
- Modify: `js/app.js`（首页接入）

**Step 1: presets.js 写 4 条近似沿海 polyline（深圳坐标，演示用，后续替换真实规划）**
```js
export const PRESETS = [
  { id:'szw', name:'深圳湾公园环线', distance:13, difficulty:'轻松', desc:'平坦滨海绿道，新手友好',
    polyline:[[22.481,113.935],[22.485,113.945],[22.492,113.955],[22.488,113.960],[22.481,113.935]] },
  { id:'yt', name:'盐田海滨栈道线', distance:20, difficulty:'中等', desc:'海景+隧道，风景绝佳',
    polyline:[[22.560,114.215],[22.565,114.230],[22.570,114.245],[22.575,114.255]] },
  { id:'dp', name:'大鹏较场尾–杨梅坑', distance:30, difficulty:'进阶', desc:'周末向，山海公路',
    polyline:[[22.590,114.530],[22.600,114.540],[22.610,114.550],[22.620,114.555]] },
  { id:'sk', name:'蛇口–海上世界–深圳湾', distance:18, difficulty:'中等', desc:'城市海岸线',
    polyline:[[22.480,113.880],[22.485,113.900],[22.490,113.920],[22.495,113.935]] },
];
```

**Step 2: amap.js 封装加载与绘制**
- `loadAmap()`：注入高德脚本（带安全密钥），返回 AMap 全局。
- `drawRoute(map, polyline, opts)`：画折线 + 起终点 Marker。
- `planRiding(origin, destination, mode)`：用 AMap.Riding 插件规划（需 Key）；mode='coast' 时在中点插入海岸必经点偏置。

**Step 3: 首页渲染预设卡片 + 点击看地图预览**
**Step 4: 提交**
```bash
git commit -m "feat: amap loader, preset coastal routes, map preview"
```

---

## Task 5: 自定义规划页

**Files:**
- Modify: `js/app.js`, `js/amap.js`

**Step 1: 规划页 UI（起点/终点输入 + 偏好切换 + 规划按钮）**
**Step 2: 调 planRiding，展示路线、距离、预计用时；"保存路线""开始骑行"按钮**
**Step 3: 提交**
```bash
git commit -m "feat: custom origin/destination riding plan with coast/shortest mode"
```

---

## Task 6: 实时 GPS 骑行记录

**Files:**
- Create: `js/gps.js`
- Modify: `js/app.js`

**Step 1: gps.js 实现 startRecording(onPoint)/stopRecording()**
- 请求 geolocation（enableHighAccuracy），移动时 3s 间隔、静止 10s；累积点数组；用 trackLength 算实时距离。

**Step 2: 记录页：开始→跟随地图画实时轨迹+计时+距离；结束→落库 records**
**Step 3: 手动补录兜底（填时长+选路线）**
**Step 4: 提交**
```bash
git commit -m "feat: realtime GPS ride recording + manual fallback"
```

---

## Task 7: 历史、统计、回放、设置

**Files:**
- Modify: `js/app.js`

**Step 1: 历史列表（倒序，卡片展示）**
**Step 2: 统计看板（调 aggregateStats 渲染次数/累计里程/时长/最快/最长）**
**Step 3: 轨迹回放（点记录→地图重绘 polyline）**
**Step 4: 设置（单位、清空本地记录二次确认）**
**Step 5: 提交**
```bash
git commit -m "feat: history list, stats dashboard, replay, settings"
```

---

## Task 8: 本地验证与部署说明

**Files:**
- Create: `README.md`

**Step 1: 起本地服务器自测**
```bash
cd <workspace> && python3 -m http.server 8080
```
手机同 WiFi 访问 `http://<电脑IP>:8080`，验证：预设预览、自定义规划（需 Key）、开始骑行记录、结束落库、历史/统计/回放。

**Step 2: 写 README**：如何申请高德 Key（JS API 类型 + 安全密钥）、填 config.js、部署到 Vercel/腾讯云静态/Netlify、手机"添加到主屏幕"。

**Step 3: 提交**
```bash
git commit -m "docs: README deploy + amap key setup"
```

---

## 验收标准
- [ ] 手机浏览器打开可见首页与预设路线
- [ ] 自定义规划返回路线并预览（Key 就绪后）
- [ ] 开始骑行能采集轨迹、结束生成记录
- [ ] 历史/统计/回放正常
- [ ] 纯函数单测全绿
- [ ] 可"添加到主屏幕"作为 PWA 打开
