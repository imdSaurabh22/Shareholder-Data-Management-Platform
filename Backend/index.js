const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const compression = require("compression");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
require("dotenv").config();

const app = express();

/* gzip */
app.use(compression());

/* CORS: allow localhost + LAN IPs */
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl/postman
      const allow = [
        /^http:\/\/localhost:\d+$/i,
        /^http:\/\/127\.0\.0\.1:\d+$/i,
        /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/i,
        /^http:\/\/192\.168\.\d+\.\d+:\d+$/i,
        /^http:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d+:\d+$/i,
      ];
      cb(allow.some((re) => re.test(origin)) ? null : new Error("CORS: origin not allowed"), true);
    },
    allowedHeaders: ["Content-Type", "Authorization", "Origin"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: false,
  })
);

app.use(express.json({ limit: "1mb" }));

/* ---- MySQL pool ---- */
const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "saurabh",
  waitForConnections: true,
  connectionLimit: 10,
});

const TABLE_NAME = process.env.TABLE_NAME || "comp";
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const ADMIN_EMAIL = "saurabh@thewealthfinder.in";

/* ---- Ensure users table exists ---- */
async function ensureUsersTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100),
      email VARCHAR(150) UNIQUE,
      password_hash VARCHAR(255),
      status ENUM('pending','active','removed') DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;
  await pool.query(sql);
}
ensureUsersTable().catch(console.error);

/* ---- Mailer ---- */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

// Optional: check SMTP on boot
transporter
  .verify()
  .then(() => console.log("📧 SMTP ready"))
  .catch((e) => console.error("📧 SMTP verify failed:", e?.message || e));

/* ---- Helpers ---- */
function signJWT(payload, expiresIn = "1d") {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}
function verifyJWT(token) {
  return jwt.verify(token, JWT_SECRET);
}
function isAllowedDomain(email) {
  return /@thewealthfinder\.in$/i.test(String(email || "").trim());
}
function getPublicBaseUrl(req) {
  return process.env.PUBLIC_BACKEND_BASE_URL || `${req.protocol}://${req.get("host")}`;
}

/* ===== Password reset email helper ===== */
async function sendResetEmail(userId, email, req) {
  const resetToken = signJWT({ action: "reset", uid: userId }, "30m");
  const front =
    process.env.FRONTEND_BASE_URL ||
    `${req.protocol}://${(req.get("host") || "").replace(/:3000$/, ":5173")}`;
  const resetLink = `${front}/?resetToken=${resetToken}`;
  await transporter.sendMail({
    from: `"Access Bot" <${process.env.SMTP_USER}>`,
    to: email,
    subject: "Reset your password",
    html: `
      <p>You requested to reset your password.</p>
      <p>This link expires in <b>30 minutes</b>:</p>
      <p><a href="${resetLink}">Reset Password</a></p>
      <p>If you didn't request this, ignore this email.</p>
    `,
  });
}

