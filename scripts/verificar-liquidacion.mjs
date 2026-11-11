// Verificación completa del motor de liquidación: (1) copias idénticas, (2) pruebas unitarias.
// Uso: node scripts/verificar-liquidacion.mjs
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const correr = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: false });
  if (r.error) {
    console.error(r.error);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
};

correr(process.execPath, [join(raiz, 'scripts', 'sync-shared.mjs'), '--check'], raiz);
// ts-node vive en backend/node_modules; --transpile-only evita requerir @types fuera de backend
correr(
  process.execPath,
  [
    join(raiz, 'backend', 'node_modules', 'ts-node', 'dist', 'bin.js'),
    '--transpile-only',
    '--skip-project',
    '-O',
    '{"module":"commonjs","target":"es2020"}',
    '../shared/liquidacion-horas.test.ts',
  ],
  join(raiz, 'backend')
);
