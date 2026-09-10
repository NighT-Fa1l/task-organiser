# Task Helper

Task Helper is a PWA-first memory-oriented study companion. This version is structured for a real public deployment:

- Vite frontend → GitHub Pages
- Node/Express API → separate Node host
- PostgreSQL → managed PostgreSQL provider
- Google Identity Services → backend-verified login
- HttpOnly JWT session cookie
- Per-user task storage in PostgreSQL
- Optional Google Calendar read-only browser permission
- Optional BYOK AI configuration

## Local development

### 1. Frontend

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

### 2. Backend

Create `server/.env` from `server/.env.example`, then install and start:

```powershell
cd server
npm install
npm run dev
```

Create the database schema once:

```powershell
psql "$env:DATABASE_URL" -f schema.sql
```

For local development, the frontend uses `http://localhost:5000` by default and the backend accepts `http://localhost:5173`.

## Google login

This version verifies the Google Identity Services ID token on the backend using `google-auth-library`. The browser only needs the Google **Web client ID**. Do not put a Google client secret in the frontend.

Set:

```text
VITE_GOOGLE_CLIENT_ID=...
```

and on the backend:

```text
GOOGLE_CLIENT_ID=...
```

The values must be the same OAuth Web client ID.

## Production architecture

```text
Browser / PWA
    │
    ├── GitHub Pages (Vite frontend)
    │
    └── HTTPS API
          │
          ├── Google token verification
          ├── HttpOnly JWT session
          ├── User/task API
          └── PostgreSQL
```

Set the backend `FRONTEND_URL` to the exact GitHub Pages origin, and set the GitHub Actions repository variable `VITE_API_URL` to the backend URL.

## Security

Never commit:

- `server/.env`
- database credentials
- `JWT_SECRET`
- Google client secrets
- AI provider secrets

The Google Web client ID is intentionally public because it is a browser OAuth identifier; authorization is enforced by Google's configured origins and backend ID-token verification.
