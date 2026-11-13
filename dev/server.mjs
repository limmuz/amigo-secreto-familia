// Servidor local que imita a Vercel (só para testes)
process.env.LOCAL_DEV = '1';
import http from 'node:http';
import fs from 'node:fs';
const { default: handler } = await import('../api/handler.js');
const html = () => fs.readFileSync(new URL('../index.html', import.meta.url));
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    let body = ''; for await (const c of req) body += c;
    req.query = { path: u.pathname.slice(5) };
    try { req.body = body ? JSON.parse(body) : {}; } catch { req.body = {}; }
    res.status = c => { res.statusCode = c; return res; };
    res.json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    return handler(req, res);
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html());
}).listen(3456, () => console.log('ok 3456'));
