// 深圳沿海骑行助手 · 主应用（移动端 PWA，零构建）
import { PRESETS, getPreset, ensurePresetRoutes } from './presets.js?v=11';
import * as db from './db.js?v=11';
import { loadAmap, createMap, drawRoute, planRiding } from './amap.js?v=11';
import { startRecording } from './gps.js?v=11';
import { initWxConfig } from './wechat.js?v=11';
import { startRouter, navigate } from './router.js?v=11';
import {
  haversine, trackLength, avgSpeed, aggregateStats, fmtDuration, fmtDateTime, rateDifficulty,
  routeCumDist, projectOnRoute, extractManeuvers,
} from './geo.js?v=11';

const app = document.getElementById('app');
const tabbar = document.getElementById('tabbar');

const TABS = [
  { path: '/', label: '规划', icon: '🗺️' },
  { path: '/record', label: '记录', icon: '🚴' },
  { path: '/history', label: '历史', icon: '📜' },
  { path: '/me', label: '我的', icon: '👤' },
];

function renderTabbar(active) {
  tabbar.innerHTML = TABS.map(
    (t) => `<a class="tab ${active === t.path ? 'active' : ''}" href="#${t.path}">
      <span class="tab-icon">${t.icon}</span><span class="tab-label">${t.label}</span></a>`
  ).join('');
}

function showMapFallback(id) {
  const el = document.getElementById(id);
  if (el)
    el.innerHTML =
      '<div class="mapfallback">⚠️ 未配置高德 Key，地图不可用。<br>请在 js/config.js 填入 AMAP_KEY 与安全密钥。<br>（GPS 记录与统计不受影响）</div>';
}

function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function activePath(seg) {
  if (seg === '' || seg === 'plan' || seg === 'preset') return '/';
  if (seg === 'record') return '/record';
  if (seg === 'history' || seg === 'replay') return '/history';
  if (seg === 'me') return '/me';
  return '/';
}

// 浏览器语音播报（TTS）。iOS 需用户手势解锁，由「开始导航」点击触发首次 speak。
function speak(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = 1.05;
    window.speechSynthesis.speak(u);
  } catch (e) {}
}

// 实时转向导航：根据当前 GPS 点更新转向条 + 语音 + 地图跟随 + 离路检测。
function updateNav(nav, AMap, map, pt, tbtEl) {
  const proj = projectOnRoute(nav.polyline, nav.cum, pt);
  try { map.setCenter(new AMap.LngLat(pt[0], pt[1])); } catch (e) {} // 地图跟随你

  const OFF = 60; // 离路阈值（米）
  if (proj.distToRoute > OFF) {
    if (tbtEl) { tbtEl.textContent = '⚠️ 已偏离路线，请返回主路'; tbtEl.className = 'tbt off'; }
    return;
  } else if (tbtEl) tbtEl.className = 'tbt';

  if (proj.traveled >= nav.total - 15) {
    if (!nav.endSpoken) { nav.endSpoken = true; speak('已到达终点'); }
    if (tbtEl) tbtEl.textContent = '🏁 即将到达终点';
    return;
  }
  const next = nav.maneuvers.find((m) => m.dist > proj.traveled + 5);
  if (!next) { if (tbtEl) tbtEl.textContent = '直行'; return; }
  const remain = Math.max(0, Math.round(next.dist - proj.traveled));
  const dir = (next.sharp ? '急' : '') + (next.dir === 'left' ? '左转' : '右转');
  if (tbtEl) tbtEl.textContent = remain <= 20 ? `即将${dir}` : `约 ${remain} 米后 ${dir}`;
  // 进入播报范围且未播过 → 语音
  if (remain <= 160 && !nav.spoken.has(next.index)) {
    nav.spoken.add(next.index);
    speak(`${remain > 30 ? '前方' + remain + '米' : '即将'}${dir}`);
  }
}

// 渲染「我的路线」列表到指定容器；点击进入路线详情。首页与规划页共用。
async function fillMyRoutes(el) {
  if (!el) return;
  const my = await db.getRoutes();
  el.innerHTML = my.length
    ? my
        .map(
          (r) => `<div class="row" data-rid="${r.id}">
            <div class="row-main" data-rid="${r.id}">
              <div class="row-name">${r.name}</div>
              <div class="row-sub">${r.distance}km · ${r.preferMode || ''}${r.loop ? ' · 环线' : ''}</div>
            </div>
            <button class="row-del" data-del="${r.id}" title="删除路线" aria-label="删除">🗑</button>
          </div>`
        )
        .join('')
    : '<p class="empty">暂无，去规划页保存路线</p>';
  el.querySelectorAll('[data-rid]').forEach((b) => {
    b.onclick = () => navigate('/route/' + b.dataset.rid);
  });
  el.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const r = (await db.getRoutes()).find((x) => x.id === b.dataset.del);
      if (!r) return;
      if (await confirmModal('确定删除路线「' + r.name + '」？此操作不可恢复。')) {
        await db.deleteRoute(r.id);
        fillMyRoutes(el);
      }
    };
  });
}

