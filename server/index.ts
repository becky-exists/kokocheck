import express from 'express';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createApp } from './app.js';
import { dataDir, publicUrl, port, host, loadAdminToken, root } from './config.js';

const { app, store } = createApp({ dataDir, publicUrl, adminToken: loadAdminToken() });
if (process.env.NODE_ENV !== 'production' && !import.meta.url.includes('/build/')) {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  if (!existsSync(resolve(root, 'dist/index.html'))) throw new Error('Run npm run build before npm start.');
  app.use(express.static(resolve(root, 'dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve(root, 'dist/index.html')));
}
const server = app.listen(port, host, (error?: Error) => {
  if (error) { console.error(`Unable to bind ${host}:${port}. Choose a free PORT; no existing service was stopped.`); store.close(); process.exit(1); }
  console.log(`KokoCheck: ${publicUrl}\nLocal storage: ${dataDir}\nNo agent runner is started automatically.`);
});
server.requestTimeout = 10 * 60_000;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => { store.close(); process.exit(0); }));
