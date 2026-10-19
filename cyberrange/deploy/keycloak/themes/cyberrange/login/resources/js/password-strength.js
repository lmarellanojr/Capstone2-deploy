/* Advisory only: Keycloak remains responsible for password acceptance. */
(function () {
    "use strict";
    function estimate(value) {
        if (!value) return 0;
        // An estimate only: the server checks the entire value against its blocklist.
        const nfkc = value.normalize("NFKC").toLowerCase();
        const normalized = nfkc.replace(/[0@]/g, "a").replace(/[1!]/g, "i").replace(/3/g, "e").replace(/\$/g, "s");
        if (value.length < 8 || /(.+)\1{2,}/u.test(normalized) ||
            /password|passw|qwerty|letmein|welcome|cyberrange|capstone|123456|abcdef|abcdefghijkl/i.test(normalized) ||
            new Set(normalized).size < 5) return 1;
        const score = value.length < 12 ? 2 : value.length < 16 ? 3 : 4;
        // Plain letter strings and simple all-word phrases are easy to guess.
        if (/^[a-z\s]+$/.test(nfkc)) return Math.min(score, 2);
        return score;
    }
    function passwordToggle(input) {
        const group = input.closest(".pf-c-input-group, .pf-v5-c-input-group");
        if (!group) return null;
        return group.querySelector("[data-password-toggle], button[type=button]");
    }
    function setPasswordVisible(input, visible) {
        const want = visible ? "text" : "password";
        const toggle = passwordToggle(input);
        if (input.type !== want && toggle) toggle.click();
        if (input.type !== want) input.type = want;
        if (toggle && toggle.hasAttribute("aria-label")) {
            toggle.setAttribute("aria-label", visible ? "Hide password" : "Show password");
        }
    }
    function mount(doc) {
        const input = doc.getElementById("password-new");
        if (!input || doc.getElementById("cr-password-strength")) return;
        const container = doc.createElement("div");
        container.id = "cr-password-strength";
        container.className = "cr-strength";
        const bar = doc.createElement("div");
        bar.className = "cr-strength__bar";
        bar.setAttribute("aria-hidden", "true");
        for (let i = 0; i < 4; i++) bar.appendChild(doc.createElement("span"));
        const label = doc.createElement("p");
        label.id = "cr-password-strength-label";
        label.setAttribute("role", "status");
        label.setAttribute("aria-live", "polite");
        label.setAttribute("aria-atomic", "true");
        const hint = doc.createElement("p");
        hint.id = "cr-password-strength-hint";
        hint.className = "cr-strength__hint";
        hint.textContent = "Choose your own 8–128 character password or a longer unique passphrase. Common passwords, your username or email, and recent passwords are checked when you save. Generate password is optional; strength is an estimate.";
        container.appendChild(bar);
        container.appendChild(label);
        container.appendChild(hint);
        const crypto = doc.defaultView && doc.defaultView.crypto;
        const confirm = doc.getElementById("password-confirm");
        if (crypto && typeof crypto.getRandomValues === "function" && input.form &&
            confirm && confirm.form === input.form && !input.disabled && !input.readOnly &&
            !confirm.disabled && !confirm.readOnly) {
            const generate = doc.createElement("button");
            generate.type = "button";
            generate.className = "cr-strength__generate";
            generate.textContent = "Generate password";
            const saveHint = doc.createElement("p");
            saveHint.className = "cr-strength__hint cr-strength__save-hint";
            saveHint.setAttribute("role", "status");
            saveHint.textContent = "Save this generated password in your password manager before continuing.";
            saveHint.hidden = true;
            generate.addEventListener("click", function () {
                const digits = "23456789", symbols = "!@#$%*-_=+", alphabet = digits + symbols;
                function randomIndex(max) {
                    const limit = Math.floor(0x100000000 / max) * max;
                    const bytes = new Uint32Array(1);
                    do { crypto.getRandomValues(bytes); } while (bytes[0] >= limit);
                    return bytes[0] % max;
                }
                const chars = [digits[randomIndex(digits.length)], symbols[randomIndex(symbols.length)]];
                while (chars.length < 24) chars.push(alphabet[randomIndex(alphabet.length)]);
                for (let i = chars.length - 1; i > 0; i--) {
                    const j = randomIndex(i + 1);
                    const previous = chars[i]; chars[i] = chars[j]; chars[j] = previous;
                }
                const value = chars.join("");
                input.value = value;
                confirm.value = value;
                setPasswordVisible(input, true);
                input.dispatchEvent(new doc.defaultView.Event("input", { bubbles: true }));
                input.dispatchEvent(new doc.defaultView.Event("change", { bubbles: true }));
                confirm.dispatchEvent(new doc.defaultView.Event("input", { bubbles: true }));
                confirm.dispatchEvent(new doc.defaultView.Event("change", { bubbles: true }));
                saveHint.hidden = false;
                input.focus();
            });
            input.addEventListener("input", function () { saveHint.hidden = true; });
            container.appendChild(generate);
            container.appendChild(saveHint);
        }
        const group = input.closest(".pf-c-input-group, .pf-v5-c-input-group") || input;
        group.insertAdjacentElement("afterend", container);
        input.setAttribute("aria-describedby", [input.getAttribute("aria-describedby"), label.id, hint.id].filter(Boolean).join(" "));
        function update() {
            const score = estimate(input.value);
            container.dataset.score = String(score);
            label.textContent = score ? "Password strength: " + ["", "Weak", "Fair", "Good", "Strong"][score] : "Enter a new password to see its strength.";
        }
        input.addEventListener("input", update);
        input.addEventListener("change", update);
        if (input.form) input.form.addEventListener("reset", function () {
            setTimeout(function () {
                setPasswordVisible(input, false);
                const saveHint = container.querySelector(".cr-strength__save-hint");
                if (saveHint) saveHint.hidden = true;
                update();
            }, 0);
        });
        update();
    }
    if (typeof module !== "undefined" && module.exports) module.exports = { estimate, mount };
    if (typeof document !== "undefined") {
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { mount(document); });
        else mount(document);
    }
})();