// 「我的路线」重名校验：已存在同名（不含当前记录自身）则返回 true。
async function routeNameExists(name, excludeId) {
  const all = await db.getRoutes();
  return all.some((r) => r.name === name && r.id !== excludeId);
}

// 应用内确认弹层（替代 window.confirm：移动端 webview 常禁 confirm，且 jsdom 默认返回 false）。
// 返回 Promise<boolean>，点「确定」resolve(true)、「取消」resolve(false)。
function confirmModal(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-mask';
    overlay.innerHTML = `
      <div class="modal">
        <p class="m-sub" style="margin-top:4px">${message}</p>
        <div class="modal-btns">
          <button class="ghost" id="cno">取消</button>
          <button class="primary" id="cyes">确定</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#cno').onclick = () => { overlay.remove(); resolve(false); };
    overlay.querySelector('#cyes').onclick = () => { overlay.remove(); resolve(true); };
  });
}

// 重命名「我的路线」的应用内弹层：校验非空与重名（routeNameExists），成功后 putRoute 覆盖同名 id。
// onDone 在保存成功后回调（用于重渲染当前页）。返回 Promise，用户取消则不改。
async function renameRouteModal(r, onDone) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-mask';
  overlay.innerHTML = `
    <div class="modal">
      <h3>重命名路线</h3>
      <input type="text" id="rname" value="${r.name}" maxlength="20" placeholder="路线名称">
      <div class="status" id="rStatus"></div>
      <div class="modal-btns">
        <button class="ghost" id="rcancel">取消</button>
        <button class="primary" id="rok">保存</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const input = overlay.querySelector('#rname');
  const st = overlay.querySelector('#rStatus');
  setTimeout(() => input.focus(), 0);
  overlay.querySelector('#rcancel').onclick = () => overlay.remove();
  overlay.querySelector('#rok').onclick = async () => {
    const name = input.value.trim();
    if (!name) { st.textContent = '名称不能为空'; st.className = 'status err'; return; }
    if (await routeNameExists(name, r.id)) {
      st.textContent = '已存在同名路线，请换一个'; st.className = 'status err'; return;
    }
    try {
      await db.putRoute({ ...r, name, difficulty: rateDifficulty(r.distance) });
      overlay.remove();
      if (onDone) onDone();
    } catch (err) {
      st.textContent = '保存失败：' + (err.message || err); st.className = 'status err';
    }
  };
}

// 确定性解析导航路线，消除 routeId 多态歧义：
// routeType 明确（preset/custom）时只查对应来源；为空（旧数据/旧链接）才走"先预设后我的路线"兜底。
// 返回 { id, name, polyline, type } 或 null。
async function resolveNavRoute(routeId, routeType) {
  if (!routeId) return null;
  const preset = getPreset(routeId);
  if (routeType === 'preset' && preset) {
    let pl = preset.polyline;
    try {
      const c = await db.getPresetCache(routeId);
      if (c && c.polyline && c.polyline.length > 1) pl = c.polyline;
    } catch (e) {}
    return { id: routeId, name: preset.name, polyline: pl, type: 'preset' };
  }
  if (routeType === 'custom') {
    const saved = (await db.getRoutes()).find((r) => r.id === routeId);
    if (saved && saved.polyline) return { id: routeId, name: saved.name, polyline: saved.polyline, type: 'custom' };
    return null;
  }
  // 兜底：旧数据无 routeType，沿用猜测逻辑保证兼容
  if (preset) {
    let pl = preset.polyline;
    try {
      const c = await db.getPresetCache(routeId);
      if (c && c.polyline && c.polyline.length > 1) pl = c.polyline;
    } catch (e) {}
    return { id: routeId, name: preset.name, polyline: pl, type: 'preset' };
  }
  const saved = (await db.getRoutes()).find((r) => r.id === routeId);
  if (saved && saved.polyline) return { id: routeId, name: saved.name, polyline: saved.polyline, type: 'custom' };
  return null;
}

// ---- 实时记录状态（跨渲染存活）----
const recState = {
  active: false, recorder: null, timer: null, startTs: 0,
  routeId: null, routeName: null, routeType: null, plannedPolyline: null, AMap: null, map: null, line: null,
};

