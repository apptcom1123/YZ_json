const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const port = Number(process.env.PORT) || 3000;
const routes = [
  ['/data/', path.join(root, 'iching')],
  ['/texts/', path.join(root, 'md')],
  ['/image/', path.join(root, 'image')],
  ['/', path.join(root, 'public')],
];
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const route = routes.find(([prefix]) => pathname.startsWith(prefix));
  if (!route) return reply(res, 404, '找不到頁面');

  const [prefix, base] = route;
  const relative = pathname === '/' ? 'index.html' : pathname.slice(prefix.length);
  const file = path.resolve(base, relative);
  if (file !== base && !file.startsWith(base + path.sep)) return reply(res, 403, '禁止存取');

  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) return reply(res, 404, '找不到檔案');
    res.writeHead(200, {
      'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
      // This is a local reader under active development. Always serve the
      // latest HTML, CSS, JavaScript, JSON and Markdown after a refresh.
      'Cache-Control': 'no-store, max-age=0',
    });
    fs.createReadStream(file).pipe(res);
  });
}).listen(port, () => {
  console.log(`易經查閱網站：http://localhost:${port}`);
});

function reply(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}
