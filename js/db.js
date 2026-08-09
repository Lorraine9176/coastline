// IndexedDB 本地存储封装：routes / records / settings / presetCache 四个对象仓库。
const DB_NAME = 'coastline';
const VERSION = 2;

let _db = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('routes'))
        db.createObjectStore('routes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('records'))
        db.createObjectStore('records', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings'))
        db.createObjectStore('settings', { keyPath: 'k' });
      if (!db.objectStoreNames.contains('presetCache'))
        db.createObjectStore('presetCache', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      _db = req.result;
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

async function put(store, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = tx(db, store, 'readwrite').put(value);
    r.onsuccess = () => resolve(value);
    r.onerror = () => reject(r.error);
  });
}

async function getAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = tx(db, store, 'readonly').getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}

async function getOne(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = tx(db, store, 'readonly').get(key);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}

async function clear(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = tx(db, store, 'readwrite').clear();
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

// ---- Routes（我的路线）----
export const putRoute = (r) => put('routes', r);
export const getRoutes = () => getAll('routes');
export async function deleteRoute(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = tx(db, 'routes', 'readwrite').delete(id);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

// ---- Records（骑行记录）----
export const putRecord = (r) => put('records', r);
export const getRecords = () => getAll('records');
export const clearRecords = () => clear('records');

// ---- Preset route cache（高德算好的真实路线，固化缓存，PRD §3.2）----
export const putPresetCache = (r) => put('presetCache', r);
export const getPresetCache = (id) => getOne('presetCache', id);

// ---- Settings ----
export async function getSetting(k, def) {
  const db = await openDB();
  return new Promise((resolve) => {
    const r = tx(db, 'settings', 'readonly').get(k);
    r.onsuccess = () => resolve(r.result ? r.result.v : def);
    r.onerror = () => resolve(def);
  });
}
export const saveSetting = (k, v) => put('settings', { k, v });
