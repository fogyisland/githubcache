// Add the GitHub PAT to the system's pool via the admin API.
// Mask the token in the output.
const BASE = 'http://localhost:5002';
const PAT = process.argv[2];
if (!PAT) { console.error('usage: node scripts/add-token.mjs <github_pat>'); process.exit(2); }

function mask(t) { return t.length <= 8 ? '***' : t.slice(0, 4) + '…' + t.slice(-4); }

async function main() {
  // 1. fetch CSRF — sets the ghc_csrf cookie. Must carry ghc_setup_done
  //    cookie so middleware doesn't bounce us to /init.
  const csrfRes = await fetch(`${BASE}/api/admin/auth/csrf`, {
    headers: { cookie: 'ghc_setup_done=1' },
  });
  if (csrfRes.status !== 200) {
    console.log('csrf fetch failed:', csrfRes.status, await csrfRes.text());
    process.exit(1);
  }
  const csrfSetCookies = csrfRes.headers.getSetCookie();
  const csrfCookieHeader = csrfSetCookies.map((c) => c.split(';')[0]).join('; ');
  const csrfBody = await csrfRes.json();
  const csrfToken = csrfBody.csrfToken ?? csrfBody.token;
  if (!csrfToken) throw new Error('no csrf token: ' + JSON.stringify(csrfBody));
  console.log('csrf:', mask(csrfToken));

  // 2. login
  const loginRes = await fetch(`${BASE}/api/admin/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': csrfToken,
      cookie: `ghc_setup_done=1; ${csrfCookieHeader}`,
    },
    body: JSON.stringify({ email: 'raymond.xu@booming.one', password: 'Admin909217', csrf: csrfToken }),
  });
  console.log('login:', loginRes.status);
  const loginCookies = loginRes.headers.getSetCookie();
  const sessionHeader = loginCookies.map((c) => c.split(';')[0]).join('; ');
  console.log('login:', loginRes.status);
  if (loginRes.status !== 200) {
    console.log(await loginRes.text());
    process.exit(1);
  }

  // 3. add token
  const label = 'load-test-' + new Date().toISOString().slice(11, 19);
  const addRes = await fetch(`${BASE}/api/admin/github-tokens`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': csrfToken,
      cookie: sessionHeader,
    },
    body: JSON.stringify({ label, token: PAT, csrf: csrfToken }),
  });
  console.log('add token:', addRes.status, 'label=' + label);
  const text = await addRes.text();
  console.log(text);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });