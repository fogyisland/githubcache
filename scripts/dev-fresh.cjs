#!/usr/bin/env node
// dev-fresh.cjs — cross-platform "kill stuck dev server + wipe .next + restart".
//
// Use when `npm run dev` is wedged (stale .next, port-in-use,
// MODULE_NOT_FOUND on vendor-chunks). Spawns the platform-specific
// script (scripts/dev-fresh.sh on Unix, scripts/dev-fresh.ps1 on
// Windows) and re-execs `npm run dev`.
//
//   npm run dev:fresh

const { spawn } = require('node:child_process');
const { existsSync, rmSync } = require('node:fs');
const { platform } = require('node:os');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');

function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: 'inherit', shell: false, ...opts });
  child.on('exit', (code) => process.exit(code ?? 0));
  return child;
}

if (platform === 'win32') {
  // PowerShell is the only shell that ships with Windows 10+ and
  // exposes the NetTCPConnection cmdlet we need for port 5002 lookup.
  const ps = existsSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
    ? 'powershell.exe'
    : 'pwsh.exe';
  run(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(ROOT, 'scripts', 'dev-fresh.ps1')], { cwd: ROOT });
  return;
}

// POSIX (macOS / Linux): exec the bash script. Falls back to
// in-process kill+rm if bash isn't available (busybox, alpine).
try {
  run('bash', [join(ROOT, 'scripts', 'dev-fresh.sh')], { cwd: ROOT });
} catch {
  console.log('→ bash not available, doing kill+rm inline');
  try {
    const { execSync } = require('node:child_process');
    const pids = execSync('lsof -ti:5002 2>/dev/null || true', { encoding: 'utf8' }).trim();
    if (pids) {
      console.log(`→ killing PIDs on :5002: ${pids}`);
      execSync(`kill -9 ${pids.split(/\s+/).join(' ')} 2>/dev/null || true`, { shell: '/bin/sh' });
    }
  } catch {
    // lsof missing — try pkill
    try {
      require('node:child_process').execSync('pkill -9 -f "next dev" || true', { shell: '/bin/sh' });
    } catch {}
  }
  if (existsSync(join(ROOT, '.next'))) {
    console.log('→ removing .next/');
    rmSync(join(ROOT, '.next'), { recursive: true, force: true });
  }
  console.log('→ starting npm run dev');
  run('npm', ['run', 'dev'], { cwd: ROOT, shell: true });
}
