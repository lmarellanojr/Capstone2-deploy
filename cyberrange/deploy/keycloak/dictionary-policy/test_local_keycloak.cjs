#!/usr/bin/env node
// Disposable real-Keycloak acceptance test. Never targets a remote server.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const base = new URL(process.env.LOCAL_KEYCLOAK_URL || 'http://127.0.0.1:18083/auth/');
assert.equal(base.hostname, '127.0.0.1', 'Only loopback Keycloak is permitted');
assert.equal(base.protocol, 'http:', 'Local runtime must use http');
assert.equal(base.port, '18083', 'Only disposable runtime port 18083 is permitted');
assert.equal(base.pathname.replace(/\/$/, ''), '/auth');
assert(!base.username && !base.password && !base.search && !base.hash);
const root = base.href.replace(/\/$/, '');
const secret = process.env.LOCAL_KEYCLOAK_ADMIN_PASSWORD;
assert(secret, 'LOCAL_KEYCLOAK_ADMIN_PASSWORD is required');
const realm = 'dictionary-test-' + crypto.randomBytes(6).toString('hex');
const callback = 'http://127.0.0.1:18084/callback';
const policy = 'length(8) and maxLength(128) and notUsername(undefined) and notEmail(undefined) and passwordHistory(3) and dictionaryWords(scowl-en-v1)';
const alphabet = '0123456789!@#$%^&*()-_=+[]{}:,.?';
const strong = () => Array.from({ length: 24 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
const word = '982!SuNsHiNe#731';
const passphrase = 'sunshine mountain river 982!';
let token, browser, madeRealm = false;
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.end(new URL(req.url, callback).searchParams.has('code') ? 'LOCAL_AUTH_SUCCESS' : 'LOCAL_AUTH_FAILED');
});
async function admin(route, method = 'GET', body) {
  return fetch(root + '/admin/' + route, {
    method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(20000),
  });
}
async function user(name, password, requiredActions = []) {
  const response = await admin('realms/' + realm + '/users', 'POST', {
    username: name, enabled: true, email: name + '@example.invalid', emailVerified: true,
    firstName: 'Local', lastName: 'Probe', requiredActions,
    credentials: [{ type: 'password', value: password, temporary: false }],
  });
  assert.equal(response.status, 201, 'Valid disposable user must be created');
  const location = new URL(response.headers.get('location'));
  assert.equal(location.hostname, '127.0.0.1');
  return location.pathname.split('/').pop();
}
async function authenticate(name, password) {
  return fetch(root + '/realms/' + realm + '/protocol/openid-connect/token', {
    method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'local-probe', username: name, password }), redirect: 'error',
  });
}
async function browserFlow(javaScriptEnabled) {
  const name = 'browser-' + (javaScriptEnabled ? 'js' : 'nojs');
  const initial = strong();
  await user(name, initial, ['UPDATE_PASSWORD']);
  const context = await browser.newContext({ javaScriptEnabled });
  const page = await context.newPage();
  // Keep every browser request local even if the realm/client is misconfigured.
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' || !['18083', '18084'].includes(url.port)) return route.abort();
    return route.continue();
  });
  try {
    const auth = new URL(root + '/realms/' + realm + '/protocol/openid-connect/auth');
    auth.search = new URLSearchParams({ client_id: 'local-probe', redirect_uri: callback, response_type: 'code', scope: 'openid' }).toString();
    await page.goto(auth.href);
    await page.locator('#username').fill(name);
    await page.locator('#password').fill(initial);
    await page.locator('#kc-login').click();
    await page.locator('#password-new').waitFor();
    const shots = path.join(process.env.USERPROFILE || 'C:/Users/Windows', 'Downloads', 'cyberrange-keycloak-local-test');
    fs.mkdirSync(shots, { recursive: true });
    // Initial/error screenshots contain no entered credential.
    if (javaScriptEnabled) await page.screenshot({ path: path.join(shots, 'update-password-initial.png'), fullPage: true });
    for (const candidate of [word, passphrase]) {
      await page.locator('#password-new').fill(candidate);
      await page.locator('#password-confirm').fill(candidate);
      await page.locator('input[type=submit], button[type=submit]').click();
      await page.getByText(/dictionary word/i).first().waitFor();
      assert(new URL(page.url()).pathname.includes('/login-actions/'), 'Dictionary candidate must remain in required action');
      await page.locator('#password-new').fill('');
      await page.locator('#password-confirm').fill('');
      if (javaScriptEnabled && candidate === word) await page.screenshot({ path: path.join(shots, 'update-password-dictionary-error.png'), fullPage: true });
    }
    let generated;
    if (javaScriptEnabled) {
      await page.getByRole('button', { name: 'Generate password', exact: true }).click();
      generated = await page.locator('#password-new').inputValue();
      assert.equal(generated.length, 24);
      assert(!/[A-Za-z]/.test(generated));
    } else {
      generated = strong();
      await page.locator('#password-new').fill(generated);
      await page.locator('#password-confirm').fill(generated);
    }
    await page.locator('input[type=submit], button[type=submit]').click();
    await page.waitForURL(callback + '?**');
    await page.getByText('LOCAL_AUTH_SUCCESS', { exact: true }).waitFor();
    assert.equal((await authenticate(name, generated)).status, 200);
    console.log('PASS forced UPDATE_PASSWORD (' + (javaScriptEnabled ? 'JavaScript enabled' : 'JavaScript disabled') + ')');
  } finally { await context.close(); }
}

(async () => {
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(18084, '127.0.0.1', resolve); });
    const login = await fetch(root + '/realms/master/protocol/openid-connect/token', {
      method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: 'localtestadmin', password: secret }), redirect: 'error',
    });
    assert.equal(login.status, 200, 'Local admin authentication failed');
    token = (await login.json()).access_token;
    const response = await admin('realms', 'POST', { realm, enabled: true, loginTheme: 'cyberrange', passwordPolicy: policy });
    assert.equal(response.status, 201, 'Disposable realm creation failed');
    madeRealm = true;
    assert.equal((await admin('realms/' + realm + '/clients', 'POST', { clientId: 'local-probe', enabled: true, publicClient: true, standardFlowEnabled: true, directAccessGrantsEnabled: true, redirectUris: [callback] })).status, 201);
    const rejected = await admin('realms/' + realm + '/users', 'POST', { username: 'bad-create', enabled: true, credentials: [{ type: 'password', value: word }] });
    assert.equal(rejected.status, 400, 'Create with dictionary credential must fail');
    assert.equal((await (await admin('realms/' + realm + '/users?username=bad-create&exact=true')).json()).length, 0, 'Failed create must not leave a user');
    console.log('PASS create-user dictionary rejection and rollback');
    const old = strong();
    const id = await user('reset-probe', old);
    assert.equal((await admin('realms/' + realm + '/users/' + id + '/reset-password', 'PUT', { type: 'password', value: word, temporary: false })).status, 400);
    assert.equal((await authenticate('reset-probe', old)).status, 200, 'Rejected reset must retain old credential');
    console.log('PASS reset-password dictionary rejection and credential preservation');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    await browserFlow(true);
    await browserFlow(false);
    console.log('LOCAL_KEYCLOAK_DICTIONARY_VERIFIED');
  } finally {
    if (browser) await browser.close();
    try {
      if (madeRealm) {
      const deleted = await admin('realms/' + realm, 'DELETE');
      assert.equal(deleted.status, 204, 'Disposable realm cleanup failed');
      console.log('PASS disposable realm deleted');
      }
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }
})().catch(error => { console.error('LOCAL_KEYCLOAK_TEST_FAILED: ' + error.message); process.exitCode = 1; });
