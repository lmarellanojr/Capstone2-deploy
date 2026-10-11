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
        ['rT7#kP9z', 2], ['rT7#kP9zL2$m', 3], ['orchid river copper moon', 4]]) {
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
    input.value = 'orchid river copper moon';
    input.dispatchEvent(new dom.window.Event('input'));
    assert.equal(doc.querySelector('.cr-strength').dataset.score, '4');
    assert.equal(doc.querySelector('[role=status]').textContent, 'Password strength: Strong');
    input.value = 'short'; input.dispatchEvent(new dom.window.Event('change'));
    assert.equal(doc.querySelector('.cr-strength').dataset.score, '1');
    input.form.reset();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(doc.querySelector('.cr-strength').dataset.score, '0');
    assert.equal(doc.querySelector('input').value, '');
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
test('generation is secure, dictionary-free, and never submits or changes confirmation', () => {
    const dom = new JSDOM('<form><input id="password-new"><input id="password-confirm" value="existing"></form>');
    const doc = dom.window.document;
    let submitted = false;
    doc.querySelector('form').addEventListener('submit', event => { submitted = true; event.preventDefault(); });
    mount(doc);
    const button = doc.querySelector('.cr-strength__generate');
    assert.equal(button.type, 'button');
    const generated = new Set();
    for (let i = 0; i < 100; i++) {
        button.click();
        const password = doc.getElementById('password-new').value;
        assert.equal(password.length, 24);
        assert.match(password, /^[2-9!@#$%*_=+\-]+$/);
        assert.match(password, /[2-9]/);
        assert.match(password, /[!@#$%*_=+\-]/);
        generated.add(password);
    }
    assert.equal(generated.size, 100);
    assert.equal(doc.getElementById('password-new').type, 'text', 'Generated password is visible to the user');
    assert.equal(doc.getElementById('password-confirm').value, 'existing');
    assert.equal(submitted, false);
    assert.match(doc.querySelector('.cr-strength__hint').textContent, /dictionary.*save/);
    dom.window.close();
});
test('does not offer insecure generation when Web Crypto is unavailable', () => {
    const dom = new JSDOM('<input id="password-new">');
    Object.defineProperty(dom.window, 'crypto', { value: undefined });
    mount(dom.window.document);
    assert.equal(dom.window.document.querySelector('.cr-strength__generate'), null);
    dom.window.close();
});
