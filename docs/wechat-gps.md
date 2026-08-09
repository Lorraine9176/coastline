# 微信内定位（JS-SDK）接入说明

目标：让「海岸线」在微信里打开时，GPS 定位最稳（走 `wx.getLocation`）。
默认情况下，站点在 HTTPS 下用浏览器 `navigator.geolocation` 也已可在微信内拿到定位（"够用"档）；
本方案是"更稳"的可选增强，需满足以下前置条件才会启用。

## 启用条件（全部满足才生效）
1. 页面在**微信**内打开（UA 含 `MicroMessenger`）。
2. 已部署签名服务，并在 `js/wechat.js` 顶部把 `WX_SIGN_ENDPOINT` 填成你的 `/wx-sign` 地址。
3. 已配置**微信公众号**（服务号/订阅号均可），拿到 `appId` / `appSecret`。
4. 公众号后台「设置 → 公众号设置 → 功能设置 → JS接口安全域名」填你**自己的根域名**，
   并按提示在该域名根目录放好验证文件 `MP_verify_xxxx.txt`。

> ⚠️ 为什么 GitHub Pages 域名用不了 JS-SDK：微信要求验证文件放在**根域名**下，
> 而 `xxx.github.io` 的根目录你控制不了（项目在子路径 `/coastline/`）。
> 因此 JS-SDK 稳定位需要你**用自己的域名**（CNAME 到 GitHub Pages 或任何其他 HTTPS 主机）。

## 部署签名服务（server/wx-sign.mjs）
必须在服务端运行，绝不能把 `appSecret` 放前端。
```bash
WX_APPID=wx1234567890abcdef \
WX_SECRET=your_appsecret \
PORT=3000 \
ALLOW_ORIGIN=https://yourdomain.example.com \
node server/wx-sign.mjs
```
- 需部署在与「JS接口安全域名」同根域的 HTTPS 地址（否则跨域 + 微信校验不通过）。
- 处理好了 CORS（`ALLOW_ORIGIN` 建议设为你的页面域名）。

## 前端改动（已完成）
- `js/wechat.js`：`isWechat / initWxConfig / wxLocationAvailable / startWxRecording`。
- `js/gps.js`：检测到微信且 JS-SDK 就绪时，走 `startWxRecording`（轮询 `wx.getLocation`，gcj02 与高德一致）；否则走浏览器 `navigator.geolocation`，逻辑不变。
- `js/app.js`：启动时调用 `initWxConfig()`（非微信/未配置时自动忽略，无副作用）。

## 降级路径（重要）
未满足上述条件时，定位自动回退为浏览器 `navigator.geolocation`：
- iOS 微信（WKWebView）+ HTTPS：一般可授权拿到位置 ✅
- Android 微信（X5）+ HTTPS：多数情况可拿到位置 ✅
- 纯局域网 HTTP（http://192.168.x.x）：iOS/Android 均拒绝定位 ❌（需 HTTPS）

所以"真测 GPS"的前提始终是 **HTTPS**；JS-SDK 只是让微信内更稳，不是绕开 HTTPS 的手段。
