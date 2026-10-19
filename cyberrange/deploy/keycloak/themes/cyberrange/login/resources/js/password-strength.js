/* Advisory only: Keycloak remains responsible for password acceptance. */
(function () {
    "use strict";
    var COMMON_PATTERN = /password|passw|qwerty|letmein|welcome|cyberrange|capstone|123456|abcdef|abcdefghijkl/i;

    function normalizeIdentity(value) {
        return value.normalize("NFKC").toLowerCase().trim();
    }

    function looksCommon(value) {
        var nfkc = value.normalize("NFKC").toLowerCase();
        var normalized = nfkc.replace(/[0@]/g, "a").replace(/[1!]/g, "i").replace(/3/g, "e").replace(/\$/g, "s");
        return /(.+)\1{2,}/u.test(normalized) || COMMON_PATTERN.test(normalized) || new Set(normalized).size < 5;
    }

    function estimate(value) {
        if (!value) return 0;
        var nfkc = value.normalize("NFKC").toLowerCase();
        if (value.length < 8 || looksCommon(value)) return 1;
        var score = value.length < 12 ? 2 : value.length < 16 ? 3 : 4;
        if (/^[a-z\s]+$/.test(nfkc)) return Math.min(score, 2);
        return score;
    }

    function readAttemptedUsername(doc) {
        var el = doc.getElementById("kc-attempted-username");
        return el ? (el.textContent || "").trim() : "";
    }

    function evaluateRequirements(value, context) {
        context = context || {};
        var username = (context.username || "").trim();
        var email = (context.email || "").trim();
        var normalizedValue = value ? normalizeIdentity(value) : "";
        var items = [{ id: "length", label: "Must be 8–128 characters", met: value.length >= 8 && value.length <= 128 }];
        if (username) {
            items.push({
                id: "notUsername",
                label: "Must not match your username",
                met: Boolean(value) && normalizedValue !== normalizeIdentity(username),
            });
        }
        if (email) {
            items.push({
                id: "notEmail",
                label: "Must not match your email",
                met: Boolean(value) && normalizedValue !== normalizeIdentity(email),
            });
        }
        items.push({
            id: "notCommon",
            label: "Must not be a common password",
            met: value.length > 0 && !looksCommon(value),
        });
        return items;
    }

    function passwordToggle(input) {
        var group = input.closest(".pf-c-input-group, .pf-v5-c-input-group");
        if (!group) return null;
        return group.querySelector("[data-password-toggle], button[type=button]");
    }

    function setPasswordVisible(input, visible) {
        var want = visible ? "text" : "password";
        var toggle = passwordToggle(input);
        if (input.type !== want && toggle) toggle.click();
        if (input.type !== want) input.type = want;
        if (toggle && toggle.hasAttribute("aria-label")) {
            toggle.setAttribute("aria-label", visible ? "Hide password" : "Show password");
        }
    }

    function renderRequirements(list, items, password) {
        var owner = list.ownerDocument;
        list.textContent = "";
        items.forEach(function (item) {
            var li = owner.createElement("li");
            li.dataset.met = String(item.met);
            li.className = "cr-strength__must-item" +
                (item.met ? " is-met" : password ? " is-unmet" : " is-pending");
            var mark = owner.createElement("span");
            mark.className = "cr-strength__must-mark";
            mark.setAttribute("aria-hidden", "true");
            mark.textContent = item.met ? "✓" : "○";
            var text = owner.createElement("span");
            text.textContent = item.label;
            li.appendChild(mark);
            li.appendChild(text);
            list.appendChild(li);
        });
    }

    function mount(doc) {
        var input = doc.getElementById("password-new");
        if (!input || doc.getElementById("cr-password-strength")) return;
        var container = doc.createElement("div");
        container.id = "cr-password-strength";
        container.className = "cr-strength";
        var bar = doc.createElement("div");
        bar.className = "cr-strength__bar";
        bar.setAttribute("aria-hidden", "true");
        var fill = doc.createElement("div");
        fill.className = "cr-strength__fill";
        bar.appendChild(fill);
        var label = doc.createElement("p");
        label.id = "cr-password-strength-label";
        label.className = "cr-strength__label";
        label.setAttribute("role", "status");
        label.setAttribute("aria-live", "polite");
        label.setAttribute("aria-atomic", "true");
        var must = doc.createElement("ul");
        must.id = "cr-password-strength-must";
        must.className = "cr-strength__must";
        must.setAttribute("aria-label", "Password requirements");
        var saveHintNote = doc.createElement("p");
        saveHintNote.id = "cr-password-strength-save-hint";
        saveHintNote.className = "cr-strength__hint";
        saveHintNote.textContent = "Your last 3 passwords are also checked when you save.";
        var hint = doc.createElement("p");
        hint.id = "cr-password-strength-hint";
        hint.className = "cr-strength__hint";
        hint.textContent = "Choose your own password or a longer unique passphrase. Generate password is optional; strength is an estimate.";
        container.appendChild(bar);
        container.appendChild(label);
        container.appendChild(must);
        container.appendChild(saveHintNote);
        container.appendChild(hint);
        var crypto = doc.defaultView && doc.defaultView.crypto;
        var confirm = doc.getElementById("password-confirm");
        if (crypto && typeof crypto.getRandomValues === "function" && input.form &&
            confirm && confirm.form === input.form && !input.disabled && !input.readOnly &&
            !confirm.disabled && !confirm.readOnly) {
            var generate = doc.createElement("button");
            generate.type = "button";
            generate.className = "cr-strength__generate";
            generate.textContent = "Generate password";
            var saveHint = doc.createElement("p");
            saveHint.className = "cr-strength__hint cr-strength__save-hint";
            saveHint.setAttribute("role", "status");
            saveHint.textContent = "Save this generated password in your password manager before continuing.";
            saveHint.hidden = true;
            generate.addEventListener("click", function () {
                var digits = "23456789", symbols = "!@#$%*-_=+", alphabet = digits + symbols;
                function randomIndex(max) {
                    var limit = Math.floor(0x100000000 / max) * max;
                    var bytes = new Uint32Array(1);
                    do { crypto.getRandomValues(bytes); } while (bytes[0] >= limit);
                    return bytes[0] % max;
                }
                var chars = [digits[randomIndex(digits.length)], symbols[randomIndex(symbols.length)]];
                while (chars.length < 24) chars.push(alphabet[randomIndex(alphabet.length)]);
                for (var i = chars.length - 1; i > 0; i--) {
                    var j = randomIndex(i + 1);
                    var previous = chars[i]; chars[i] = chars[j]; chars[j] = previous;
                }
                var value = chars.join("");
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
        var group = input.closest(".pf-c-input-group, .pf-v5-c-input-group") || input;
        group.insertAdjacentElement("afterend", container);
        input.setAttribute("aria-describedby", [input.getAttribute("aria-describedby"), label.id, must.id, saveHintNote.id, hint.id].filter(Boolean).join(" "));
        function update() {
            var score = estimate(input.value);
            container.dataset.score = String(score);
            label.textContent = score ? "Password strength: " + ["", "Weak", "Medium", "Good", "Strong"][score] : "Enter a new password to see its strength.";
            renderRequirements(must, evaluateRequirements(input.value, { username: readAttemptedUsername(doc) }), input.value);
        }
        input.addEventListener("input", update);
        input.addEventListener("change", update);
        if (input.form) input.form.addEventListener("reset", function () {
            setTimeout(function () {
                setPasswordVisible(input, false);
                var saveHintEl = container.querySelector(".cr-strength__save-hint");
                if (saveHintEl) saveHintEl.hidden = true;
                update();
            }, 0);
        });
        update();
    }
    if (typeof module !== "undefined" && module.exports) module.exports = { estimate, evaluateRequirements, mount };
    if (typeof document !== "undefined") {
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { mount(document); });
        else mount(document);
    }
})();
