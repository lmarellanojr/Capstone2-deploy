# Where this Manual lives

**Standalone Manual git toplevel:** `C:\Capstone2-Manual`  
**Inside the deploy kit:** `C:\Capstone2-Deploy\manual`

Do **not** nest this under the product tree. Do **not** nest `portal/` here.

On Ampere the **code** tree is:

```text
# kit (usual):
#   tar from inside C:\Capstone2-Deploy\cyberrange  →  ~/cyberrange
# split remotes:
git clone <product-remote> ~/cyberrange
mkdir -m 700 ~/cyberrange-data
```

This Manual stays on the operator PC. Students never SSH; they use the Cloudflare hostname after Session G.

**Second-host build:** Always Free is one A1 per tenancy. Do not terminate the
proof host. A verbatim walk of chapters `00`–`09` needs a **different tenancy**
or a paid shape. Recreate-ready stays open until that run exists.
See `SPRINT-PLAN.md`.
