import http from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 8080;
const MAX_PLAYERS = 100, VIEW_RANGE = 400, TICK_MS = 100, MAX_SPEED = 60; // m/s (滑空・落下を許容)
const players = new Map();
let nextId = 1;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end(`skyrealm ok players=${players.size}\n`);
});
const wss = new WebSocketServer({ server, maxPayload: 512 });

const num = (v, lim) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < lim;

wss.on('connection', (ws) => {
  if (players.size >= MAX_PLAYERS) { ws.close(1013, 'full'); return; }
  const id = nextId++;
  const p = { id, ws, name: '旅人', x: 0, y: 0, z: 0, r: 0, a: 0, t: Date.now(), msgs: 0 };
  players.set(id, p);
  ws.send(JSON.stringify({ t: 'w', id }));

  ws.on('message', (raw) => {
    if (++p.msgs > 40) return;                       // 1秒あたり40通まで(秒ごとにリセット)
    let d; try { d = JSON.parse(raw); } catch { return; }
    if (d.t === 'hi') {
      p.name = String(d.n ?? '旅人').replace(/[^\p{L}\p{N}_\- ]/gu, '').slice(0, 12) || '旅人';
    } else if (d.t === 's' && num(d.x, 1e6) && num(d.y, 1e4) && num(d.z, 1e6) && num(d.r, 10)) {
      const now = Date.now(), dt = Math.max(0.05, (now - p.t) / 1000);
      if (Math.hypot(d.x - p.x, d.z - p.z) / dt > MAX_SPEED && p.t > 0 && p.moved) return; // 瞬間移動は無視
      Object.assign(p, { x: d.x, y: d.y, z: d.z, r: d.r, a: d.a | 0, t: now, moved: true });
    }
  });
  ws.on('close', () => players.delete(id));
  ws.on('error', () => players.delete(id));
});

setInterval(() => { for (const p of players.values()) p.msgs = 0; }, 1000);
setInterval(() => {                                   // 近くのプレイヤーだけに配信
  const list = [...players.values()];
  for (const a of list) {
    if (a.ws.readyState !== 1) continue;
    const near = list.filter(b => Math.hypot(a.x - b.x, a.z - b.z) < VIEW_RANGE)
      .map(b => [b.id, b.x, b.y, b.z, b.r, b.a, b.name]);
    a.ws.send(JSON.stringify({ t: 'u', p: near }));
  }
}, TICK_MS);

server.listen(PORT, () => console.log('listening', PORT));
