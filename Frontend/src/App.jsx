import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import * as XLSX from "xlsx";
import "./App.css";
import { clearAll, upsertRows, getPageFromIDB, getCountFromIDB } from "./idb";
import AdminPanel from "./AdminPanel.jsx"; // ⬅️ NEW
import logo from "./assets/logo.png";
import hero from "./assets/hero.jpg";

/* -------- API base (LAN-friendly) -------- */
const apiBase =
  (import.meta.env && import.meta.env.VITE_API_URL) ||
  (typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : "/");
const api = axios.create({ baseURL: apiBase });


// ✅ Always send auth token if available
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("authToken");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

console.log("👉 API baseURL =", apiBase);

/* -------- Columns & config -------- */
const BASE_COLS = [
  "Investor_First_Name",
  "Investor_Middle_Name",
  "Investor_Last_Name",
  "Father_or_Husband_First Name",
  "Father_or_Husband_Middle_Name",
  "Father_or_Husband_Last_Name",
  "Address",
  "Folio_Dpid",
  "Company_Name",
  "No_of_Shares",
  "Valuation",
  "Case",
];
const DISPLAY_COLS = BASE_COLS.filter((c) => c !== "Folio_Dpid");
const FILTER_COLS = BASE_COLS.filter((c) => c !== "No_of_Shares" && c !== "Valuation");
const NUMERIC_COLS = new Set(["No_of_Shares", "Valuation"]);

/* tolerant mapping */
const COL_KEYS = {
  Investor_First_Name: ["Investor_First_Name"],
  Investor_Middle_Name: ["Investor_Middle_Name"],
  Investor_Last_Name: ["Investor_Last_Name"],
  "Father_or_Husband_First Name": ["Father_or_Husband_First Name", "Father_or_Husband_First_Name"],
  Father_or_Husband_Middle_Name: ["Father_or_Husband_Middle_Name"],
  Father_or_Husband_Last_Name: ["Father_or_Husband_Last_Name"],
  Address: ["Address"],
  Folio_Dpid: ["Folio_Dpid"],
  Company_Name: ["Company_Name"],
  No_of_Shares: ["No_of_Shares", "No_of_share", "no_of_shares", "NO_OF_SHARES"],
  Valuation: ["Valuation", "Valutation", "valuation", "valutation", "VALUATION"],
  Case: ["Case", "case", "CASE"],
};

function valueOf(row, col) {
  const keys = COL_KEYS[col] || [col];
  for (const k of keys) {
    if (row && row[k] !== undefined && row[k] !== null) return row[k];
  }
  return "";
}

function useDebouncedValue(value, delay = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return v;
}

function highlight(text, needle) {
  const t = String(text ?? "");
  const n = String(needle ?? "").trim();
  if (!n) return t;
  const parts = t.split(new RegExp(`(${n.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")})`, "ig"));
  return parts.map((p, i) => (i % 2 === 1 ? <mark className="hl" key={i}>{p}</mark> : <span key={i}>{p}</span>));
}

/* ========= Chevron TitleBar ========= */
function TitleBar({ text = "DATABASE" }) {
  return (
    <div className="titlebar">
      <span className="titlebar-line" aria-hidden="true" />
      <svg className="titlebar-badge" viewBox="0 0 240 60" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <polygon className="badge-shape" points="0,30 18,10 222,10 240,30 222,50 18,50" />
        <text x="120" y="38" textAnchor="middle" className="badge-text">{text}</text>
      </svg>
      <span className="titlebar-line" aria-hidden="true" />
    </div>
  );
}