function finalizeRecorder(save) {
  if (!recState.active) return null;
  const pts = recState.recorder ? recState.recorder.stop() : [];
  if (recState.timer) clearInterval(recState.timer);
  const durationSec = Math.round((Date.now() - recState.startTs) / 1000);

  // 始终生成一条记录，避免结束后数据丢失：
  // 1) GPS 采到 ≥2 个点 → 用「实际骑行轨迹」算里程（真实长度，非预设）；
  // 2) GPS 点数不足（无信号/快速结束）→ 回退规划路线显示，里程标记为估算(estimated)。
  const hasRealTrack = pts.length >= 2;
  let polyline, distance, estimated;
  if (hasRealTrack) {
    polyline = pts.map((x) => [x.lng, x.lat]);
    distance = trackLength(polyline);
    estimated = false;
  } else if (recState.plannedPolyline && recState.plannedPolyline.length > 1) {
    polyline = recState.plannedPolyline.slice();
    distance = trackLength(polyline);
    estimated = true; // 规划路线兜底，里程为估算值
  } else {
    polyline = pts.length === 1 ? [[pts[0].lng, pts[0].lat]] : [];
    distance = trackLength(polyline);
    estimated = true;
  }
  const start = polyline.length ? polyline[0] : null;
  const end = polyline.length ? polyline[polyline.length - 1] : null;

  let record = null;
  if (save && durationSec > 0) {
    record = {
      id: 'r' + Date.now(),
      routeId: recState.routeId,
      routeType: recState.routeType, // 'preset' | 'custom' | null，消除 routeId 多态歧义
      name: recState.routeName,
      polyline, // 实际 GPS 轨迹；GPS 不足时为规划路线回退
      start, // [lng,lat] 起点
      end, // [lng,lat] 终点
      distance: +distance.toFixed(2),
      estimated, // true=里程为规划估算（无有效 GPS 轨迹）
      durationSec,
      avgSpeed: +avgSpeed(distance, durationSec).toFixed(1), // km/h（基于有效轨迹）
      startedAt: recState.startTs,
      endedAt: Date.now(),
      source: 'gps',
    };
    db.putRecord(record);
  }
  Object.assign(recState, {
    active: false, recorder: null, timer: null, startTs: 0,
    routeId: null, routeName: null, routeType: null, plannedPolyline: null,
    AMap: null, map: null, line: null, nav: null,
  });
  return record;
}

// 骑行/导航结束后的结果页：明确展示本次成果与归类，再决定去历史或首页（不再无反馈直接跳走）
function renderRecordResult(rec, navRoute) {
  const routeName = (rec && rec.name) || (navRoute && navRoute.name) || '自由骑行';
  const cat = rec && rec.routeType === 'preset' ? '经典路线' : rec && rec.routeType === 'custom' ? '我的路线' : '';
  app.innerHTML = `
    <header class="topbar"><h1>骑行完成</h1><p class="sub">${routeName}</p></header>
    <div class="recpanel">
      <div class="recstat"><span class="big">${rec ? rec.distance + (rec.estimated ? ' (估算)' : '') : '0.00'}</span><span class="unit">km</span></div>
      <div class="rectime">${rec ? fmtDuration(rec.durationSec) : '0分'}</div>
      <div class="recspeed">${rec ? rec.avgSpeed : '0.0'} km/h</div>
      <p class="hint">已保存到骑行历史${cat ? '（归类：' + cat + '）' : ''}</p>
      <button class="primary big" id="toHistory">查看骑行历史</button>
      <button class="ghost" id="toHome">返回首页</button>
    </div>`;
  app.querySelector('#toHistory').onclick = () => navigate('/history');
  app.querySelector('#toHome').onclick = () => navigate('/');
}

// ============== 页面 ==============

