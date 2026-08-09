// ===== 高德地图配置（用户必填）=====
// 1) 去 https://console.amap.com 注册 → 创建应用 → 添加 Key（类型：Web端(JS API)）
// 2) 2021.12 之后申请的 Key 需要「安全密钥」，在控制台「应用管理」里获取
// 3) 把下面两个值填上，保存即可。不填则地图/规划功能不可用，但 GPS 记录与统计仍可用。
export const AMAP_KEY = '11b002e994121292d3d797a7206a9078';
export const AMAP_SECURITY = 'd7368530efa449ad378558ffc237ded8';

// 默认地图中心点：深圳市（用于首页底图）
export const DEFAULT_CENTER = [114.06, 22.54];
export const DEFAULT_ZOOM = 11;
