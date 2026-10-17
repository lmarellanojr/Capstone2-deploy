# DVWA theme mirror (SCEN-06 CSP sandbox)

Static copy of DVWA css/images/js from the Ampere golden image `dvwa-base`.
Served at `/dvwa-theme/*` with no session so opaque-origin sandboxed lab pages can load the theme.

`css/embedded.css` is a portal override (not from upstream). The lab HTML proxy
injects it on allowed DVWA pages so the Scenario 2 iframe can use fluid widths
below 980px without rewriting stock DigiNinja `main.css`.

Do not add PHP or vulnerability modules here.
Refresh from `dvwa-base` when the golden theme changes (see plan Task 1).
Keep `embedded.css` when refreshing — it is not part of upstream DVWA.
