# AttendEase

Attendance and assignment management for faculty. React + TypeScript frontend (Vite), Node + Express + TypeScript backend.

## What it does
- **Faculty** (PIN protected): create courses, paste a roster, start a timed attendance session with a 4-digit code and a live present-count, create assignments with deadlines, open student uploads, view a per-student attendance and submission report (flags anyone below 75%).
- **Students**: sign in with enrolment number (must be on the roster), mark attendance with the class code, upload assignments (max 8 MB), see their own attendance percentage. Late submissions are labelled.

## Run it
Requires Node 18+.

```bash
npm run install:all
FACULTY_PIN=your-pin npm run dev
```
Open http://localhost:5173 (the API runs on port 4000 and is proxied).

## Production (one server, one port)
```bash
npm run install:all
npm run build
FACULTY_PIN=your-pin PORT=4000 npm start
```
The Express server serves the built React app and the API together. Deploy anywhere that runs Node (Render, Railway, Fly.io, a college server).

## Layout
```
server/src/index.ts   REST API, JSON-file storage (server/data/db.json), uploads in server/data/uploads
client/src/           React app: App, Student, Faculty, api, ui, styles.css
```

## Configuration
| Variable | Default | Purpose |
|---|---|---|
| `FACULTY_PIN` | `admin123` | Faculty PIN. **Change it.** |
| `PORT` | `4000` | API/server port |
| `DATA_DIR` | `server/data` | Where db.json and uploads live. Point at a persistent disk when deploying |

## Known limits (prototype)
- Storage is a JSON file plus local disk: fine for a class or department, not for thousands of concurrent users. Many free hosts wipe local disk on redeploy, so use a persistent disk or swap in a database.
- One shared faculty PIN, no per-teacher accounts. Students identify by enrolment number only; the rotating in-class code, short window and wrong-code limiter reduce proxy attendance but do not eliminate it.
- Faculty open uploaded files through a link that includes the PIN in the URL.
- Files are stored on the server, not Google Drive. A Drive/Sheets storage adapter can replace the JSON/disk layer in `server/src/index.ts`.

## API (all under /api)
Public: `GET /courses`, `GET /student?course&en`, `POST /attendance`, `POST /assignments/:id/submit` (multipart).
Faculty (`x-faculty-pin` header): `GET /verify`, `POST /courses`, `PUT /courses/:id/roster`, `POST /courses/:id/sessions`, `POST /sessions/:id/close`, `POST /courses/:id/assignments`, `GET /courses/:id/overview`, `GET /files/:file`.
