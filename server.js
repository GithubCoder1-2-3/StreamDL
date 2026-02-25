const express = require('express');
const { spawn, exec } = require('child_process');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { URL } = require('url');

const app = express();
const PORT = 5000;

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const REPLIT_BASE = 'http://localhost:3002';

// Proxy: fetch from Core API
app.get('/api/sources', async (req, res) => {
  const { type, id, season, episode } = req.query;
  let url;
  if (type === 'movie') {
    url = `${REPLIT_BASE}/v1/movie/${id}`;
  } else {
    url = `${REPLIT_BASE}/v1/tv/${id}/${season}/${episode}`;
  }
  
  try {
    const data = await fetchJson(url);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Test a source URL to see if it's reachable
app.post('/api/test-source', async (req, res) => {
  const { url, headers } = req.body;
  const start = Date.now();
  try {
    await fetchHead(url, headers, 5000);
    res.json({ ok: true, latency: Date.now() - start });
  } catch (e) {
    res.json({ ok: false, error: e.message, latency: Date.now() - start });
  }
});

// Convert m3u8/mp4 stream to downloadable mp4
app.post('/api/convert', async (req, res) => {
  const { url, headers, filename } = req.body;
  const safeFilename = (filename || 'download').replace(/[^a-zA-Z0-9._-]/g, '_') + '.mp4';
  const tmpPath = path.join(os.tmpdir(), `streamdl_${Date.now()}_${safeFilename}`);

  // Build ffmpeg args
  const inputArgs = [];
  
  // Add headers if present
  if (headers) {
    const headerStr = Object.entries(headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n');
    inputArgs.push('-headers', headerStr);
  }
  
  inputArgs.push('-i', url);

  const args = [
    ...inputArgs,
    '-c', 'copy',
    '-bsf:a', 'aac_adtstoasc',
    '-movflags', '+faststart',
    '-y',
    tmpPath
  ];

  console.log('Running ffmpeg:', args.join(' '));

  const ffmpeg = spawn('ffmpeg', args);
  let stderr = '';

  ffmpeg.stderr.on('data', (d) => {
    stderr += d.toString();
    // Stream progress to client via SSE would be ideal but we use simple approach
  });

  ffmpeg.on('close', (code) => {
    if (code !== 0) {
      console.error('FFmpeg failed:', stderr.slice(-500));
      // Try cleanup
      try { fs.unlinkSync(tmpPath); } catch {}
      return res.status(500).json({ error: 'FFmpeg conversion failed', details: stderr.slice(-500) });
    }
    
    const stat = fs.statSync(tmpPath);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('Content-Length', stat.size);
    
    const stream = fs.createReadStream(tmpPath);
    stream.pipe(res);
    stream.on('end', () => {
      try { fs.unlinkSync(tmpPath); } catch {}
    });
    stream.on('error', (err) => {
      try { fs.unlinkSync(tmpPath); } catch {}
    });
  });

  ffmpeg.on('error', (err) => {
    res.status(500).json({ error: 'FFmpeg not found: ' + err.message });
  });
});

// SSE endpoint for conversion progress
app.post('/api/convert-progress', async (req, res) => {
  const { url, headers, filename, duration } = req.body;
  const safeFilename = (filename || 'download').replace(/[^a-zA-Z0-9._-]/g, '_') + '.mp4';
  const tmpPath = path.join(os.tmpdir(), `streamdl_${Date.now()}_${safeFilename}`);
  const progressId = `${Date.now()}`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const inputArgs = [];
  if (headers) {
    const headerStr = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n');
    inputArgs.push('-headers', headerStr);
  }
  inputArgs.push('-i', url);

  const args = [
    ...inputArgs,
    '-c', 'copy',
    '-bsf:a', 'aac_adtstoasc',
    '-movflags', '+faststart',
    '-progress', 'pipe:1',
    '-y',
    tmpPath
  ];

  const ffmpeg = spawn('ffmpeg', args);
  let stderr = '';
  let outId = progressId;
  
  // Store file path for download
  progressFiles[outId] = { path: tmpPath, filename: safeFilename, ready: false };

  ffmpeg.stdout.on('data', (d) => {
    const text = d.toString();
    // Parse progress
    const lines = text.split('\n');
    const prog = {};
    for (const line of lines) {
      const [k, v] = line.split('=');
      if (k && v) prog[k.trim()] = v.trim();
    }
    if (prog.out_time_us) {
      const seconds = parseInt(prog.out_time_us) / 1e6;
      const pct = duration ? Math.min(99, (seconds / duration) * 100) : -1;
      send({ type: 'progress', seconds: seconds.toFixed(1), pct: pct.toFixed(1) });
    }
  });

  ffmpeg.stderr.on('data', (d) => { stderr += d.toString(); });

  ffmpeg.on('close', (code) => {
    if (code !== 0) {
      send({ type: 'error', message: 'Conversion failed', details: stderr.slice(-300) });
      try { fs.unlinkSync(tmpPath); } catch {}
      delete progressFiles[outId];
      res.end();
      return;
    }
    progressFiles[outId].ready = true;
    send({ type: 'done', downloadId: outId });
    res.end();
  });

  req.on('close', () => {
    ffmpeg.kill();
  });
});

const progressFiles = {};

app.get('/api/download/:id', (req, res) => {
  const { id } = req.params;
  const file = progressFiles[id];
  if (!file || !file.ready) return res.status(404).json({ error: 'Not ready or not found' });
  
  const stat = fs.statSync(file.path);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.setHeader('Content-Length', stat.size);
  
  const stream = fs.createReadStream(file.path);
  stream.pipe(res);
  stream.on('end', () => {
    setTimeout(() => {
      try { fs.unlinkSync(file.path); } catch {}
      delete progressFiles[id];
    }, 30000);
  });
});

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: 15000 }, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function fetchHead(url, headers, timeout) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'HEAD',
      headers: headers || {},
      timeout,
    };
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(options, (r) => {
      if (r.statusCode >= 200 && r.statusCode < 400) resolve(r.statusCode);
      else reject(new Error(`HTTP ${r.statusCode}`));
      r.resume();
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

app.use(express.static(path.join(__dirname)));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎬 StreamDL running at http://0.0.0.0:${PORT}\n`);
});
