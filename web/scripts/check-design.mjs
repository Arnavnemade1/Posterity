// Guards the design system's scales: sizes come from the type scale (text-12, text-14, …), washes from the
// tokens (bg-hover, bg-active). Run by `npm run check`. Allowed exceptions go in ALLOW with a reason.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RULES = [
  { pattern: /\btext-\[\d+(?:\.\d+)?px\]/g, message: 'arbitrary font size: use the type scale (text-11 … text-40)' },
  { pattern: /\bhover:bg-(?:fg|white|black)\/\d+/g, message: 'ad-hoc hover wash: use bg-hover / bg-active / bg-selected' },
];
// Files that may break a rule, and why.
const ALLOW = new Set();

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(tsx?|css)$/.test(name) ? [path] : [];
  });

let failures = 0;
for (const file of walk('src')) {
  if (ALLOW.has(file)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const { pattern, message } of RULES) {
      for (const match of line.matchAll(pattern)) {
        failures++;
        console.error(`${file}:${i + 1}  ${match[0]}  ${message}`);
      }
    }
  });
}
if (failures) {
  console.error(`\n${failures} design-scale violation${failures === 1 ? '' : 's'}.`);
  process.exit(1);
}
console.log('Design scales: ok');
