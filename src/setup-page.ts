/**
 * The setup page. Static HTML: nothing from the server is interpolated into it,
 * the script reads everything through the JSON actions and writes it with
 * textContent. Page JS avoids template literals so this file stays one string.
 */
export const SETUP_PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>mail-mcp setup</title>
<style>
  :root { --bg:#f6f5f1; --card:#fff; --ink:#1d1c1a; --dim:#6b6860; --line:#e2dfd6; --ok:#1c7c4a; --bad:#b3261e; --accent:#2f5bd0; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#161614; --card:#1f1f1c; --ink:#eceae4; --dim:#a09c92; --line:#34332e; --ok:#5fc48d; --bad:#f08a80; --accent:#8fb0ff; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 720px; margin: 0 auto; padding: 28px 16px 64px; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; }
  h2 { font-size: 1.1rem; margin: 0 0 10px; }
  p { margin: 0 0 10px; }
  .dim { color: var(--dim); }
  section { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:18px; margin-top:16px; }
  ol { margin: 0; padding-left: 20px; } li { margin-bottom: 8px; }
  code, .box { font: 14px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  code { background: var(--bg); padding: 1px 5px; border-radius: 5px; overflow-wrap: anywhere; }
  .box { display:block; background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:10px; overflow-wrap:anywhere; margin: 6px 0; }
  .row { display:flex; gap:10px; align-items:flex-start; padding:10px 0; border-top:1px solid var(--line); }
  .row:first-child { border-top:0; }
  .dot { flex:none; width:10px; height:10px; border-radius:50%; margin-top:8px; background:var(--dim); }
  .ok .dot { background:var(--ok); } .bad .dot { background:var(--bad); }
  .bad .msg { color:var(--bad); }
  .grow { flex:1; min-width:0; overflow-wrap:anywhere; }
  button { font:inherit; padding:8px 14px; border-radius:8px; border:1px solid var(--line); background:var(--card); color:var(--ink); cursor:pointer; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  @media (prefers-color-scheme: dark) { button.primary { color:#10131c; } }
  button:disabled { opacity:.55; cursor:default; }
  input { font:inherit; width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--line); background:var(--bg); color:var(--ink); margin: 4px 0 10px; }
  a { color: var(--accent); }
  .big { font-size:1.6rem; letter-spacing:.12em; font-weight:600; }
  .lang { float:right; }
  [hidden] { display:none !important; }
</style>
</head>
<body>
<main>
  <button class="lang" id="lang"></button>
  <h1>mail-mcp</h1>
  <p class="dim" data-t="tagline"></p>

  <section>
    <h2 data-t="boxes"></h2>
    <div id="accounts"><p class="dim" data-t="checking"></p></div>
    <p><button id="recheck" data-t="recheck"></button></p>
  </section>

  <section>
    <h2 data-t="addTitle"></h2>
    <ol>
      <li><span data-t="add1"></span>
        <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">Gmail</a> ·
        <a href="https://login.yahoo.com/account/security" target="_blank" rel="noopener noreferrer">Yahoo</a> ·
        <a href="https://account.apple.com/account/manage" target="_blank" rel="noopener noreferrer">iCloud</a>
      </li>
      <li><span data-t="add2"></span>
        <span class="box">MAIL_ACCOUNT_<span id="next">1</span></span>
        <span data-t="add2b"></span>
        <span class="box">you@gmail.com abcd efgh ijkl mnop</span>
      </li>
      <li data-t="add3"></li>
      <li data-t="add4"></li>
    </ol>
  </section>

  <section>
    <h2>Hotmail / Outlook.com</h2>
    <div id="olOff" hidden><p class="dim" data-t="olOff"></p></div>
    <div id="olOn" hidden>
      <p data-t="olIntro"></p>
      <label for="olEmail" data-t="olEmail"></label>
      <input id="olEmail" type="email" autocomplete="off" placeholder="you@hotmail.com">
      <button class="primary" id="olGo" data-t="olGo"></button>
      <div id="olStep" hidden>
        <p style="margin-top:14px"><span data-t="olOpen"></span> <a id="olLink" target="_blank" rel="noopener noreferrer"></a> <span data-t="olType"></span></p>
        <p class="big" id="olCode"></p>
        <p class="dim" data-t="olWait"></p>
      </div>
      <div id="olDone" hidden>
        <p style="margin-top:14px" data-t="olDone"></p>
        <span class="box" id="olName"></span>
        <span data-t="add2b"></span>
        <span class="box" id="olValue"></span>
        <p><button id="olCopy" data-t="copy"></button></p>
        <p class="dim" data-t="olAfter"></p>
      </div>
      <p class="bad"><span class="msg" id="olErr"></span></p>
    </div>
  </section>

  <section>
    <h2 data-t="aiTitle"></h2>
    <p data-t="aiIntro"></p>
    <span class="box" id="url"></span>
    <p><button id="urlCopy" data-t="copy"></button></p>
    <ol>
      <li data-t="ai1"></li>
      <li data-t="ai2"></li>
      <li data-t="ai3"></li>
    </ol>
    <p class="dim" data-t="secret"></p>
    <p class="dim" id="send"></p>
  </section>
</main>
<script>
(function () {
  var T = {
    en: {
      tagline: "Your mailboxes, available to any AI assistant that speaks MCP.",
      boxes: "Connected mailboxes", checking: "Checking logins...", recheck: "Check again",
      none: "No mailboxes yet. Add the first one below.",
      okMsg: "connected", folders: "folders",
      addTitle: "Add Gmail, Yahoo or iCloud",
      add1: "Create an app password for the mailbox (not your normal password):",
      add2: "In your hosting settings (Vercel: Settings > Environment Variables) add a variable named",
      add2b: "with the value",
      add3: "For another mailbox use the next number. Any mix of providers and any number of Gmail accounts works.",
      add4: "Redeploy (Vercel: Deployments > latest > Redeploy), then reload this page.",
      olIntro: "Microsoft does not accept passwords for these mailboxes, so you sign in once with a code.",
      olOff: "Easiest: in Outlook.com open Settings > Mail > Forwarding and forward to a mailbox you connected above. Direct sign-in is not available on this server because the OUTLOOK_CLIENT_ID variable is missing; the README explains how to add it.",
      olEmail: "Your Hotmail / Outlook address", olGo: "Connect",
      olOpen: "Open", olType: "and type this code:", olWait: "Waiting for you to finish signing in...",
      olDone: "Signed in. Add this variable in your hosting settings:",
      olAfter: "Then redeploy and reload this page. Microsoft tokens expire after roughly 90 days; repeat this step when the mailbox stops connecting.",
      copy: "Copy", copied: "Copied",
      aiTitle: "Connect your AI assistant", aiIntro: "This is your connector address:",
      ai1: "Claude: Settings > Connectors > Add custom connector, paste the address.",
      ai2: "ChatGPT: Settings > Connectors (developer mode), new connector with the same address, no authentication.",
      ai3: "Anything else that supports remote MCP servers (Streamable HTTP) takes the same address.",
      secret: "Treat this address like a password: whoever has it can read your mail. To revoke it, change MCP_AUTH_TOKEN and redeploy.",
      sendOff: "Sending is off: the assistant can only save drafts. Set MAIL_ALLOW_SEND=true to allow sending.",
      sendOn: "Sending is ON: the assistant can send email from these mailboxes.",
      badEmail: "Type a Hotmail / Outlook address first.", other: "Ελληνικά"
    },
    el: {
      tagline: "Τα mailbox σου, διαθέσιμα σε όποιο AI υποστηρίζει MCP.",
      boxes: "Συνδεδεμένα mailbox", checking: "Έλεγχος σύνδεσης...", recheck: "Έλεγξε ξανά",
      none: "Κανένα mailbox ακόμα. Πρόσθεσε το πρώτο παρακάτω.",
      okMsg: "συνδεδεμένο", folders: "φάκελοι",
      addTitle: "Πρόσθεσε Gmail, Yahoo ή iCloud",
      add1: "Φτιάξε κωδικό εφαρμογής για το mailbox (όχι τον κανονικό σου κωδικό):",
      add2: "Στις ρυθμίσεις του hosting (Vercel: Settings > Environment Variables) πρόσθεσε μεταβλητή με όνομα",
      add2b: "και τιμή",
      add3: "Για το επόμενο mailbox βάλε τον επόμενο αριθμό. Δουλεύει με όποιον συνδυασμό παρόχων και όσα Gmail θες.",
      add4: "Κάνε Redeploy (Vercel: Deployments > το τελευταίο > Redeploy) και ξαναφόρτωσε αυτή τη σελίδα.",
      olIntro: "Η Microsoft δεν δέχεται κωδικούς για αυτά τα mailbox, οπότε συνδέεσαι μία φορά με έναν κωδικό.",
      olOff: "Ο εύκολος τρόπος: στο Outlook.com άνοιξε Settings > Mail > Forwarding και βάλε προώθηση σε ένα mailbox που έχεις συνδέσει παραπάνω. Η απευθείας σύνδεση δεν είναι διαθέσιμη σε αυτόν τον server γιατί λείπει η μεταβλητή OUTLOOK_CLIENT_ID· το README εξηγεί πώς προστίθεται.",
      olEmail: "Η διεύθυνση Hotmail / Outlook σου", olGo: "Σύνδεση",
      olOpen: "Άνοιξε το", olType: "και γράψε αυτόν τον κωδικό:", olWait: "Περιμένω να ολοκληρώσεις τη σύνδεση...",
      olDone: "Συνδέθηκες. Πρόσθεσε αυτή τη μεταβλητή στις ρυθμίσεις του hosting:",
      olAfter: "Μετά κάνε Redeploy και ξαναφόρτωσε τη σελίδα. Τα token της Microsoft λήγουν σε περίπου 90 μέρες· επανάλαβε το βήμα όταν το mailbox σταματήσει να συνδέεται.",
      copy: "Αντιγραφή", copied: "Αντιγράφηκε",
      aiTitle: "Σύνδεσε το AI σου", aiIntro: "Αυτή είναι η διεύθυνση του connector σου:",
      ai1: "Claude: Settings > Connectors > Add custom connector και επικόλλησε τη διεύθυνση.",
      ai2: "ChatGPT: Settings > Connectors (developer mode), νέος connector με την ίδια διεύθυνση, χωρίς authentication.",
      ai3: "Οτιδήποτε άλλο υποστηρίζει remote MCP servers (Streamable HTTP) δέχεται την ίδια διεύθυνση.",
      secret: "Φύλαξε τη διεύθυνση σαν κωδικό: όποιος την έχει διαβάζει το mail σου. Για να την ακυρώσεις, άλλαξε το MCP_AUTH_TOKEN και κάνε Redeploy.",
      sendOff: "Η αποστολή είναι κλειστή: το AI μπορεί μόνο να αποθηκεύει πρόχειρα. Βάλε MAIL_ALLOW_SEND=true για να επιτρέψεις αποστολή.",
      sendOn: "Η αποστολή είναι ΑΝΟΙΧΤΗ: το AI μπορεί να στέλνει email από αυτά τα mailbox.",
      badEmail: "Γράψε πρώτα μια διεύθυνση Hotmail / Outlook.", other: "English"
    }
  };
  var lang = (navigator.language || "en").slice(0, 2) === "el" ? "el" : "en";
  var last = null;
  function $(id) { return document.getElementById(id); }
  function t(k) { return T[lang][k]; }
  function paint() {
    document.documentElement.lang = lang;
    var nodes = document.querySelectorAll("[data-t]");
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = t(nodes[i].getAttribute("data-t"));
    $("lang").textContent = t("other");
    if (last) render(last);
  }
  var base = location.pathname.replace(/\/+$/, "");
  var token = base.split("/").pop();
  $("url").textContent = location.origin + "/mcp/" + token;

  function api(action, body) {
    return fetch(base + "?action=" + action, body
      ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : { cache: "no-store" }
    ).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; });
    });
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function render(s) {
    last = s;
    var box = $("accounts");
    box.textContent = "";
    if (!s.accounts.length) box.appendChild(el("p", "dim", t("none")));
    s.accounts.forEach(function (a) {
      var row = el("div", "row " + (a.ok ? "ok" : "bad"));
      row.appendChild(el("span", "dot"));
      var g = el("div", "grow");
      g.appendChild(el("div", null, a.email));
      g.appendChild(el("div", "dim msg", a.ok
        ? a.id + " · " + a.provider + " · " + t("okMsg") + " · " + a.folders + " " + t("folders")
        : a.id + " · " + a.provider + " · " + a.error));
      row.appendChild(g);
      box.appendChild(row);
    });
    $("next").textContent = String(s.accounts.length + 1);
    $("olOn").hidden = !s.outlookReady;
    $("olOff").hidden = s.outlookReady;
    $("send").textContent = t(s.sendEnabled ? "sendOn" : "sendOff");
  }
  function check() {
    $("recheck").disabled = true;
    $("accounts").textContent = "";
    $("accounts").appendChild(el("p", "dim", t("checking")));
    api("status").then(render).catch(function (e) {
      $("accounts").textContent = "";
      $("accounts").appendChild(el("p", "bad", String(e.message || e)));
    }).then(function () { $("recheck").disabled = false; });
  }
  function copy(btn, text) {
    navigator.clipboard.writeText(text).then(function () {
      btn.textContent = t("copied");
      setTimeout(function () { btn.textContent = t("copy"); }, 1500);
    });
  }
  $("recheck").onclick = check;
  $("urlCopy").onclick = function () { copy($("urlCopy"), $("url").textContent); };
  $("olCopy").onclick = function () { copy($("olCopy"), $("olValue").textContent); };
  $("lang").onclick = function () { lang = lang === "el" ? "en" : "el"; paint(); };

  $("olGo").onclick = function () {
    var email = $("olEmail").value.trim();
    $("olErr").textContent = "";
    $("olDone").hidden = true;
    if (email.indexOf("@") < 1) { $("olErr").textContent = t("badEmail"); return; }
    $("olGo").disabled = true;
    api("outlook-start", {}).then(function (d) {
      $("olLink").href = d.verificationUri;
      $("olLink").textContent = d.verificationUri;
      $("olCode").textContent = d.userCode;
      $("olStep").hidden = false;
      var tries = 0;
      (function poll() {
        setTimeout(function () {
          api("outlook-poll", { deviceCode: d.deviceCode, email: email }).then(function (r) {
            if (!r.done) { if (++tries < 180) poll(); return; }
            $("olStep").hidden = true;
            $("olName").textContent = "MAIL_ACCOUNT_" + email.split("@")[0].toUpperCase().replace(/[^A-Z0-9]/g, "_");
            $("olValue").textContent = r.value;
            $("olDone").hidden = false;
            $("olGo").disabled = false;
          }).catch(fail);
        }, Math.max(5, d.interval) * 1000);
      })();
    }).catch(fail);
    function fail(e) {
      $("olStep").hidden = true;
      $("olErr").textContent = String(e.message || e);
      $("olGo").disabled = false;
    }
  };

  paint();
  check();
})();
</script>
</body>
</html>`;
