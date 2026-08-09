# 海岸线 · 深圳沿海骑行助手（MVP Demo）

移动端优先的骑行 Web App（PWA），聚焦**深圳沿海路线规划**与**骑行记录**：
- 🗺️ 经典沿海路线库（深圳湾 / 盐田 / 大鹏 / 蛇口）
- ➕ 自定义起终点骑行规划（贴海 / 最短两种偏好）
- 🚴 实时 GPS 轨迹记录（自动算里程 / 时长 / 均速）
- 📜 历史列表、统计看板、轨迹回放
- 📱 可「添加到主屏幕」作为 App 打开，数据存本机

零后端、纯静态，任意静态托管即可上线。

---

## 1. 获取高德 Key（地图 / 规划必需）

1. 注册并登录 [高德开放平台控制台](https://console.amap.com)
2. 创建应用 → 添加 Key → 类型选 **Web端 (JS API)**
3. 2021.12 之后申请的 Key 需要 **安全密钥**（同一页面获取）
4. 打开 `js/config.js`，填入：
   ```js
   export const AMAP_KEY = '你的Key';
   export const AMAP_SECURITY = '你的安全密钥';
   ```
> 不填也能跑：GPS 记录、历史、统计照常可用，只是地图与规划会提示「未配置 Key」。

---

## 2. 本地运行

```bash
# 方式一：Python（已自带）
python3 -m http.server 8080

# 方式二：Node
npm run serve
```

浏览器打开 `http://localhost:8080`。

**手机访问**：电脑与手机连同一 WiFi，手机访问 `http://<电脑局域网IP>:8080`
（Mac 可在「系统设置 → 网络」查看 IP，如 `192.168.x.x`）。

> 定位/GPS 在手机上需 HTTPS 或 localhost 才可用；用局域网 IP 的 http 时，
> iOS/Android 可能拒绝定位。最简单：用电脑 localhost 自测 UI，手机端部署到
> 支持 HTTPS 的静态托管后再用定位。或本地用 `mkcert` 起一个 https 服务。

---

## 3. 部署到静态托管（手机可长期访问）

任选其一，把整个目录拖上去即可：
- **Vercel / Netlify**：直接导入目录，自动识别为静态站点
- **腾讯云静态网站托管 / EdgeOne Pages**：上传目录
- **GitHub Pages**：推到仓库，开启 Pages

部署后记得在**高德控制台**把你的域名加到 Key 的「域名白名单」。

---

## 4. 添加到主屏幕（像 App 一样用）

- iOS Safari：分享 → 添加到主屏幕
- Android Chrome：菜单 → 安装应用

---

## 5. 目录结构

```
index.html              入口
styles/main.css         移动优先样式
js/
  config.js             高德 Key 配置（必填）
  db.js                 IndexedDB 本地存储
  geo.js                距离/统计纯函数（可单测）
  gps.js                实时 GPS 轨迹采集
  amap.js               高德加载/建图/规划
  presets.js            深圳沿海预设路线
  router.js             极简 hash 路由
  app.js                页面与交互
tests/geo.test.js       纯函数单测
sw.js / manifest.webmanifest / icon.svg   PWA
```

## 6. 测试

```bash
npm test     # node --test tests/*.test.js
```

## 7. 已知限制（MVP）

- 预设路线 polyline 为近似坐标，生产应替换为高德真实规划结果
- 「贴海」模式用中点偏移近似，精度有限
- 无云端同步、无实时转向导航（见 PRD 路线图 V1.1+）
