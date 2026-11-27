# Toasty Studio

A small browser meeting app. Python (FastAPI) handles rooms and connection signaling. TypeScript (Vite) is the web app. Video and audio go directly between browsers (WebRTC).

What works: start a meeting, share a link, host and guest join, mic and camera toggles, screen share, leave and rejoin, up to 4 people.

## Run it on your laptop

Needs Node 20+ and Python 3.10+.

```bash
# 1. Build the web app
cd frontend && npm install && npm run build && cd ..

# 2. Start the server
python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --port 8000
```

Open http://localhost:8000, enter your name, press Start meeting. Open the link in a second browser window to test with yourself.

For live editing of the UI, run `uvicorn backend.main:app --port 8000` in one terminal and `cd frontend && npm run dev` in another, then use http://localhost:5173.

## Meet Ricardo

Browsers only allow camera and microphone on https (or localhost), so Ricardo cannot open a plain http link from your laptop. Pick one:

1. **Quick test, today:** keep the server running and, in a second terminal, run `cloudflared tunnel --url http://localhost:8000` (free, install from cloudflare.com). It prints an https address. Open it yourself, start the meeting, send Ricardo the meeting link.
2. **Hosted:** deploy this folder with its Dockerfile to Render, Railway or Fly.io. They give you an https address and the app runs without your laptop. Keep one instance only, because rooms live in memory.

## If video does not connect

Some networks block direct connections. Add a TURN relay by setting these environment variables on the server: `TURN_URL` (for example `turn:your.host:3478`), `TURN_USERNAME`, `TURN_CREDENTIAL`. Free and paid TURN services exist (Metered, Cloudflare Calls, or your own coturn).

## Project layout

- `backend/main.py`: rooms, WebSocket signaling, serves the built web app
- `frontend/src/main.ts`: lobby, meeting, WebRTC, controls
- `frontend/src/style.css`: styles

## Known limits

- Rooms are in memory. Restarting the server ends all meetings.
- Meeting links are open: anyone with the link can join. The host is whoever created the room in that browser.
- Full mesh video, so quality drops past 4 people. Larger meetings need an SFU such as LiveKit.
- No recording, captions or notes yet. Those are the next milestones.