async function renderHome() {
  app.innerHTML = `
    <header class="topbar"><h1>海岸线</h1><p class="sub">深圳沿海骑行规划</p></header>
    <div id="map" class="map"></div>
    <section class="presets">
      <h2>经典沿海路线</h2>
      <div class="cards">
        ${PRESETS.map(
          (p) => `<button class="card" data-preset="${p.id}">
            <div class="card-name">${p.name}</div>
            <div class="card-meta">${p.distance}km · ${p.difficulty}</div>
            <div class="card-desc">${p.desc}</div></button>`
        ).join('')}
      </div>
      <button class="primary big" id="toPlan">＋ 自定义规划路线</button>
    </section>
    <section class="presets">
      <h2>我的路线</h2>
      <div id="myroutes" class="list"></div>
    </section>`;
  try {
    const AMap = await loadAmap();
    const map = await createMap('map');
    // 先画兜底线，规划完成后再用真实路线替换
    const temp = [];
    PRESETS.forEach((p) => {
      // 概览：仅画路线、不画起终点标记，避免多个起点/终点杂乱
      const d = drawRoute(AMap, map, p.polyline, { color: '#34c759', weight: 3, fit: false, markers: false });
      temp.push(d.line);
    });
    map.setZoomAndCenter(11, [114.06, 22.54]);
    // 后台规划真实骑行路线并刷新地图与卡片信息（概览仍不画标记；选中某路线后进入详情页才显示起终点）
    ensurePresetRoutes(AMap)
      .then((routes) => {
        temp.forEach((o) => {
          try { map.remove(o); } catch (e) {}
        });
        PRESETS.forEach((p) => {
          const r = routes[p.id];
          const pl = r && r.polyline && r.polyline.length > 1 ? r.polyline : p.polyline;
          drawRoute(AMap, map, pl, { color: '#34c759', weight: 4, fit: false, markers: false });
          const card = app.querySelector(`[data-preset="${p.id}"]`);
          if (card && r) {
            const meta = card.querySelector('.card-meta');
            const dur = r.durationSec ? ` · 约${fmtDuration(r.durationSec)}` : '';
            meta.textContent = `${r.distance}km · ${rateDifficulty(r.distance)}${dur}`;
          }
        });
        try { map.setFitView(); } catch (e) {}
      })
      .catch(() => {});
  } catch (e) {
    showMapFallback('map');
  }
  app.querySelector('#toPlan').onclick = () => navigate('/plan');
  app.querySelectorAll('[data-preset]').forEach((b) => {
    b.onclick = () => navigate('/preset/' + b.dataset.preset);
  });
  fillMyRoutes(app.querySelector('#myroutes'));
}

async function renderPreset(id) {
  const p = getPreset(id);
  if (!p) return navigate('/');
  // 取真实规划路线（已固化缓存），失败则回退硬编码
  let route = { polyline: p.polyline, distance: p.distance, durationSec: null };
  try {
    await loadAmap();
    const cached = await db.getPresetCache(id);
    if (cached && cached.polyline && cached.polyline.length > 1) route = cached;
  } catch (e) {}
  app.innerHTML = `
    <header class="topbar"><h1>${p.name}</h1><p class="sub">${rateDifficulty(route.distance)} · 约 ${route.distance}km${route.durationSec ? ' · ' + fmtDuration(route.durationSec) : ''}</p></header>
    <div id="map" class="map"></div>
    <section class="presets">
      <p class="card-desc">${p.desc}</p>
      <button class="primary big" id="ride">开始骑行</button>
      <button class="ghost" id="save">保存为我的路线</button>
      <div class="status" id="saveStatus"></div>
      <button class="ghost" id="back">返回</button>
    </section>`;
  try {
    const AMap = await loadAmap();
    const map = await createMap('map');
    drawRoute(AMap, map, route.polyline, { color: '#34c759', fit: true });
  } catch (e) {
    showMapFallback('map');
  }
  app.querySelector('#ride').onclick = () => navigate('/record?route=' + p.id + '&type=preset');
  app.querySelector('#save').onclick = async () => {
    const st = app.querySelector('#saveStatus');
    st.textContent = '保存中…'; st.className = 'status';
    try {
      if (await routeNameExists(p.name)) {
        st.textContent = '已存在同名路线「' + p.name + '」，请先删除或改名'; st.className = 'status err';
        return;
      }
      await db.putRoute({
        id: 'rt' + Date.now(), name: p.name, polyline: route.polyline,
        distance: route.distance, durationSec: route.durationSec,
        preferMode: p.mode || 'greenway', difficulty: rateDifficulty(route.distance), createdAt: Date.now(),
      });
      st.textContent = '✓ 已保存到「我的路线」'; st.className = 'status ok';
    } catch (err) {
      st.textContent = '保存失败：' + (err.message || err); st.className = 'status err';
    }
  };
  app.querySelector('#back').onclick = () => navigate('/');
}

