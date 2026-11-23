# Toasty Studio

A modular, browser-based meeting application prototype built for small-group conversations, focus groups and collaborative sessions.

**Tech stack:** Python, FastAPI, TypeScript, Vite, WebRTC and SQLite.

The application uses WebRTC for real-time audio and video communication between participants. The backend handles room management, signaling and application data.

## Features

- Create and join meetings using a shared link.
- Host and guest participant roles.
- Configured capacity of up to 6 participants.
- Microphone and camera controls.
- Screen sharing.
- WebSocket-based signaling.
- SQLite-based application data and activity logging.
- Meeting attendance and speaker activity records.

> This is an independent prototype. It is not yet integrated into the main Toasty Media ecosystem or intended as a replacement for the existing Toasty Studio implementation.

## Architecture

The project is organized into separate backend and frontend modules.

### Backend: Python / FastAPI

| File | Responsibility |
|---|---|
| `backend/config.py` | Application configuration and ICE server settings |
| `backend/rooms.py` | Room state and participant management |
| `backend/signaling.py` | WebSocket connections and WebRTC signaling |
| `backend/host.py` | Host-related operations and permissions |
| `backend/store.py` | SQLite persistence and data operations |
| `backend/main.py` | FastAPI application, routes and server initialization |

### Frontend: TypeScript / Vite

| Directory / File | Responsibility |
|---|---|
| `frontend/src/main.ts` | Application entry point |
| `frontend/src/services/` | API communication and WebSocket management |
| `frontend/src/media/` | Media controls and speaking detection |
| `frontend/src/participants/` | Participant interface |
| `frontend/src/host/` | Host-related interface and reporting |
| `frontend/src/meeting/` | Meeting workflow and WebRTC coordination |
| `frontend/src/styles/` | Application styling and design system |

## How It Works

1. A participant creates or joins a meeting.
2. The backend manages the room and participant connections.
3. WebSocket signaling coordinates WebRTC connections.
4. Audio and video are exchanged between browsers.
5. Application data and activity records can be stored in SQLite.

## Run Locally

### Requirements

- Node.js 20+
- Python 3.10+

### 1. Build the frontend

```bash
cd frontend
npm install
npm run build
cd ..
```

### 2. Create a Python environment

```bash
python -m venv .venv
```

Activate it:

**Windows PowerShell**
```powershell
.venv\Scripts\Activate.ps1
```

**macOS / Linux**
```bash
source .venv/bin/activate
```

### 3. Install backend dependencies

```bash
pip install -r backend/requirements.txt
```

### 4. Start the server

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Open:

`http://localhost:8000`

## Project Status

This is an actively developed prototype.

Current priorities include:

- Improving meeting reliability.
- Testing participant capacity and connection stability.
- Improving persistence of meeting and session data.
- Validating participant permissions and host controls.
- Improving speaker activity attribution.
- Exploring integration with the wider Toasty ecosystem.

## Future Direction

The longer-term goal is to explore how Studio sessions can connect with shared Toasty infrastructure, including:

- Shared participant identity.
- Session and participation records.
- Profiles and contribution history.
- Peeps and other Toasty products.

These integrations are future architectural goals, not completed functionality.
