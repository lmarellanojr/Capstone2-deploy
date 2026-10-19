const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const script = './themes/cyberrange/login/resources/js/password-strength.js';
const { estimate, mount } = require(script);

test('conservative estimates including long predictable passwords', () => {
    for (const [value, score] of [['', 0], ['short', 1], ['password123456789', 1],
        ['P@ssw0rd123456789', 1], ['abcabcabcabcabcabc', 1], ['aaaaaaaaaaaaaaaa', 1],
        ['orchid river copper moon', 2], ['ｏｒｃｈｉｄ ｒｉｖｅｒ ｃｏｐｐｅｒ ｍｏｏｎ', 2], ['abcdefghijklmnopqrstu', 1],
        ['982!sunshine#731', 4], ['#!@#%^23456789!@#%^2a', 4],
        ['#!@#%^23456789!@#%^2i', 4], ['#!@#%^23456789!@#%^2o', 4],
        ['r7#k9z2$m', 2], ['r7#k9z2$m8%N4', 3],
        ['#!@#%^23456789!@#%^2', 4]]) {
        assert.equal(estimate(value), score, value);
    }
});
test('mounts only on new-password form, preserves errors and controls, updates and resets', async () => {
    const dom = new JSDOM('<form><div class="pf-c-input-group"><input id="password-new" aria-describedby="existing-error"><button>Show</button></div><input id="password-confirm"></form>');
    const doc = dom.window.document;
    mount(doc); mount(doc);
    assert.equal(doc.querySelectorAll('.cr-strength').length, 1);
    assert.equal(doc.querySelector('.pf-c-input-group').nextElementSibling.id, 'cr-password-strength');
    const input = doc.getElementById('password-new');
    assert.match(input.getAttribute('aria-describedby'), /^existing-error /);
    assert.equal(doc.querySelector('[role=status]').getAttribute('aria-live'), 'polite');
    assert.equal(doc.getElementById('password-confirm').getAttribute('aria-describedby'), null);
    input.value = '#!@#%^23456789!@#%^2';
    input.dispatchEvent(new dom.window.Event('input'));
    assert.equal(doc.querySelector('.cr-strength').dataset.score, '4');
    assert.equal(doc.querySelector('[role=status]').textContent, 'Password strength: Strong');
    input.value = 'orchid river copper moon';
    input.dispatchEvent(new dom.window.Event('input'));
    assert.equal(doc.querySelector('.cr-strength').dataset.score, '2');
    assert.equal(doc.querySelector('[role=status]').textContent, 'Password strength: Medium');
    assert.ok(doc.querySelector('.cr-strength__fill'));
    assert.equal(doc.querySelectorAll('.cr-strength__bar span').length, 0);
    input.value = 'short'; input.dispatchEvent(new dom.window.Event('change'));
    assert.equal(doc.querySelector('.cr-strength').dataset.score, '1');
    input.type = 'text';
    input.form.reset();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(doc.querySelector('.cr-strength').dataset.score, '0');
    assert.equal(doc.querySelector('input').value, '');
    assert.equal(input.type, 'password');
    dom.window.close();
    const login = new JSDOM('<input id="password">');
    mount(login.window.document);
    assert.equal(login.window.document.querySelector('.cr-strength'), null);
    login.window.close();
});
test('head script waits for DOM readiness', () => {
    const dom = new JSDOM('<input id="password-new">');
    const doc = dom.window.document;
    vm.runInNewContext(fs.readFileSync(require.resolve(script), 'utf8'), { document: doc, setTimeout });
    assert.equal(doc.querySelector('.cr-strength'), null);
    doc.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    assert.ok(doc.querySelector('.cr-strength'));
    dom.window.close();
});
test('generation fills both fields securely after a click and never submits', () => {
    const dom = new JSDOM('<form><input id="password-new"><input id="password-confirm" value="existing"></form>');
    const doc = dom.window.document;
    let submitted = false;
    const events = [];
    doc.querySelector('form').addEventListener('submit', event => { submitted = true; event.preventDefault(); });
    for (const id of ['password-new', 'password-confirm']) {
        for (const type of ['input', 'change']) {
            doc.getElementById(id).addEventListener(type, () => events.push(id + ':' + type));
        }
    }
    mount(doc);
    const button = doc.querySelector('.cr-strength__generate');
    assert.equal(button.type, 'button');
    assert.equal(doc.getElementById('password-confirm').value, 'existing');
    assert.equal(doc.querySelector('.cr-strength__save-hint').hidden, true);
    const generated = new Set();
    for (let i = 0; i < 100; i++) {
        button.click();
        const password = doc.getElementById('password-new').value;
        assert.equal(password.length, 24);
        assert.match(password, /^[2-9!@#$%*_=+\-]+$/);
        assert.match(password, /[2-9]/);
        assert.match(password, /[!@#$%*_=+\-]/);
        assert.equal(doc.getElementById('password-confirm').value, password);
        generated.add(password);
    }
    assert.equal(generated.size, 100);
    const generatedInput = doc.getElementById('password-new');
    assert.equal(generatedInput.type, 'text', 'Generated password is visible to the user');
    assert.deepEqual(events.slice(0, 4), ['password-new:input', 'password-new:change', 'password-confirm:input', 'password-confirm:change']);
    assert.equal(submitted, false);
    assert.match(doc.querySelector('.cr-strength__hint').textContent, /Choose your own.*Generate password is optional/);
    const saveHint = doc.querySelector('.cr-strength__save-hint');
    assert.equal(saveHint.hidden, false);
    assert.match(saveHint.textContent, /password manager/);
    doc.getElementById('password-new').value = 'manual-entry';
    doc.getElementById('password-new').dispatchEvent(new dom.window.Event('input'));
    assert.equal(saveHint.hidden, true);
    dom.window.close();
});
test('generate clicks the Keycloak toggle and reset restores password type', async () => {
    const dom = new JSDOM('<form><div class="pf-c-input-group"><input id="password-new" type="password"><button type="button" data-password-toggle aria-label="Show password">Show</button></div><input id="password-confirm"></form>');
    const doc = dom.window.document;
    const input = doc.getElementById('password-new');
    const toggle = doc.querySelector('[data-password-toggle]');
    toggle.addEventListener('click', () => { input.type = input.type === 'password' ? 'text' : 'password'; });
    mount(doc);
    doc.querySelector('.cr-strength__generate').click();
    assert.equal(input.type, 'text');
    assert.equal(toggle.getAttribute('aria-label'), 'Hide password');
    input.form.reset();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(input.type, 'password');
    assert.equal(toggle.getAttribute('aria-label'), 'Show password');
    assert.equal(doc.querySelector('.cr-strength__save-hint').hidden, true);
    dom.window.close();
});
test('generation requires an editable confirmation field in the same form', () => {
    for (const html of [
        '<form><input id="password-new"></form>',
        '<form><input id="password-new"></form><form><input id="password-confirm"></form>',
        '<form><input id="password-new"><input id="password-confirm" disabled></form>',
        '<form><input id="password-new"><input id="password-confirm" readonly></form>',
    ]) {
        const dom = new JSDOM(html);
        mount(dom.window.document);
        assert.equal(dom.window.document.querySelector('.cr-strength__generate'), null);
        dom.window.close();
    }
});
test('does not offer insecure generation when Web Crypto is unavailable', () => {
    const dom = new JSDOM('<form><input id="password-new"><input id="password-confirm"></form>');
    Object.defineProperty(dom.window, 'crypto', { value: undefined });
    mount(dom.window.document);
    assert.equal(dom.window.document.querySelector('.cr-strength__generate'), null);
    dom.window.close();
});
