# StreamDL

Download any movie or TV show stream as MP4.

## Requirements

- Node.js (v16+)
- FFmpeg (must be installed: `brew install ffmpeg` or `apt install ffmpeg`)

## Setup

```bash
# Install dependencies
npm install express

# Start the backend server
node server.js
```

## Usage

1. Start the server: `node server.js`
2. Open `index.html` in your browser (just double-click it, or `open index.html`)
3. Enter a TMDB ID (e.g. `671` for Harry Potter)
4. Choose Movie or TV Show
5. Click **Fetch Sources** — it will test all sources for speed/availability
6. Select a working source (green dot = alive)
7. Click **Convert Selected Source**
8. Enter a filename and hit **Convert to MP4**
9. Wait for FFmpeg to finish, then click **Download MP4**

## Notes

- The backend runs on `http://localhost:3001`
- FFmpeg must be installed and in your PATH
- HLS streams may take longer to convert than direct MP4 sources
- Conversion time depends on stream length and your internet speed
