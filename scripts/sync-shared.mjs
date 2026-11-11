// Sincroniza el motor de liquidación canónico (shared/) hacia backend y frontend, y/o verifica que no diverjan.
// Uso:  node scripts/sync-shared.mjs          → copia
//       node scripts/sync-shared.mjs --check  → solo verifica (exit 1 si hay diferencias)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const origen = join(raiz, 'shared', 'liquidacion-horas.ts');
const destinos = [
  join(raiz, 'backend', 'src', 'shared', 'liquidacion-horas.ts'),
  join(raiz, 'frontend', 'src', 'app', 'shared', 'liquidacion-horas.ts'),
];
const CABECERA =
  '// ⚠️ ARCHIVO GENERADO desde /shared/liquidacion-horas.ts — NO EDITAR AQUÍ. Ejecuta: node scripts/sync-shared.mjs\n';
const esperado = CABECERA + readFileSync(origen, 'utf8');
const soloVerificar = process.argv.includes('--check');
let divergentes = 0;

for (const d of destinos) {
  const actual = existsSync(d) ? readFileSync(d, 'utf8') : null;
  if (actual === esperado) continue;
  if (soloVerificar) {
    console.error(`✘ Diverge: ${d}`);
    divergentes++;
  } else {
    mkdirSync(dirname(d), { recursive: true });
    writeFileSync(d, esperado);
    console.log(`✔ Sincronizado: ${d}`);
  }
}
if (soloVerificar) {
  if (divergentes) process.exit(1);
  console.log('✔ Copias idénticas a shared/liquidacion-horas.ts');
}
