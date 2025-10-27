// idb.jsx — IndexedDB helper for offline mode

import { openDB } from "idb";

const DB_NAME = "compdb";
const STORE = "rows";
const VERSION = 1;

async function getDB() {
  return openDB(DB_NAME, VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "rowKey" });
      }
    },
  });
}

/* make a unique rowKey for each row */
function makeKey(r, idx) {
  return (
    r?.id ??
    r?.Folio_Dpid ??
    `${r?.Company_Name || "row"}-${r?.Investor_First_Name || ""}-${r?.Investor_Last_Name || ""}-${idx}`
  );
}

/* clear all cached rows */
export async function clearAll() {
  const db = await getDB();
  const tx = db.transaction(STORE, "readwrite");
  await tx.store.clear();
  await tx.done;
}

/* insert or update rows in bulk */
export async function upsertRows(rows) {
  if (!rows?.length) return;
  const db = await getDB();
  const tx = db.transaction(STORE, "readwrite");
  for (let i = 0; i < rows.length; i++) {
    const r = { ...rows[i], rowKey: makeKey(rows[i], i) };
    tx.store.put(r);
  }
  await tx.done;
}

/* count rows with optional filters */
export async function getCountFromIDB(filters = {}) {
  const db = await getDB();
  const tx = db.transaction(STORE, "readonly");
  let count = 0;
  let cursor = await tx.store.openCursor();
  while (cursor) {
    if (rowMatches(cursor.value, filters)) count++;
    cursor = await cursor.continue();
  }
  return count;
}

/* get a page of rows from IDB */
export async function getPageFromIDB({
  page,
  pageSize,
  sortBy,
  sortDir,
  filters,
}) {
  const db = await getDB();
  const tx = db.transaction(STORE, "readonly");
  const all = [];

  let cursor = await tx.store.openCursor();
  while (cursor) {
    if (rowMatches(cursor.value, filters)) all.push(cursor.value);
    cursor = await cursor.continue();
  }

  const sorted = all.sort((a, b) => {
    const va = a?.[sortBy] ?? "";
    const vb = b?.[sortBy] ?? "";
    if (typeof va === "number" && typeof vb === "number") {
      return sortDir === "asc" ? va - vb : vb - va;
    }
    return sortDir === "asc"
      ? String(va).localeCompare(String(vb))
      : String(vb).localeCompare(String(va));
  });

  const start = (page - 1) * pageSize;
  const slice = sorted.slice(start, start + pageSize);

  return { rows: slice, totalCount: all.length };
}

/* helper: match filters */
function rowMatches(r, filters = {}) {
  for (const [k, v] of Object.entries(filters)) {
    if (!v) continue;
    const val = String(r?.[k] ?? "").toLowerCase();
    if (!val.includes(String(v).toLowerCase())) return false;
  }
  return true;
}


