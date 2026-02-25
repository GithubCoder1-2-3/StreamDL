# StreamDL

A web app to download any movie or TV show stream as MP4.

## Architecture

- **Backend + Frontend**: Single Node.js/Express server (`server.js`) running on port 5000
  - Serves `index.html` statically
  - Provides API endpoints at `/api/*`
- **Core Service**: External service (`cinepro-org/core`) running on port 3002
  - Handles movie/TV metadata and source extraction
- **FFmpeg**: System dependency for stream conversion (HLS/MP4)

## Key Files

- `server.js` - Express server (port 5000), serves static files + API routes. Proxies requests to `core-service` on port 3002.
- `index.html` - Single-page frontend, uses relative API URLs (`/api/...`)

## API Endpoints

- `GET /api/sources` - Proxies to `core-service` to fetch stream sources
- `POST /api/test-source` - Test if a source URL is reachable
- `POST /api/convert` - Convert stream to MP4 (simple, blocking)
- `POST /api/convert-progress` - Convert with SSE progress updates
- `GET /api/download/:id` - Download a converted file

## Setup

- Node.js 20 with `express` package
- FFmpeg installed as system dependency
- `core-service` cloned from GitHub and running on port 3002
- Main Workflow: `node server.js` on port 5000 (webview)

## Deployment

Configured for autoscale deployment. Note: production deployment would require managing the `core-service` lifecycle (e.g., using a process manager or containerization).
