import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The E2E suite builds into an isolated folder and serves a production SPA.
const webPath = fileURLToPath(new URL('.', import.meta.url));
const vitePath = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const result = spawnSync(process.execPath, [vitePath, 'build', '--outDir', 'dist-e2e'], { cwd: webPath, env: process.env, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
process.env.WEB_DIST = 'dist-e2e';
await import('./server.js');
