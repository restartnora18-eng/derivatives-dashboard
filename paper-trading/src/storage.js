const NAME = "kimra-paper-trading-binance-v1";
function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("accounts");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function load() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction("accounts"),
      r = t.objectStore("accounts").get("active");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    t.oncomplete = () => db.close();
  });
}
export async function save(snapshot) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction("accounts", "readwrite");
    t.objectStore("accounts").put(snapshot, "active");
    t.oncomplete = () => {
      db.close();
      resolve();
    };
    t.onerror = () => {
      db.close();
      reject(t.error);
    };
  });
}