async function renderPlan() {
  app.innerHTML = `
    <header class="topbar"><h1>自定义规划</h1><p class="sub">点地图设起点，再点设终点</p></header>
    <div id="map" class="map"></div>
    <div class="planbar">
      <div class="mode">
        <button class="chip active" data-mode="shortest">最短</button>
        <button class="chip" data-mode="greenway">沿海·骑行道优先</button>
      </div>
      <label class="loopchk"><input type="checkbox" id="loop"> 🔁 环线（终点回起点）</label>
      <div class="planbtns">
        <button class="primary" id="go">规划</button>
        <button class="ghost" id="reset" style="width:auto;margin:0">重选</button>
      </div>
    </div>
    <div id="result" class="result"></div>
    <section class="presets"><h2>我的路线</h2><div id="myroutes" class="list"></div></section>`;

  let AMap, map, pts = [], mode = 'shortest', markers = [], loop = false, planned = false, lastRoute = null;
  try {
    AMap = await loadAmap();
    map = await createMap('map', [114.06, 22.54], 12);
  } catch (e) {
    showMapFallback('map');
    return;
  }

  // 清除上次规划画在地图上的线 + 起终点标记，避免不同模式/环线的路线叠加混乱。
  function clearRoute() {
    if (!lastRoute) return;
    try { map.remove(lastRoute.line); } catch (e) {}
    (lastRoute.marks || []).forEach((m) => { try { map.remove(m); } catch (e) {} });
    lastRoute = null;
  }

  map.on('click', (e) => {
    if (pts.length >= 2) {
      pts = [];
      markers.forEach((m) => map.remove(m));
      markers = [];
      clearRoute();
      planned = false;
    }
    const p = [e.lnglat.getLng(), e.lnglat.getLat()];
    pts.push(p);
    const m = new AMap.Marker({ position: p, title: pts.length === 1 ? '起点' : '终点' });
    map.add(m);
    markers.push(m);
    if (pts.length === 2) map.setFitView();
  });

  // 规划 + 渲染 + 绑定保存。抽取为函数，供「规划」按钮与「切模式/勾环线」共用。
  async function doPlan() {
    const res = app.querySelector('#result');
    res.innerHTML = '规划中…';
    try {
      const fwd = await planRiding(AMap, pts[0], pts[1], mode);
      let polyline = fwd.polyline, distance = fwd.distance, durationSec = fwd.durationSec;
      if (loop) {
        const back = await planRiding(AMap, pts[1], pts[0], mode);
        polyline = [...fwd.polyline, ...back.polyline];
        distance = +(fwd.distance + back.distance).toFixed(2);
        durationSec = fwd.durationSec + back.durationSec;
      }
      planned = true;
      clearRoute(); // 先清掉上一次（最短/沿海/环线）的路线，再画新的
      lastRoute = drawRoute(AMap, map, polyline, { color: '#0a84ff', fit: true });
      const modeLabel = mode === 'greenway' ? '沿海骑行道' : '最短路线';
      res.innerHTML = `
        <div class="recstat"><span class="big">${distance}</span><span class="unit">km</span></div>
        <div class="rectime">约 ${fmtDuration(durationSec)}${loop ? ' · 环线' : ''}</div>
        <div class="status" id="saveStatus"></div>
        <button class="primary big" id="saveRoute">保存路线</button>
        <button class="ghost" id="rideRoute">开始骑行（自由）</button>`;
      res.querySelector('#saveRoute').onclick = async () => {
        const st = res.querySelector('#saveStatus');
        const name = loop ? '环线·' + modeLabel : modeLabel;
        st.textContent = '保存中…'; st.className = 'status';
        try {
          if (await routeNameExists(name)) {
            st.textContent = '已存在同名路线「' + name + '」，请先删除或改名'; st.className = 'status err';
            return;
          }
          await db.putRoute({
            id: 'rt' + Date.now(), name,
            polyline, distance, durationSec,
            preferMode: mode, loop, difficulty: rateDifficulty(distance), createdAt: Date.now(),
          });
          st.textContent = '✓ 已保存到「我的路线」'; st.className = 'status ok';
        } catch (err) {
          st.textContent = '保存失败：' + (err.message || err); st.className = 'status err';
        }
      };
      res.querySelector('#rideRoute').onclick = () => navigate('/record');
    } catch (err) {
      res.innerHTML = '规划失败：' + (err.message || err);
    }
  }

  app.querySelectorAll('.chip').forEach((c) => {
    c.onclick = () => {
      app.querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
      c.classList.add('active');
      mode = c.dataset.mode;
      if (planned && pts.length === 2) doPlan(); // 切模式即重规划（先清旧线再画新线），立即可见
    };
  });
  app.querySelector('#loop').onchange = (e) => {
    loop = e.target.checked;
    if (planned && pts.length === 2) doPlan();
  };
  app.querySelector('#reset').onclick = () => {
    pts = []; // 清除起点与终点的所有坐标
    markers.forEach((m) => map.remove(m));
    markers = [];
    clearRoute(); // 清除地图上残留的规划路线
    planned = false;
    app.querySelector('#result').innerHTML = '';
  };
  app.querySelector('#go').onclick = () => {
    if (pts.length < 2) return alert('请先在地图上点选起点和终点');
    doPlan();
  };

  fillMyRoutes(app.querySelector('#myroutes'));
}

