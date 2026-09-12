// One-off migration: Next.js 15 made cookies()/headers() async.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = 'src';
const extensions = new Set(['.ts', '.tsx']);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue;
      yield* walk(p);
    } else if (extensions.has(extname(p))) {
      yield p;
    }
  }
}

let changedFiles = 0;
let totalEdits = 0;

for (const f of walk(ROOT)) {
  let content = readFileSync(f, 'utf8');
  const original = content;
  let edits = 0;
  content = content.replace(
    /(\b(?:const|let|var)\s+(?:cookieStore|headerStore|jar|store|hdrs?)\s*=\s*)(cookies|headers)\(\)/g,
    (_m, decl, fn) => { edits++; return `${decl}await ${fn}()`; }
  );
  content = content.replace(
    /(\b(?:const|let|var)\s+\w+\s*=\s*)(cookies|headers)\(\)\.(get|set|delete|has|forEach)/g,
    (_m, decl, fn, method) => { edits++; return `${decl}await ${fn}().${method}`; }
  );
  content = content.replace(
    /(?<!await\s)\b(cookies|headers)\(\)\.(set|delete)\(/g,
    (_m, fn, method) => { edits++; return `await ${fn}().${method}(`; }
  );
  if (content !== original) {
    writeFileSync(f, content);
    changedFiles++;
    totalEdits += edits;
    console.log(`  ${f} (${edits} edits)`);
  }
}

console.log(`\nDone. ${changedFiles} files, ${totalEdits} total await insertions.`);
