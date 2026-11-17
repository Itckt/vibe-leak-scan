import http from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));

export async function localServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    server,
    close: () => new Promise((resolve, reject) => { server.closeAllConnections(); server.close((error) => error ? reject(error) : resolve()); }),
  };
}

export async function reportDirectory(t) {
  const base = path.join(root, 'data');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'test-'));
  t.after(async () => {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(base) || !path.basename(resolved).startsWith('test-')) throw new Error('Unsafe cleanup path');
    await rm(resolved, { recursive: true, force: true });
  });
  return directory;
}

export function allowPrivate(t) {
  const previous = process.env.ALLOW_PRIVATE_TARGETS;
  process.env.ALLOW_PRIVATE_TARGETS = '1';
  t.after(() => {
    if (previous === undefined) delete process.env.ALLOW_PRIVATE_TARGETS;
    else process.env.ALLOW_PRIVATE_TARGETS = previous;
  });
}

export async function post(origin, route, body, headers = {}) {
  const response = await fetch(`${origin}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
