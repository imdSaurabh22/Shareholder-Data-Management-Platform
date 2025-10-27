import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import "./Login.css";
// If you already have different image imports/paths, keep yours:
import logo from "../src/assets/logo.png";
import illustration from "./assets/3.jpg";

const apiBase =
  (import.meta.env && import.meta.env.VITE_API_URL) ||
  (typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : "/");

export default function Login({ onLogin, onOpenSignup }) {
  const [mode, setMode] = useState("login"); // "login" | "forgot" | "reset"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPw, setShowPw] = useState(false);        // 👈 NEW (login)
  const [showNewPw, setShowNewPw] = useState(false);  // 👈 NEW (reset)
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  // If landed from email link (?resetToken=...)
  const resetToken = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get("resetToken") || "";
    } catch {
      return "";
    }
  }, []);

  useEffect(() => {
    if (resetToken) setMode("reset");
  }, [resetToken]);

  async function handleLogin(e) {
    e.preventDefault();
    setError(""); setMsg("");
    try {
      const res = await axios.post(`${apiBase}/login`, { email, password });
      localStorage.setItem("authToken", res.data.token);
      localStorage.setItem("role", res.data.role || "user");
      // clean any resetToken from URL
      if (resetToken && window?.history?.replaceState) {
        window.history.replaceState({}, "", window.location.pathname);
      }
      onLogin?.();
    } catch (err) {
      const msg = err?.response?.data?.error || "Login failed (check email/password or approval status).";
      setError(msg);
    }
  }

  async function handleForgot(e) {
    e.preventDefault();
    setError(""); setMsg("");
    if (!email) { setError("Enter your email"); return; }
    try {
      await axios.post(`${apiBase}/password/forgot`, { email });
      setMsg("If that email exists, a reset link has been sent.");
    } catch (err) {
      const msg = err?.response?.data?.error || "Failed to send reset link";
      setError(msg);
    }
  }

  async function handleReset(e) {
    e.preventDefault();
    setError(""); setMsg("");
    if (!resetToken) { setError("Reset link is missing or expired."); return; }
    if (!newPassword) { setError("Enter a new password"); return; }
    try {
      await axios.post(`${apiBase}/password/reset`, { token: resetToken, newPassword });
      setMsg("Password updated. You can log in now.");
      setNewPassword("");
      if (window?.history?.replaceState) {
        window.history.replaceState({}, "", window.location.pathname);
      }
      setMode("login");
    } catch (err) {
      const msg = err?.response?.data?.error || "Reset failed";
      setError(msg);
    }
  }

  return (
    <div className="login-page">
      {/* ---- Top Header ---- */}
      <header className="login-header">
        <div className="brand">
          <img src={logo} alt="Logo" className="brand-logo" />
        </div>
        <div className="auth-links">
          <span onClick={() => setMode("login")}>Login</span>
          <span onClick={() => onOpenSignup?.()}>Signup</span>
        </div>
      </header>

      {/* ---- Main Content ---- */}
      <div className="login-body">
        <div className="login-container">
          <div className="login-illustration">
            <img src={illustration} alt="Login Illustration" />
          </div>

          {/* ====== LOGIN ====== */}
          {mode === "login" && (
            <form onSubmit={handleLogin} className="login-card">
              <h2>Login</h2>

              <input
                className="input"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />

              <input
                className="input"
                type={showPw ? "text" : "password"}  // 👈 show/hide
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              {/* Simple toggle, no extra CSS needed */}
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 4 }}>
                <input
                  type="checkbox"
                  checked={showPw}
                  onChange={(e) => setShowPw(e.target.checked)}
                />
                Show password
              </label>

              {error && <div className="error-box">{error}</div>}
              {msg && <div className="success-box">{msg}</div>}

              <button className="btn btn-blue" type="submit">Login</button>

              <div style={{ marginTop: 10, textAlign: "center" }}>
                <a style={{ cursor: "pointer" }} onClick={() => setMode("forgot")}>
                  Forgot password?
                </a>
              </div>
            </form>
          )}

          {/* ====== FORGOT (send link) ====== */}
          {mode === "forgot" && (
            <form onSubmit={handleForgot} className="login-card">
              <h2>Reset password</h2>
              <input
                className="input"
                placeholder="Your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />

              {error && <div className="error-box">{error}</div>}
              {msg && <div className="success-box">{msg}</div>}

              <button className="btn btn-blue" type="submit">Send reset link</button>
              <div style={{ marginTop: 10, textAlign: "center" }}>
                <a style={{ cursor: "pointer" }} onClick={() => setMode("login")}>
                  ← Back to login
                </a>
              </div>
            </form>
          )}

          {/* ====== RESET (from email link) ====== */}
          {mode === "reset" && (
            <form onSubmit={handleReset} className="login-card">
              <h2>Choose a new password</h2>
              <input
                className="input"
                type={showNewPw ? "text" : "password"} // 👈 show/hide for reset
                placeholder="New password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 4 }}>
                <input
                  type="checkbox"
                  checked={showNewPw}
                  onChange={(e) => setShowNewPw(e.target.checked)}
                />
                Show password
              </label>

              {error && <div className="error-box">{error}</div>}
              {msg && <div className="success-box">{msg}</div>}

              <button className="btn btn-blue" type="submit">Update password</button>
              <div style={{ marginTop: 10, textAlign: "center" }}>
                <a style={{ cursor: "pointer" }} onClick={() => setMode("login")}>
                  ← Back to login
                </a>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
