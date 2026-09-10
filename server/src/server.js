import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import pg from "pg";

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 5000);
const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
const jwtSecret = process.env.JWT_SECRET;
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const isProduction = process.env.NODE_ENV === "production";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!jwtSecret) throw new Error("JWT_SECRET is required");
if (!googleClientId) throw new Error("GOOGLE_CLIENT_ID is required");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" || isProduction ? { rejectUnauthorized: false } : undefined
});
const googleClient = new OAuth2Client(googleClientId);

app.set("trust proxy", 1);
app.use(cors({ origin: frontendUrl, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

const cookieOptions = {
  httpOnly: true,
  secure: process.env.COOKIE_SECURE === "true" || isProduction,
  sameSite: isProduction ? "none" : "lax",
  path: "/",
  maxAge: 1000 * 60 * 60 * 24 * 30
};

function signUser(user) {
  return jwt.sign({ sub: user.id, email: user.email }, jwtSecret, { expiresIn: "30d" });
}

async function auth(req, res, next) {
  try {
    const token = req.cookies.task_helper_session;
    if (!token) return res.status(401).json({ error: "Not authenticated" });
    const payload = jwt.verify(token, jwtSecret);
    const result = await pool.query(
      "SELECT id, email, name, picture FROM users WHERE id = $1",
      [payload.sub]
    );
    if (!result.rows[0]) return res.status(401).json({ error: "Session user not found" });
    req.user = result.rows[0];
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, service: "task-helper-api" });
  } catch {
    res.status(503).json({ ok: false, error: "Database unavailable" });
  }
});

app.post("/api/auth/google", async (req, res) => {
  try {
    const credential = req.body?.credential;
    if (!credential) return res.status(400).json({ error: "Google credential is required" });

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: googleClientId
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) return res.status(401).json({ error: "Google account could not be verified" });
    if (payload.email_verified === false) return res.status(401).json({ error: "Google email is not verified" });

    const result = await pool.query(
      `INSERT INTO users (id, google_sub, email, name, picture)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (google_sub) DO UPDATE SET
         email = EXCLUDED.email,
         name = EXCLUDED.name,
         picture = EXCLUDED.picture,
         updated_at = NOW()
       RETURNING id, email, name, picture`,
      [crypto.randomUUID(), payload.sub, payload.email, payload.name || payload.email, payload.picture || ""]
    );

    const user = result.rows[0];
    res.cookie("task_helper_session", signUser(user), cookieOptions);
    res.json({ user });
  } catch (error) {
    console.error("Google auth failed:", error.message);
    res.status(401).json({ error: "Google login failed" });
  }
});

app.get("/api/auth/me", auth, (req, res) => res.json({ user: req.user }));
app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie("task_helper_session", { httpOnly: true, secure: process.env.COOKIE_SECURE === "true" || isProduction, sameSite: isProduction ? "none" : "lax", path: "/" });
  res.json({ ok: true });
});

app.get("/api/tasks", auth, async (req, res) => {
  const result = await pool.query(
    "SELECT id, title, due, priority, done, created_at, updated_at FROM tasks WHERE user_id = $1 ORDER BY created_at DESC",
    [req.user.id]
  );
  res.json({ tasks: result.rows });
});

app.post("/api/tasks", auth, async (req, res) => {
  const { title, due = "No due date", priority = "Medium", done = false } = req.body || {};
  if (!title || typeof title !== "string") return res.status(400).json({ error: "Task title is required" });
  const result = await pool.query(
    `INSERT INTO tasks (id, user_id, title, due, priority, done)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, title, due, priority, done, created_at, updated_at`,
    [crypto.randomUUID(), req.user.id, title.trim(), String(due), String(priority), Boolean(done)]
  );
  res.status(201).json({ task: result.rows[0] });
});

app.patch("/api/tasks/:id", auth, async (req, res) => {
  const allowed = ["title", "due", "priority", "done"];
  const entries = Object.entries(req.body || {}).filter(([key]) => allowed.includes(key));
  if (!entries.length) return res.status(400).json({ error: "No task fields supplied" });
  const sets = entries.map(([key], i) => `${key} = $${i + 1}`);
  const values = entries.map(([, value]) => value);
  values.push(req.params.id, req.user.id);
  const result = await pool.query(
    `UPDATE tasks SET ${sets.join(", ")}, updated_at = NOW()
     WHERE id = $${values.length - 1} AND user_id = $${values.length}
     RETURNING id, title, due, priority, done, created_at, updated_at`,
    values
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Task not found" });
  res.json({ task: result.rows[0] });
});

app.delete("/api/tasks/:id", auth, async (req, res) => {
  const result = await pool.query("DELETE FROM tasks WHERE id = $1 AND user_id = $2", [req.params.id, req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Task not found" });
  res.json({ ok: true });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      google_sub TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      picture TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      due TEXT NOT NULL DEFAULT 'No due date',
      priority TEXT NOT NULL DEFAULT 'Medium',
      done BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON tasks(user_id);
  `);
}

initDatabase()
  .then(() => app.listen(port, () => console.log(`Task Helper API listening on port ${port}`)))
  .catch(error => {
    console.error("Database initialization failed:", error);
    process.exit(1);
  });
