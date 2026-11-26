# Toasty Studio

A modular, browser-based meeting application prototype built for small-group conversations, focus groups, podcast-style sessions and collaborative work.

**Tech stack:** Python, FastAPI, TypeScript, Vite, WebRTC and SQLite.

The application uses WebRTC for real-time audio and video communication between participants. The backend handles room management, signaling and application data.

## Features

### Meetings
- Create and join meetings using a shared link (`/r/<roomId>`). Each meeting has its own room ID.
- Invite dialog with a copy-link button for the host and producers.
- Configured capacity of up to 6 participants.
- Microphone and camera controls, with clear muted and camera-off states.
- Screen sharing.
- WebSocket-based signaling.
- SQLite-based application data and activity logging.
- Meeting attendance and speaker activity records, with a downloadable speaker report for the host.

### Roles
- **Host:** leads the meeting. Can mute, remove, allow or block screen sharing, end the meeting and assign producers. Enforced by the server.
- **Producer:** a participant the host promotes. Gets the production tools (Notes, Moments, Media) and can ask people to mute. See the limits below.
- **Guest:** takes part in the conversation and manages their own camera and microphone.

The host has one compact view button in the top bar with **Host view**, **Producer view** and **Assign producer**. Switching views changes only what the host sees. It never changes what the host is allowed to do.

### Studio interface
- Dark theme with white text on black surfaces. Design tokens live in `styles/theme.css`.
- Fixed studio layout. The page does not scroll and the video grid fills the screen.
- Top bar with the Toasty Media logo, connection status, role, view button, invite, settings and help.
- Sidebar (opened with **People**) with tabs:
  - **People:** avatars, role, mic and camera state, connection state and a speaking indicator.
  - **Chat:** text chat between people currently in the meeting.
  - **Notes:** private notes, agenda and (in Producer view) timestamped moments. Saved in the browser only.
  - **Media:** preview of a future media library (Producer view only). Upload is not available.
- **Settings:** microphone selection, live level meter, echo cancellation, noise suppression and automatic gain (the checkboxes show what the browser reports), speaker selection where the browser supports it, and a camera preview.
- **Moxie AI:** a circular button next to the microphone opens a chat panel. It is a "Coming soon" interface with suggestion chips. It sends nothing and shows no generated replies.

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

The backend knows two roles, `host` and `guest`.

### Frontend: TypeScript / Vite

| Directory / File | Responsibility |
|---|---|
| `frontend/index.html` | Page structure: lobby, studio, dialogs |
| `frontend/src/main.ts` | Application entry point and lobby |
| `frontend/src/services/` | API communication and WebSocket management |
| `frontend/src/media/` | Media controls, icons, speaking detection and level meter |
| `frontend/src/participants/` | People panel and participant cards |
| `frontend/src/host/` | Host actions, leave dialog and speaker report |
| `frontend/src/meeting/` | Meeting workflow and WebRTC coordination |
| `frontend/src/roles/` | Role names, and the message relay used for producers, chat and mute requests |
| `frontend/src/producer/` | Sidebar workspace, view button, assign-producer dialog, media tab |
| `frontend/src/settings/` | Audio and video settings dialog |
| `frontend/src/moxie/` | Moxie panel and its service hook |
| `frontend/src/ui/` | Shared helpers: DOM builder, toasts, confirm dialogs |
| `frontend/src/styles/` | `theme.css` (tokens), `app.css` (layout), `components.css` (components) |

## How It Works

1. A participant creates or joins a meeting.
2. The backend manages the room and participant connections.
3. WebSocket signaling coordinates WebRTC connections.
4. Audio and video are exchanged between browsers.
5. Application data and activity records can be stored in SQLite.

### How producers and chat work today

The backend does not have a producer role yet. To avoid changing it, the frontend sends small tagged messages through the existing `signal` relay, which the server already forwards between two participants and stamps with the sender.

- The host sends the list of producer IDs to everyone. Other browsers accept it only if it comes from the host.
- A producer's "Ask to mute" request is accepted only from the host or a known producer.
- Chat uses the same channel.

**Limits of this approach:**
- It is enforced in each browser, not by the server. Producers cannot remove people or change sharing permissions, because those actions are host-only on the server.
- The producer list resets if the host reloads.
- Chat is not saved, and people who join later do not see earlier messages.
- If the server ever filters or rewrites `signal` payloads, assigning producers and chat will stop working.

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

The frontend uses one added dependency, `@fontsource-variable/inter`, for the Inter font. `npm install` installs it.

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

After rebuilding the frontend, restart the server and hard refresh the browser (Ctrl + Shift + R).

## Project Status

This is an actively developed prototype. The current focus is the frontend experience.

Current priorities include:

- Improving meeting reliability.
- Testing participant capacity and connection stability.
- Improving persistence of meeting and session data.
- Validating participant permissions and host controls.
- Improving speaker activity attribution.
- Exploring integration with the wider Toasty ecosystem.

## Known Limitations and Backend Work Needed

These are interface-only or client-side today:

| Area | Current state | Needs |
|---|---|---|
| Producer role | Client-side, set by the host | Server-side role, authorization and persistence |
| Producer powers (remove, block sharing) | Not available to producers | Server checks for the producer role |
| Chat | In memory, live participants only | Server relay and storage |
| Notes, agenda, moments | Saved in the browser only | Server storage if they should be shared |
| Media library | Preview only | File storage and endpoints |
| Recording, transcripts | Not implemented | Server-side recording and transcription |
| Session timer | Counts from when you joined | Room start time from the server |
| Background blur and replacement | Shown as "Coming soon" | A video-processing step before the outgoing track |
| Moxie AI | Interface only | An endpoint, connected through `moxie/moxie-service.ts` |
| Invitations | One shared room link, joins as guest | Per-person or expiring invites |

## Future Direction

The longer-term goal is to explore how Studio sessions can connect with shared Toasty infrastructure, including:

- Shared participant identity.
- Session and participation records.
- Profiles and contribution history.
- Peeps and other Toasty products.

These integrations are future architectural goals, not completed functionality.