export default function App() {
  /* ---------- Theme ---------- */
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");
  useEffect(() => {
    localStorage.setItem("theme", theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  /* ---------- Admin toggle (NEW) ---------- */
  const [showAdmin, setShowAdmin] = useState(false); // ⬅️ NEW
  const isAdmin = typeof window !== "undefined" && localStorage.getItem("role") === "admin"; // ⬅️ NEW

  /* ---------- Filters/sort/page ---------- */
  const emptyFilters = useMemo(() => FILTER_COLS.reduce((a, k) => ((a[k] = ""), a), {}), []);
  const [filters, setFilters] = useState(emptyFilters);
  const debouncedFilters = useDebouncedValue(filters, 300);
  const [sortBy, setSortBy] = useState("Company_Name");
  const [sortDir, setSortDir] = useState("asc");
  const [valuationOrder, setValuationOrder] = useState(""); // asc|desc|""

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  /* ---------- Data ---------- */
  const [rows, setRows] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [fetchProgress, setFetchProgress] = useState(0); // NEW: right-side tiny bar %
  const [error, setError] = useState("");

  /* ---------- Modal ---------- */
  const [open, setOpen] = useState(false);
  const [viewRow, setViewRow] = useState(null);
  const allKeys = useMemo(() => {
    const s = new Set();
    rows.forEach((r) => Object.keys(r || {}).forEach((k) => s.add(k)));
    return Array.from(s);
  }, [rows]);

  /* ---------- Company options ---------- */
  const [companyOptions, setCompanyOptions] = useState([]);
  useEffect(() => {
    if (!filters.Company_Name) {
      const s = new Set(companyOptions);
      rows.forEach((r) => {
        const v = String(valueOf(r, "Company_Name") ?? "").trim();
        if (v) s.add(v);
      });
      setCompanyOptions(Array.from(s).sort((a, b) => a.localeCompare(b)).slice(0, 500));
    }
    // eslint-disable-next-line
  }, [rows]);

  /* ---------- Offline + Progress ---------- */
  const [offline, setOffline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncETA, setSyncETA] = useState("");

  /* ---------- Fast revisit cache (no refetch) ---------- */
  const pageCacheRef = useRef({}); // key -> rows

  /* ---------- Load a page (server or IndexedDB) ---------- */
  useEffect(() => {
    let timerId;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError("");
        setFetchProgress(5);

        const effSortDir = valuationOrder && NUMERIC_COLS.has(sortBy) ? valuationOrder : sortDir;
        const cacheKey = `${page}-${pageSize}-${sortBy}-${effSortDir}-${JSON.stringify(debouncedFilters)}`;

        // Serve instantly from cache on revisit
        if (!offline && pageCacheRef.current[cacheKey]) {
          setRows(pageCacheRef.current[cacheKey]);
          setFetchProgress(100);
          setLoading(false);
          return;
        }

        if (offline) {
          const total = await getCountFromIDB(debouncedFilters);
          if (cancelled) return;
          setTotalCount(total);
          const { rows: pageRows } = await getPageFromIDB({
            page,
            pageSize,
            sortBy,
            sortDir: effSortDir,
            filters: debouncedFilters,
          });
          if (cancelled) return;
          setRows(pageRows);
          setFetchProgress(100);
        } else {
          const params = { page, pageSize, sortBy, sortDir: effSortDir, ...debouncedFilters };

          // 1) count
          const countRes = await api.get("/comp/count", { params });
          if (cancelled) return;
          setTotalCount(countRes.data?.count ?? 0);

          // 2) data with progress
          // Fallback: gently tick up while we don't know total
          timerId = setInterval(() => {
            setFetchProgress((p) => (p < 90 ? p + 3 : p));
          }, 200);

          const dataRes = await api.get("/comp", {
            params,
            onDownloadProgress: (e) => {
              if (e?.total) {
                const percent = Math.round((e.loaded * 100) / e.total);
                setFetchProgress((prev) => Math.max(prev, percent));
              }
            },
          });

          if (cancelled) return;
          clearInterval(timerId);

          const rowsData = Array.isArray(dataRes.data?.rows) ? dataRes.data.rows : [];
          setRows(rowsData);
          pageCacheRef.current[cacheKey] = rowsData; // cache it
          setFetchProgress(100);
        }
      } catch (e) {
        console.error("Fetch page failed", e);
        const msg = e?.response?.data?.error || e?.message || "Failed to fetch";
        setError(msg);
        setRows([]);
        setTotalCount(0);
        setFetchProgress(0);
      } finally {
        clearInterval(timerId);
        // tiny delay so 100% is visible
        setTimeout(() => !cancelled && setLoading(false), 250);
      }
    })();

    return () => {
      cancelled = true;
      clearInterval(timerId);
    };
  }, [offline, page, pageSize, debouncedFilters, sortBy, sortDir, valuationOrder]);

  /* clamp page if total shrinks */
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [totalPages]); // eslint-disable-line

  const curPage = Math.min(page, totalPages);

  /* ---------- Offline: sync to device (IDB) ---------- */
  const handleSyncToDevice = async () => {
    try {
      setSyncing(true);
      setSyncMsg("Clearing old cache…");
      setSyncProgress(0);
      setSyncETA("");
      await clearAll();

      const effSortDir = valuationOrder && NUMERIC_COLS.has(sortBy) ? valuationOrder : sortDir;

      // get total to compute progress
      const { data: countData } = await api.get("/comp/count", {
        params: { ...filters, sortBy, sortDir: effSortDir },
      });
      const total = countData?.count ?? 0;
      if (total === 0) {
        setSyncMsg("Nothing to sync for these filters.");
        setSyncing(false);
        return;
      }

      const bulkSize = 10000; // big chunks for speed
      let fetched = 0;
      let p = 1;
      const startTime = Date.now();

      while (fetched < total) {
        setSyncMsg(`Syncing… ${fetched}/${total}`);
        setSyncProgress(Math.round((fetched / total) * 100));
        if (fetched > 0) {
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = fetched / elapsed;
          const eta = (total - fetched) / Math.max(rate, 1e-6);
          setSyncETA(`~${Math.ceil(eta)} sec left`);
        }

        const { data } = await api.get("/comp", {
          params: {
            page: p,
            pageSize: bulkSize,
            sortBy,
            sortDir: effSortDir,
            ...filters,
          },
        });
        const batch = Array.isArray(data?.rows) ? data.rows : [];
        if (!batch.length) break;

        await upsertRows(batch);
        fetched += batch.length;
        p += 1;

        if (batch.length < bulkSize) break;
      }

      setSyncProgress(100);
      setSyncMsg(`Done. Cached ${fetched} rows to your device.`);
      setSyncETA("");
    } catch (e) {
      console.error("Sync failed", e);
      setSyncMsg("Sync failed: " + (e?.message || "Unknown error"));
      setSyncProgress(0);
      setSyncETA("");
    } finally {
      setSyncing(false);
    }
  };

  /* ---------- Download Excel (with progress + ETA) ---------- */
  const handleDownloadExcel = async () => {
    try {
      setLoading(true);
      setSyncing(true); // reuse sync bar
      setSyncProgress(0);
      setSyncMsg("Preparing export…");
      setSyncETA("");

      const effSortDir = valuationOrder && NUMERIC_COLS.has(sortBy) ? valuationOrder : sortDir;

      // always fetch a fresh total for correct progress
      let exportTotal = 0;
      if (offline) {
        exportTotal = await getCountFromIDB(filters);
      } else {
        const { data } = await api.get("/comp/count", {
          params: { ...filters, sortBy, sortDir: effSortDir },
        });
        exportTotal = data?.count ?? 0;
      }

      let exportRows = [];
      const headersSeen = new Set(BASE_COLS);
      const startTime = Date.now();

      if (offline) {
        let got = 0;
        let p = 1;
        const chunk = 2000;
        while (got < exportTotal) {
          const { rows: batch } = await getPageFromIDB({
            page: p,
            pageSize: chunk,
            sortBy,
            sortDir: effSortDir,
            filters,
          });
          if (!batch.length) break;
          exportRows.push(...batch);
          got += batch.length;

          setSyncMsg(`Loading offline… ${got}/${exportTotal}`);
          setSyncProgress(Math.round((got / exportTotal) * 100));
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = got / Math.max(elapsed, 1e-6);
          setSyncETA(`~${Math.ceil((exportTotal - got) / rate)} sec left`);

          if (batch.length < chunk) break;
          p += 1;
        }
      } else {
        let p = 1, got = 0;
        const chunk = 2000;
        while (true) {
          const res = await api.get("/comp", {
            params: {
              page: p,
              pageSize: chunk,
              sortBy,
              sortDir: effSortDir,
              ...filters,
            },
          });
          const batch = Array.isArray(res.data?.rows) ? res.data.rows : [];
          if (!batch.length) break;

          exportRows.push(...batch);
          batch.forEach((r) => Object.keys(r || {}).forEach((k) => headersSeen.add(k)));
          got += batch.length;

          setSyncMsg(`Loading from server… ${got}/${exportTotal}`);
          setSyncProgress(Math.round((got / Math.max(exportTotal, 1)) * 100));
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = got / Math.max(elapsed, 1e-6);
          setSyncETA(`~${Math.ceil((exportTotal - got) / rate)} sec left`);

          if (batch.length < chunk) break;
          p += 1;
        }
      }

      const headers = Array.from(new Set([...BASE_COLS, ...headersSeen]));
      const normalized = exportRows.map((r) => {
        const obj = {};
        headers.forEach((h) => { obj[h] = r?.[h] ?? ""; });
        return obj;
      });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(normalized, { header: headers });
      XLSX.utils.sheet_add_aoa(ws, [headers], { origin: "A1" });
      XLSX.utils.book_append_sheet(wb, ws, "Data");

      const filename = offline
        ? `comp_offline_${new Date().toISOString().slice(0, 10)}.xlsx`
        : `comp_filtered_${new Date().toISOString().slice(0, 10)}.xlsx`;

      XLSX.writeFile(wb, filename);
      setSyncMsg("Export done ✅");
      setSyncProgress(100);
      setSyncETA("");
    } catch (e) {
      console.error("Download failed", e);
      alert("Download failed: " + (e?.message || "Unknown error"));
      setSyncMsg("Download failed ❌");
      setSyncProgress(0);
      setSyncETA("");
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  };

  /* ---------- helpers ---------- */
  const setF = (k, v) => { setFilters((p) => ({ ...p, [k]: v })); setPage(1); };
  const clearFilters = () => { setFilters(emptyFilters); setPage(1); };
  const clearSort = () => { setValuationOrder(""); setSortBy("Company_Name"); setSortDir("asc"); setPage(1); };

  const toggleSort = (key) => {
    if (sortBy === key) {
      if (!(NUMERIC_COLS.has(key) && valuationOrder)) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      }
    } else {
      setSortBy(key);
      if (!(NUMERIC_COLS.has(key) && valuationOrder)) setSortDir("asc");
    }
    setPage(1);
  };

  const caret = (key) => {
    const dir = valuationOrder && NUMERIC_COLS.has(key) && sortBy === key ? valuationOrder : sortBy === key ? sortDir : "";
    if (!dir) return "";
    return dir === "asc" ? "▲" : "▼";
  };

  const cellContent = (col, r) => {
    const raw = valueOf(r, col);
    const fval = filters[col] || "";
    return NUMERIC_COLS.has(col) ? String(raw ?? "") : highlight(raw, fval);
  };

  /* ---------- Render ---------- */
  return (
    <div className={`app theme-${theme} ${open ? "modal-open" : ""}`}>
      {/* Header */}
      <header className="site-header">
        <div className="header-left">
          <img src={logo} alt="Logo" className="logo" />
        </div>
        <TitleBar text="DATABASE" />
        <div className="header-right">
          {/* NEW: Admin toggle (only visible for admin) */}
          {isAdmin && (
            <button
              className="btn btn-ghost"
              onClick={() => setShowAdmin((s) => !s)}
              title="Open Admin Panel"
              style={{ marginRight: 8 }}
            >
              {showAdmin ? "Close Admin" : "Admin"}
            </button>
          )}

          <button
            className="btn btn-ghost"
            onClick={() => {
              localStorage.removeItem("authToken");
              localStorage.removeItem("role"); // clear role on logout
              window.location.reload(); // go back to login
            }}
            title="Logout"
          >
            🚪 Logout
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? "🌞 Light" : "🌙 Dark"}
          </button>
        </div>
      </header>

      <div className="wrapper">
        {/* Error */}
        {error && (
          <div className="filter-card" style={{ borderColor: "var(--danger)" }}>
            <div style={{ color: "var(--danger)" }}>{error}</div>
          </div>
        )}

        {/* Admin Panel (NEW) */}
        {showAdmin && isAdmin && <AdminPanel />}

        {/* Offline controls + actions */}
        <div className="filter-card" style={{ marginTop: 8, marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {isAdmin &&(
              <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={offline}
                  onChange={(e) => { setOffline(e.target.checked); setPage(1); }}
                />
                Use offline mode (IndexedDB)
              </label>
              )}
              {isAdmin &&(
              <button className="btn btn-green" onClick={handleSyncToDevice} disabled={syncing}>
                {syncing ? "Working…" : "Sync to device"}
              </button>
              )}

              {isAdmin &&(
              <button className="btn btn-blue" onClick={handleDownloadExcel} disabled={syncing}>
                {syncing ? "Working…" : "Download Excel"}
              </button>
              )}

              {syncMsg && <span style={{ color: "var(--muted)" }}>{syncMsg}</span>}
              {syncing && (
                <>
                  <div className="sync-progress">
                    <div className="sync-progress-bar" style={{ width: `${syncProgress}%` }}>
                      <span className="sync-progress-label">{syncProgress}%</span>
                    </div>
                  </div>
                  {syncETA && <span style={{ color: "var(--muted)", marginLeft: 8 }}>{syncETA}</span>}
                </>
              )}
            </div>

            {/* RIGHT-SIDE tiny fetch progress (instead of "Loading…") */}
            <div style={{ minWidth: 180, display: "flex", justifyContent: "flex-end" }}>
              {loading && (
                <div className="fetch-progress" aria-label={`Loading ${fetchProgress}%`}>
                  <div className="fetch-progress-bar" style={{ width: `${Math.max(fetchProgress, 5)}%` }} />
                  <span className="fetch-progress-label">{fetchProgress}%</span>
                </div>
              )}
            </div>
          </div>
        </div>
       
        <div className="hero">
          <img src={hero} alt="Hero" className="hero-image" />
        </div>
          
        {/* Filters */}
        <div className="filter-card">
          <div className="filter-grid">
            {FILTER_COLS.filter((c) => c !== "Company_Name" && c !== "Case").map((col) => (
              <div key={`f-${col}`} className="filter-item">
                <input
                  className="input"
                  placeholder={col}
                  value={filters[col] || ""}
                  onChange={(e) => setF(col, e.target.value)}
                />
              </div>
            ))}
            {FILTER_COLS.includes("Case") && (
              <div className="filter-item">
                <input
                  className="input"
                  placeholder="Case"
                  value={filters.Case || ""}
                  onChange={(e) => setF("Case", e.target.value)}
                />
              </div>
            )}
            <div className="filter-item">
              <input
                className="input"
                list="companies"
                placeholder="Company_Name"
                value={filters.Company_Name || ""}
                onChange={(e) => setF("Company_Name", e.target.value)}
              />
              <datalist id="companies">
                {companyOptions.map((opt) => (
                  <option key={opt} value={opt} />
                ))}
              </datalist>
            </div>
            <div className="filter-item">
              <select
                className="input"
                value={valuationOrder}
                onChange={(e) => { setValuationOrder(e.target.value); setPage(1); }}
              >
                <option value="">Valuation order</option>
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </div>
          </div>

          <div className="filter-actions">
            <button className="btn" onClick={clearSort}>Clear sort</button>
            <button className="btn btn-blue" onClick={clearFilters}>Reset Filters</button>
          </div>
        </div>

        {/* Table */}
        <div className="table-wrap">
          <table className="table">
            <thead className="thead">
              <tr>
                {DISPLAY_COLS.map((col) => (
                  <th key={col} className="th sortable" onClick={() => toggleSort(col)}>
                    {col} <span className="caret">{caret(col)}</span>
                  </th>
                ))}
                <th className="th">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="td" colSpan={DISPLAY_COLS.length + 1}>
                    {loading ? "" : "No data"}
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={r.rowKey ?? r.id ?? `${page}-${i}`}>
                    {DISPLAY_COLS.map((col) => (
                      <td key={col} className="td">{cellContent(col, r)}</td>
                    ))}
                    <td className="td">
                      <button className="btn btn-blue" onClick={() => { setViewRow(r); setOpen(true); }}>
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* NEW: Rows + Pagination bar */}
        <div className="pagerbar">
          <div className="rows-box">
            <label className="rows-label">Rows:</label>
            <select
              className="input rows-select"
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </div>

          <Pager
            totalPages={totalPages}
            curPage={curPage}
            setPage={setPage}
            count={totalCount}
          />
        </div>
      </div>

      {/* Modal */}
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Row details</h3>
              <button className="btn btn-red" onClick={() => setOpen(false)}>Close</button>
            </div>
            <div className="modal-body">
              <table className="detail-table">
                <tbody>
                  {allKeys.map((k) => (
                    <tr key={k}>
                      <td className="detail-key">{k}</td>
                      <td className="detail-val">{String(viewRow?.[k] ?? "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <footer className="site-footer">
        <div className="footer-inner">2025 The Wealth Finder — All rights reserved</div>
      </footer>
    </div>
  );
}

function Pager({ totalPages, curPage, setPage, count }) {
  const items = [];
  const addBtn = (label, onClick, { active = false, disabled = false, key } = {}) => {
    items.push(
      <button
        key={key ?? `${label}-${items.length}`}
        className={`page-btn ${active ? "active" : ""}`}
        onClick={onClick}
        disabled={disabled}
        aria-current={active ? "page" : undefined}
      >
        {label}
      </button>
    );
  };

  // Previous
  addBtn("Previous", () => setPage((p) => Math.max(1, p - 1)), { disabled: curPage === 1, key: "prev" });

  // Number window
  const windowSize = 7;
  let startN = Math.max(1, curPage - 3);
  let endN = Math.min(totalPages, startN + windowSize - 1);
  if (endN - startN < windowSize - 1) startN = Math.max(1, endN - windowSize + 1);

  if (startN > 1) {
    addBtn(1, () => setPage(1), { active: curPage === 1, key: "p1" });
    if (startN > 2) items.push(<span className="ellipsis" key="el1">…</span>);
  }
  for (let n = startN; n <= endN; n++) {
    addBtn(n, () => setPage(n), { active: curPage === n, key: `p${n}` });
  }
  if (endN < totalPages) {
    if (endN < totalPages - 1) items.push(<span className="ellipsis" key="el2">…</span>);
    addBtn(totalPages, () => setPage(totalPages), { active: curPage === totalPages, key: "plast" });
  }

  // Next
  addBtn("Next", () => setPage((p) => Math.min(totalPages, p + 1)), { disabled: curPage === totalPages, key: "next" });

  // Go to page
  const handleJump = (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const num = parseInt(form.get("pageNum"), 10);
    if (!isNaN(num) && num >= 1 && num <= totalPages) setPage(num);
    e.target.reset();
  };

  return (
    <div className="pager">
      <div className="pager-box">{items}</div>
      <form className="goto-form" onSubmit={handleJump}>
        <input type="number" name="pageNum" min="1" max={totalPages} placeholder="Go to…" className="goto-input" />
      </form>
      <span className="page-info">Page {curPage} / {totalPages} • {count} rows</span>
    </div>
  );
}
