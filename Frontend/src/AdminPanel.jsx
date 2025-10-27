import { useEffect, useMemo, useState } from "react";
import axios from "axios";

/* Same LAN-friendly base you’re using elsewhere */
const apiBase =
  (import.meta.env && import.meta.env.VITE_API_URL) ||
  (typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : "/");

/* Local axios with auth header (reads token from localStorage) */
const api = axios.create({ baseURL: apiBase });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("authToken");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default function AdminPanel() {
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function fetchUsers() {
    try {
      setLoading(true);
      setError("");
      const { data } = await api.get("/admin/users");
      setUsers(Array.isArray(data?.users) ? data.users : []);
    } catch (e) {
      const m = e?.response?.data?.error || e?.message || "Failed to fetch users";
      setError(m);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchUsers();
  }, []);

  async function approve(id) {
    try {
      setMsg("");
      setError("");
      await api.post(`/admin/approve/${id}`);
      setMsg("✅ Approved.");
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, status: "active" } : u)));
    } catch (e) {
      setError(e?.response?.data?.error || "Approve failed");
    }
  }

  async function removeUser(id) {
    try {
      setMsg("");
      setError("");
      await api.post(`/admin/remove/${id}`);
      setMsg("🗑️ Removed (can be reactivated later).");
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, status: "removed" } : u)));
    } catch (e) {
      setError(e?.response?.data?.error || "Remove failed");
    }
  }

  // NEW: Send password reset link to user
  async function sendReset(id) {
    try {
      setMsg("");
      setError("");
      await api.post(`/admin/password/reset/${id}`);
      setMsg("📧 Reset link sent to the user.");
    } catch (e) {
      setError(e?.response?.data?.error || "Failed to send reset link");
    }
  }

  // NEW: Hard delete user (must re-register)
  async function deleteUser(id, email) {
    try {
      setMsg("");
      setError("");
      const ok = window.confirm(
        `Delete user ${email}? This permanently removes the account.\nThe user must sign up again to regain access.`
      );
      if (!ok) return;
      await api.post(`/admin/delete/${id}`);
      setMsg("🧹 User deleted permanently.");
      setUsers((prev) => prev.filter((u) => u.id !== id));
    } catch (e) {
      setError(e?.response?.data?.error || "Delete failed");
    }
  }

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return users;
    return users.filter(
      (u) =>
        String(u.name || "").toLowerCase().includes(n) ||
        String(u.email || "").toLowerCase().includes(n) ||
        String(u.status || "").toLowerCase().includes(n)
    );
  }, [users, q]);

  return (
    <div style={{ marginTop: 16 }}>
      <div
        style={{
          background: "var(--panel, #111827)",
          border: "1px solid var(--border, #1f2937)",
          borderRadius: 12,
          padding: 16,
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>Admin • Users</h3>
          <div style={{ flex: 1 }} />
          <input
            className="input"
            placeholder="Search name / email / status…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ maxWidth: 320 }}
          />
          <button className="btn" onClick={fetchUsers} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {msg && (
          <div style={{ background: "#d1fae5", color: "#065f46", padding: 8, borderRadius: 8, marginBottom: 10 }}>
            {msg}
          </div>
        )}
        {error && (
          <div style={{ background: "#fee2e2", color: "#b91c1c", padding: 8, borderRadius: 8, marginBottom: 10 }}>
            {error}
          </div>
        )}

        <div className="table-wrap">
          <table className="table">
            <thead className="thead">
              <tr>
                <th className="th">ID</th>
                <th className="th">Name</th>
                <th className="th">Email</th>
                <th className="th">Status</th>
                <th className="th">Created</th>
                <th className="th">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td className="td">{u.id}</td>
                  <td className="td">{u.name}</td>
                  <td className="td">{u.email}</td>
                  <td className="td">
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 999,
                        fontSize: 12,
                        border: "1px solid var(--border, #1f2937)",
                        background:
                          u.status === "active"
                            ? "#dcfce7"
                            : u.status === "removed"
                            ? "#fee2e2"
                            : "#fef9c3",
                        color:
                          u.status === "active"
                            ? "#065f46"
                            : u.status === "removed"
                            ? "#7f1d1d"
                            : "#713f12",
                      }}
                    >
                      {u.status}
                    </span>
                  </td>
                  <td className="td">{u.created_at ? new Date(u.created_at).toLocaleString() : "-"}</td>
                  <td className="td" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      className="btn"
                      title="Approve"
                      disabled={u.status === "active"}
                      onClick={() => approve(u.id)}
                    >
                      Approve
                    </button>
                    <button
                      className="btn btn-red"
                      title="Remove (soft)"
                      onClick={() => removeUser(u.id)}
                    >
                      Remove
                    </button>
                    <button
                      className="btn btn-ghost"
                      title="Send password reset link"
                      onClick={() => sendReset(u.id)}
                      disabled={u.status === "removed"}
                    >
                      Send Reset
                    </button>
                    <button
                      className="btn btn-ghost"
                      title="Delete permanently"
                      onClick={() => deleteUser(u.id, u.email)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td className="td" colSpan={6} style={{ color: "var(--muted, #94a3b8)" }}>
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 8, color: "var(--muted, #94a3b8)", fontSize: 13 }}>
          Tip: <b>Remove</b> = disable account. <b>Delete</b> = permanently remove; user must re-register.
        </div>
      </div>
    </div>
  );
}
