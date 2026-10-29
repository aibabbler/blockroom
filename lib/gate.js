// The private landing page shown to anyone without the code cookie.
export function gatePage({ error = false, setup = false } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title>Blockroom</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=Instrument+Serif:ital@0;1&family=Kode+Mono:wght@400;500&display=swap">
<style>
:root{--paper:#f2ede2;--ink:#1c1a16;--muted:#6a6356;--line:rgba(28,26,22,.16);--brass:#94712e;--on:#fffaf0;--rec:#c23e29;--card:#f8f5ee;
  --f-display:"Instrument Serif",Georgia,serif;--f-ui:"Instrument Sans",system-ui,-apple-system,sans-serif;--f-mono:"Kode Mono",ui-monospace,Menlo,monospace}
@media (prefers-color-scheme:dark){:root{--paper:#16140f;--ink:#ece5d5;--muted:#a39a87;--line:rgba(236,229,213,.15);--brass:#d1aa5e;--on:#1a160e;--rec:#e0644d;--card:#211d17;color-scheme:dark}}
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{background:var(--paper);color:var(--ink);font-family:var(--f-ui);display:grid;grid-template-columns:minmax(0,1fr);place-items:center;
  padding:max(24px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));
  background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:48px 48px;background-position:center}
.card{width:min(420px,100%);background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:28px 24px 22px;box-shadow:0 20px 60px rgba(0,0,0,.08)}
.kicker{display:flex;justify-content:space-between;font-family:var(--f-mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.mark{display:flex;gap:6px;margin:26px 0 6px}
.mark i{width:18px;height:18px;border-radius:5px;display:block}
h1{font-family:var(--f-display);font-weight:400;font-size:clamp(46px,12vw,64px);line-height:.95;margin:6px 0 10px;letter-spacing:-.5px}
h1 em{color:var(--brass)}
p{color:var(--muted);font-size:14px;line-height:1.5;margin:0 0 22px}
label{display:block;font-family:var(--f-mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
.row{display:flex;gap:8px}
input{flex:1;min-width:0;height:48px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink);font:500 18px var(--f-mono);letter-spacing:.12em;padding:0 14px}
input:focus{outline:2px solid var(--brass);outline-offset:1px}
button{height:48px;padding:0 20px;border-radius:10px;border:0;background:var(--brass);color:var(--on);font:600 15px var(--f-ui);cursor:pointer}
button:disabled{opacity:.5;cursor:default}
.err{color:var(--rec);font-size:13px;margin:12px 0 0}
.foot{margin-top:26px;font-family:var(--f-mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
</style>
</head>
<body>
<main class="card">
  <div class="kicker"><span>Private studio</span><span>Previs · Blocking</span></div>
  <div class="mark" aria-hidden="true"><i style="background:#d6553a"></i><i style="background:#efbf35;border-radius:50%"></i><i style="background:#3a5ec4"></i><i style="background:#278a83;border-radius:9px"></i></div>
  <h1>Block<em>room</em></h1>
  <p>Enter your code to open the studio.</p>
  ${setup ? `<p class="err">This studio is locked until a code is set. Add BLOCKROOM_PASSCODE in the Vercel project settings, then redeploy.</p>` : ""}
  <form method="post" action="/api/unlock" autocomplete="on">
    <label for="code">Access code</label>
    <div class="row">
      <input id="code" name="code" type="password" autocomplete="current-password" required autofocus ${setup ? "disabled" : ""}>
      <button type="submit" ${setup ? "disabled" : ""}>Enter</button>
    </div>
    ${error ? `<p class="err" role="alert">That code didn't match. Try again.</p>` : ""}
  </form>
  <div class="foot">Jo Aiba / aibabbler</div>
</main>
</body>
</html>`;
}
