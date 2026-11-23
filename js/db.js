// Memory Bank storage. IndexedDB holds much more than localStorage, keeps the
// original files, and survives offline. Everything stays on this device.
const DB = 'lsep-memory', VER = 1;
let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const req = indexedDB.open(DB, VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
      if (!d.objectStoreNames.contains('sets')) d.createObjectStore('sets', { keyPath: 'id' });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await open();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Storage write was cancelled.'));
  });
}
export const kvGet = k => tx('kv', 'readonly', s => s.get(k));
export const kvSet = (k, v) => tx('kv', 'readwrite', s => s.put(v, k));
export const fileGet = id => tx('files', 'readonly', s => s.get(id));
export const fileSet = (id, rec) => tx('files', 'readwrite', s => s.put(rec, id));
export const fileDel = id => tx('files', 'readwrite', s => s.delete(id));
export const setPut = rec => tx('sets', 'readwrite', s => s.put(rec));
export const setDel = id => tx('sets', 'readwrite', s => s.delete(id));
export const setAll = () => tx('sets', 'readonly', s => s.getAll());
export async function persist() { try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) { /* ignore */ } return false; }
