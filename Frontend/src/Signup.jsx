import { useState } from "react";
import axios from "axios";
import "./Login.css";

const apiBase =
  (import.meta.env && import.meta.env.VITE_API_URL) ||
  (typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : "/");

export default function Signup({ onBackToLogin }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  function emailAllowed(e) {
    return /@thewealthfinder\.in$/i.test(String(e || "").trim());
  }

  async function handleSignup(e) {
    e.preventDefault();
    setError("");
    setMsg("");
    if (!emailAllowed(email)) {
      setError("Only company emails ending with @thewealthfinder.in are allowed");
      return;
    }
    try {
      await axios.post(`${apiBase}/signup`, { name, email, password });
      setMsg("Signup received. Awaiting admin approval. You'll be able to log in once approved.");
      setName(""); setEmail(""); setPassword("");
    } catch (err) {
      const m = err?.response?.data?.error || "Signup failed";
      setError(m);
    }
  }

  return (
    <div className="login-page">
      <header className="login-header">
        <div className="auth-links">
          <span style={{ cursor: "pointer" }} onClick={() => onBackToLogin?.()}>
            ← Back to Login
          </span>
        </div>
      </header>

      <div className="login-body">
        <div className="login-container">
          <form onSubmit={handleSignup} className="login-card" style={{ marginLeft: "auto" }}>
            <h2>Signup</h2>
            <input className="input" placeholder="Full Name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="input" placeholder="Company Email (@thewealthfinder.in)" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />

            {error && <div className="error-box">{error}</div>}
            {msg && <div className="success-box">{msg}</div>}

            <button className="btn btn-blue" type="submit">Create Account</button>
          </form>
        </div>
      </div>
    </div>
  );
}
