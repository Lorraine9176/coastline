// 极简 hash 路由：监听 location.hash，回调当前路径。
export function startRouter(onRoute) {
  const handle = () => {
    const path = (location.hash || '#/').replace(/^#/, '');
    onRoute(path || '/');
  };
  window.addEventListener('hashchange', handle);
  handle();
}

export function navigate(path) {
  const target = path.startsWith('#') ? path : '#' + path;
  // 相同 hash 不会触发 hashchange，手动派发以强制重渲染当前页
  // （例如：在「历史」页打开手动补录并保存后 navigate('/history')，需刷新列表显示新记录）
  if (location.hash === target || (target === '#/' && (location.hash === '' || location.hash === '#'))) {
    try { window.dispatchEvent(new Event('hashchange')); } catch (e) {}
  } else {
    location.hash = target;
  }
}

/** 在地图上跟随当前定位点 */
export function followPoint(AMap, map, marker, p) {
  const ll = new AMap.LngLat(p[0], p[1]);
  if (marker) marker.setPosition(ll);
  else marker = new AMap.Marker({ position: ll });
  map.setCenter(ll);
  return marker;
}