async function renderRecord(q) {
  const routeId = q.route || null;
  const routeType = q.type || null; // 明确来源：preset / custom；为空走兜底兼容旧数据
  // 解析导航路线：用 routeType 确定性定位来源，消除 routeId 多态歧义
  const navRoute = await resolveNavRoute(routeId, routeType);
  app.innerHTML = `
    <header class="topbar"><h1>${navRoute ? '导航中' : '骑行记录'}</h1>
      <p class="sub">${navRoute ? navRoute.name : '自由骑行'}</p></header>
    <div id="map" class="map small"></div>
    ${navRoute ? '<div id="tbt" class="tbt">沿路线骑行</div>' : ''}
    <div class="recpanel">
      <div class="recstat"><span class="big" id="dist">0.00</span><span class="unit">km</span></div>
      <div class="rectime" id="time">00:00</div>
      <div class="recspeed" id="speed">0.0 km/h</div>
      <button class="primary big" id="toggle">${navRoute ? '开始导航' : '开始骑行'}</button>
      <p class="hint" id="hint">${navRoute ? '点击开始，将沿此路线语音导航' : '点击开始，将请求定位权限并在骑行中记录轨迹'}</p>
    </div>`;

  let AMap = null, map = null;
  try {
    AMap = await loadAmap();
    map = await createMap('map', [114.06, 22.54], 13);
  } catch (e) {
    showMapFallback('map');
  }

  // 画规划路线（导航模式）
  if (navRoute && AMap && map) {
    drawRoute(AMap, map, navRoute.polyline, { color: '#0a84ff', fit: true });
  }

  const toggle = app.querySelector('#toggle');
  const distEl = app.querySelector('#dist');
  const timeEl = app.querySelector('#time');
  const speedEl = app.querySelector('#speed');
  const hint = app.querySelector('#hint');
  const tbtEl = navRoute ? app.querySelector('#tbt') : null;

  // 导航状态：累计距离 / 转向点 / 已播报集合
  let nav = null;
  if (navRoute) {
    const cum = routeCumDist(navRoute.polyline);
    nav = {
      polyline: navRoute.polyline,
      cum,
      maneuvers: extractManeuvers(navRoute.polyline),
      spoken: new Set(),
      endSpoken: false,
      total: cum[cum.length - 1],
    };
  }

  toggle.onclick = () => {
    if (!recState.active) {
      if (!('geolocation' in navigator)) return alert('设备不支持定位');
      hint.textContent = navRoute ? '导航中…保持屏幕亮起' : '骑行中…保持手机屏幕亮起';
      toggle.textContent = navRoute ? '结束导航' : '结束骑行';
      toggle.classList.add('recording');
      recState.active = true;
      recState.startTs = Date.now();
      recState.routeId = routeId;
      recState.routeName = navRoute ? navRoute.name : '自由骑行';
      recState.routeType = navRoute ? navRoute.type : null;
      recState.plannedPolyline = navRoute ? navRoute.polyline : null; // 兜底轨迹：GPS 点数不足时回退为规划路线
      recState.AMap = AMap;
      recState.map = map;
      recState.nav = nav;
      if (AMap && map) recState.line = new AMap.Polyline({ strokeColor: '#ff3b30', strokeWeight: 6, showDir: true });
      if (recState.line) map.add(recState.line);
      if (navRoute) speak('开始导航，' + navRoute.name);
      recState.recorder = startRecording({
        onPoint: (p, pts) => {
          const d = trackLength(pts.map((x) => [x.lng, x.lat]));
          const sec = (Date.now() - recState.startTs) / 1000;
          distEl.textContent = d.toFixed(2);
          timeEl.textContent = fmtClock(sec);
          speedEl.textContent = avgSpeed(d, sec).toFixed(1) + ' km/h';
          if (recState.line && recState.AMap) {
            const path = pts.map((x) => new recState.AMap.LngLat(x.lng, x.lat));
            recState.line.setPath(path);
            recState.map.setCenter(path[path.length - 1]);
          }
          if (nav && recState.AMap) updateNav(nav, recState.AMap, recState.map, [p.lng, p.lat], tbtEl);
        },
        onTick: (e) => {
          if (e.error) hint.textContent = '定位：' + (e.error.message || '失败');
        },
      });
      recState.timer = setInterval(() => {
        timeEl.textContent = fmtClock((Date.now() - recState.startTs) / 1000);
      }, 1000);
    } else {
      if (nav) speak('导航结束');
      const rec = finalizeRecorder(true);
      renderRecordResult(rec, navRoute);
    }
  };
}