/* ---- Auth middlewares ---- */
/* Verify token AND ensure user still exists & is active */
async function requireAuth(req, res, next) {
  try {
    const hdr = req.headers.authorization || "";
    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const payload = verifyJWT(token);

    const [rows] = await pool.query("SELECT id, email, status FROM users WHERE id = ?", [payload.uid]);
    const u = rows?.[0];
    if (!u) return res.status(401).json({ error: "User no longer exists" });
    if (u.status !== "active") return res.status(403).json({ error: "Account not active" });

    const role = u.email === ADMIN_EMAIL ? "admin" : "user";
    req.user = { uid: u.id, email: u.email, role, status: u.status };
    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}
function requireAdmin(req, res, next) {
  if (req.user?.role === "admin") return next();
  return res.status(403).json({ error: "Forbidden" });
}

/* =========================================
   Auth + Admin Approval
========================================= */

/* Signup (restricted to @thewealthfinder.in) */
app.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Missing name/email/password" });
    }
    if (!isAllowedDomain(email)) {
      return res
        .status(400)
        .json({ error: "Only company emails ending with @thewealthfinder.in are allowed" });
    }

    const [existing] = await pool.query("SELECT id FROM users WHERE email = ?", [email]);
    if (existing.length) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      "INSERT INTO users (name, email, password_hash, status) VALUES (?,?,?, 'pending')",
      [name, email, password_hash]
    );
    const userId = result.insertId;

    // Approval links (valid 3 days)
    const approveToken = signJWT({ action: "approve", userId }, "3d");
    const removeToken = signJWT({ action: "remove", userId }, "3d");
    const base = getPublicBaseUrl(req);
    const approveUrl = `${base}/approve?token=${approveToken}`;
    const removeUrl = `${base}/remove?token=${removeToken}`;

    try {
      await transporter.sendMail({
        from: `"Access Bot" <${process.env.SMTP_USER}>`,
        to: ADMIN_EMAIL,
        subject: `New User Signup Pending Approval: ${name} <${email}>`,
        html: `
          <p>A new user has registered:</p>
          <ul>
            <li><b>Name:</b> ${name}</li>
            <li><b>Email:</b> ${email}</li>
          </ul>
          <p>Choose an action:</p>
          <p>
            <a href="${approveUrl}">✅ Approve</a> &nbsp; | &nbsp;
            <a href="${removeUrl}">🗑️ Remove</a>
          </p>
        `,
      });
    } catch (mailErr) {
      console.error("Mailer error:", mailErr);
    }

    return res.json({ ok: true, message: "Signup received. Awaiting admin approval." });
  } catch (e) {
    console.error("POST /signup error:", e);
    return res.status(500).json({ error: "Signup failed" });
  }
});

/* Login (only active) */
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Missing email/password" });

    const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
    const user = rows?.[0];
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password_hash || "");
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    if (user.status !== "active") {
      return res.status(403).json({ error: "Account pending approval or removed" });
    }

    const role = user.email === ADMIN_EMAIL ? "admin" : "user";
    const token = signJWT({ uid: user.id, email: user.email, role });
    return res.json({ token, role });
  } catch (e) {
    console.error("POST /login error:", e);
    return res.status(500).json({ error: "Login failed" });
  }
});

/* One-click Approve/Remove (from email) */
app.get("/approve", async (req, res) => {
  try {
    const { token } = req.query || {};
    const payload = verifyJWT(token);
    if (payload.action !== "approve") throw new Error("bad action");
    await pool.query("UPDATE users SET status='active' WHERE id=?", [payload.userId]);
    console.log(`[ADMIN] Approved user id=${payload.userId}`);
    return res.send("✅ User approved. They can log in now.");
  } catch {
    return res.status(400).send("Invalid or expired approval link.");
  }
});

app.get("/remove", async (req, res) => {
  try {
    const { token } = req.query || {};
    const payload = verifyJWT(token);
    if (payload.action !== "remove") throw new Error("bad action");
    await pool.query("UPDATE users SET status='removed' WHERE id=?", [payload.userId]);
    console.log(`[ADMIN] Removed user id=${payload.userId}`);
    return res.send("🗑️ User removed.");
  } catch {
    return res.status(400).send("Invalid or expired removal link.");
  }
});

/* ===== Password reset (self-service) ===== */
app.post("/password/forgot", async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email required" });

    const [rows] = await pool.query("SELECT id, status FROM users WHERE email = ?", [email]);
    const user = rows?.[0];
    if (!user) return res.json({ ok: true });
    if (user.status === "removed") return res.json({ ok: true });

    await sendResetEmail(user.id, email, req);
    return res.json({ ok: true });
  } catch (e) {
    console.error("POST /password/forgot error:", e);
    return res.status(500).json({ error: "Failed to start reset" });
  }
});

app.post("/password/reset", async (req, res) => {
  try {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword) return res.status(400).json({ error: "Missing token/newPassword" });

    const payload = verifyJWT(token);
    if (payload.action !== "reset" || !payload.uid) throw new Error("bad token");

    const password_hash = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE users SET password_hash=? WHERE id=?", [password_hash, payload.uid]);

    return res.json({ ok: true });
  } catch (e) {
    console.error("POST /password/reset error:", e);
    return res.status(400).json({ error: "Invalid or expired token" });
  }
});

