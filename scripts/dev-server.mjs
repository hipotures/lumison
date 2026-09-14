import { createReadStream, stat } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requestedApp = process.argv.find((argument) => argument.startsWith('--app='))?.slice(6);
const defaultApp = requestedApp === 'lumison' ? 'lumison' : 'tfl-lab';
const portArgument = process.argv.slice(2).find((argument) => /^\d+$/.test(argument));
const port = Number(portArgument ?? process.env.PORT ?? 8000);
const host = process.env.HOST?.trim() || null;
const mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
};

const server = http.createServer((request, response) => {
  try {
    const url = new URL(request.url, `http://localhost:${port}`);
    if (url.pathname === '/') {
      response.writeHead(302, { Location: `/apps/${defaultApp}/` });
      response.end();
      return;
    }
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = path.resolve(repositoryRoot, `.${pathname}`);
    if (file !== repositoryRoot && !file.startsWith(`${repositoryRoot}${path.sep}`)) {
      response.writeHead(403);
      response.end('forbidden');
      return;
    }
    stat(file, (error, details) => {
      if (error || !details.isFile()) {
        response.writeHead(404);
        response.end('not found');
        return;
      }
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': mime[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      });
      createReadStream(file).pipe(response);
    });
  } catch {
    response.writeHead(500);
    response.end('server error');
  }
});

const onListening = () => {
  const displayHost = host?.includes(':') ? `[${host}]` : (host ?? 'localhost');
  console.log(`Default: http://${displayHost}:${port}/apps/${defaultApp}/`);
  console.log(`TFL Lab: http://${displayHost}:${port}/apps/tfl-lab/`);
  console.log(`Lumison: http://${displayHost}:${port}/apps/lumison/`);
};

if (host) {
  server.listen(port, host, onListening);
} else {
  server.listen(port, onListening);
}