async function renderHistory() {
  const recs = (await db.getRecords()).sort((a, b) => b.startedAt - a.startedAt);
  app.innerHTML = `
    <header class="topbar"><h1>骑行历史</h1></header>
    <div class="list">
      ${
        recs.length
          ? recs
              .map(
                (r) => `<button class="row" data-id="${r.id}">
                  <div><div class="row-name">${r.name || '骑行'}</div>
                  <div class="row-sub">${fmtDateTime(r.startedAt)} · ${r.source === 'manual' ? '手动' : 'GPS'}</div></div>
                  <div class="row-right">${r.distance}km${r.estimated ? ' ·估算' : ''}<br><span>${fmtDuration(r.durationSec)}</span></div></button>`
              )
              .join('')
          : '<p class="empty">还没有骑行记录，去记录一次吧。</p>'
      }
    </div>
    <div style="padding:0 12px"><button class="ghost" id="manual">＋ 手动补录</button></div>`;
  app.querySelectorAll('[data-id]').forEach((b) => {
    b.onclick = () => navigate('/replay/' + b.dataset.id);
  });
  app.querySelector('#manual').onclick = manualEntry;
}

async function manualEntry() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-mask';
  const opts = PRESETS.map(
    (p, i) => `<button class="opt" data-i="${i}">${p.name} · ${p.distance}km</button>`
  ).join('');
  overlay.innerHTML = `
    <div class="modal">
      <h3>手动补录</h3>
      <p class="m-sub">选择路线</p>
      <div class="opts">${opts}</div>
      <p class="m-sub">骑行时长（分钟）</p>
      <input type="number" id="mins" min="1" step="1" placeholder="例如 45" inputmode="numeric">
      <p class="m-sub">实际里程（km，默认路线长度，可按实际骑行修改）</p>
      <input type="number" id="km" min="0" step="0.1" placeholder="例如 10.5" inputmode="decimal">
      <div class="modal-btns">
        <button class="ghost" id="cancel">取消</button>
        <button class="primary" id="ok">保存</button>
      </div>
      <div class="status" id="mStatus"></div>
    </div>`;
  document.body.appendChild(overlay);
  let selIdx = -1;
  const optsEl = overlay.querySelector('.opts');
  const kmInput = overlay.querySelector('#km');
  optsEl.querySelectorAll('.opt').forEach((b) => {
    b.onclick = () => {
      optsEl.querySelectorAll('.opt').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      selIdx = parseInt(b.dataset.i, 10);
      kmInput.value = PRESETS[selIdx].distance; // 预填路线长度，用户可按实际修改
    };
  });
  overlay.querySelector('#cancel').onclick = () => overlay.remove();
  overlay.querySelector('#ok').onclick = async () => {
    const st = overlay.querySelector('#mStatus');
    if (selIdx < 0) { st.textContent = '请先选择一条路线'; st.className = 'status err'; return; }
    const m = parseFloat(overlay.querySelector('#mins').value);
    if (!m || m <= 0) { st.textContent = '请填写有效的时长（分钟）'; st.className = 'status err'; return; }
    const p = PRESETS[selIdx];
    const kmRaw = parseFloat(kmInput.value);
    const dist = kmRaw > 0 ? +kmRaw.toFixed(2) : p.distance; // 用户填写的实际里程，否则回退路线长度
    try {
      await db.putRecord({
        id: 'r' + Date.now(), routeId: p.id, routeType: 'preset', name: p.name, polyline: p.polyline,
        distance: dist, durationSec: Math.round(m * 60),
        avgSpeed: +(dist / (m / 60)).toFixed(1),
        difficulty: rateDifficulty(dist),
        startedAt: Date.now(), endedAt: Date.now() + m * 60000, source: 'manual',
      });
      overlay.remove();
      navigate('/history');
    } catch (err) {
      st.textContent = '保存失败：' + (err.message || err); st.className = 'status err';
    }
  };
}

async function renderReplay(id) {
  const rec = (await db.getRecords()).find((r) => r.id === id);
  if (!rec) return navigate('/history');
  const trackNote = rec.estimated
    ? '轨迹为规划路线（无有效 GPS，里程为估算）'
    : '实际骑行轨迹';
  app.innerHTML = `
    <header class="topbar"><h1>${rec.name || '骑行'}</h1><p class="sub">${fmtDateTime(rec.startedAt)}</p></header>
    <div id="map" class="map"></div>
    <div class="recpanel static">
      <div class="recstat"><span class="big">${rec.distance}${rec.estimated ? ' (估算)' : ''}</span><span class="unit">km</span></div>
      <div class="rectime">${fmtDuration(rec.durationSec)}</div>
      <div class="recspeed">均速 ${rec.avgSpeed} km/h</div>
      <p class="hint">${trackNote}</p>
      <button class="ghost" id="back">返回</button>
    </div>`;
  try {
    const AMap = await loadAmap();
    const map = await createMap('map');
    // 轨迹 + 起终点标记，明确展示本次骑行的路径
    drawRoute(AMap, map, rec.polyline, { color: '#ff3b30', fit: true, markers: true });
  } catch (e) {
    showMapFallback('map');
  }
  app.querySelector('#back').onclick = () => navigate('/history');
}