/* ===== Admin APIs (list/approve/remove/reset/delete) ===== */
app.get("/admin/users", requireAuth, requireAdmin, async (_req, res) => {
  const [rows] = await pool.query(
    "SELECT id, name, email, status, created_at FROM users ORDER BY created_at DESC"
  );
  res.json({ users: rows });
});

app.post("/admin/approve/:id", requireAuth, requireAdmin, async (req, res) => {
  await pool.query("UPDATE users SET status='active' WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

app.post("/admin/remove/:id", requireAuth, requireAdmin, async (req, res) => {
  await pool.query("UPDATE users SET status='removed' WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

app.post("/admin/password/reset/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const [rows] = await pool.query("SELECT id, email, status FROM users WHERE id = ?", [userId]);
    const u = rows?.[0];
    if (!u) return res.status(404).json({ error: "User not found" });
    if (u.status === "removed") return res.status(400).json({ error: "User is removed" });
    await sendResetEmail(u.id, u.email, req);
    res.json({ ok: true });
  } catch (e) {
    console.error("POST /admin/password/reset/:id error:", e);
    res.status(500).json({ error: "Failed to send reset link" });
  }
});

/* Hard delete: user must re-register */
app.post("/admin/delete/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const [rows] = await pool.query("SELECT id, email FROM users WHERE id = ?", [userId]);
    const u = rows?.[0];
    if (!u) return res.status(404).json({ error: "User not found" });
    if (u.email === ADMIN_EMAIL) {
      return res.status(400).json({ error: "Cannot delete the primary admin account" });
    }
    // Delete (ensure FK constraints are handled or cascaded if you add child tables)
    await pool.query("DELETE FROM users WHERE id = ?", [userId]);
    res.json({ ok: true });
  } catch (e) {
    console.error("POST /admin/delete/:id error:", e);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

/* =========================================
   Existing data endpoints (JWT-protected)
========================================= */
const COLS = [
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

function buildWhere(query) {
  const where = [];
  const values = [];
  for (const key of COLS) {
    const val = query[key];
    if (val && String(val).trim() !== "") {
      where.push(`\`${key}\` LIKE ?`);
      values.push(`%${val}%`);
    }
  }
  return { where, values };
}

app.get("/comp", requireAuth, async (req, res) => {
  try {
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize ?? "20", 10), 1), 10000);
    const page = Math.max(parseInt(req.query.page ?? "1", 10), 1);
    const offset = (page - 1) * pageSize;

    const sortBy = COLS.includes(req.query.sortBy) ? req.query.sortBy : "Company_Name";
    const sortDir = req.query.sortDir?.toLowerCase() === "desc" ? "DESC" : "ASC";

    const { where, values } = buildWhere(req.query);

    const sql = `
      SELECT *
      FROM ${TABLE_NAME}
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY \`${sortBy}\` ${sortDir}
      LIMIT ? OFFSET ?
    `;
    const params = [...values, pageSize, offset];
    const [rows] = await pool.query(sql, params);

    res.json({ rows: rows || [] });
  } catch (err) {
    console.error("GET /comp error:", err);
    res.status(500).json({ error: "Failed to fetch comp" });
  }
});

app.get("/comp/count", requireAuth, async (req, res) => {
  try {
    const { where, values } = buildWhere(req.query);
    const sql = `
      SELECT COUNT(*) as count
      FROM ${TABLE_NAME}
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
    `;
    const [rows] = await pool.query(sql, values);
    res.json({ count: rows?.[0]?.count ?? 0 });
  } catch (err) {
    console.error("GET /comp/count error:", err);
    res.status(500).json({ error: "Failed to fetch count" });
  }
});

/* ---- Boot ---- */
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running at http://0.0.0.0:${PORT}/`);
});