async function renderRoute(id) {
  const r = (await db.getRoutes()).find((x) => x.id === id);
  if (!r) return navigate('/plan');
  app.innerHTML = `
    <header class="topbar"><h1>${r.name}</h1><p class="sub">${r.distance}km · ${r.difficulty || r.preferMode || ''}</p></header>
    <div id="map" class="map"></div>
    <section class="presets">
      <button class="primary big" id="ride">开始骑行（自由）</button>
      <div class="row-btns">
        <button class="ghost" id="rename">重命名</button>
        <button class="ghost danger" id="del">删除</button>
      </div>
      <button class="ghost" id="back">返回</button>
    </section>`;
  try {
    const AMap = await loadAmap();
    const map = await createMap('map');
    drawRoute(AMap, map, r.polyline, { color: '#0a84ff', fit: true });
  } catch (e) {
    showMapFallback('map');
  }
  app.querySelector('#ride').onclick = () => navigate('/record?route=' + r.id + '&type=custom');
  app.querySelector('#back').onclick = () => navigate('/plan');
  app.querySelector('#del').onclick = async () => {
    if (await confirmModal('确定删除路线「' + r.name + '」？此操作不可恢复。')) {
      await db.deleteRoute(r.id);
      navigate('/plan');
    }
  };
  app.querySelector('#rename').onclick = () => renameRouteModal(r, () => renderRoute(id));
}

async function renderMe() {
  const recs = await db.getRecords();
  const s = aggregateStats(recs);
  app.innerHTML = `
    <header class="topbar"><h1>我的</h1></header>
    <div class="stats">
      <div class="stat"><div class="v">${s.count}</div><div class="k">骑行次数</div></div>
      <div class="stat"><div class="v">${s.totalKm}</div><div class="k">累计里程 (km)</div></div>
      <div class="stat"><div class="v">${s.totalMin}</div><div class="k">累计时长 (分)</div></div>
      <div class="stat"><div class="v">${s.fastest ? s.fastest.speed : 0}</div><div class="k">最快均速 (km/h)</div></div>
    </div>
    <div class="section-title">最长一次</div>
    <div class="list">${
      s.longest
        ? `<div class="row"><div><div class="row-name">${s.longest.name || '骑行'}</div>
           <div class="row-sub">${fmtDateTime((recs.find((r) => r.id === s.longest.id) || {}).startedAt || Date.now())}</div></div>
           <div class="row-right">${s.longest.distance}km</div></div>`
        : '<p class="empty">暂无</p>'
    }</div>
    <div class="section-title">我的路线</div>
    <div id="myroutes" class="list"></div>
    <div class="section-title">设置</div>
    <div class="list">
      <button class="ghost" id="clear">清空本地全部记录</button>
      <p class="empty" style="padding:8px 0">数据仅存于本机浏览器，清除缓存会丢失。</p>
    </div>`;
  app.querySelector('#clear').onclick = async () => {
    if (await confirmModal('确定清空全部骑行记录？此操作不可恢复。')) {
      await db.clearRecords();
      navigate('/me');
    }
  };
  fillMyRoutes(app.querySelector('#myroutes'));
}

// ============== 路由 ==============

function router() {
  const raw = (location.hash || '#/').slice(1);
  const [path, query] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const q = {};
  if (query) query.split('&').forEach((kv) => { const [k, v] = kv.split('='); q[k] = decodeURIComponent(v || ''); });
  const seg = parts[0] || '';

  if (recState.active && seg !== 'record') finalizeRecorder(true);

  renderTabbar(activePath(seg));

  switch (seg) {
    case '': return renderHome();
    case 'plan': return renderPlan();
    case 'preset': return renderPreset(parts[1]);
    case 'record': return renderRecord(q);
    case 'history': return renderHistory();
    case 'replay': return renderReplay(parts[1]);
    case 'route': return renderRoute(parts[1]);
    case 'me': return renderMe();
    default: return renderHome();
  }
}

// 注册 Service Worker（PWA 离线壳）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// 微信内自动初始化 JS-SDK 定位（普通浏览器/未配置时自动忽略，无副作用）。
initWxConfig();

startRouter(router);
