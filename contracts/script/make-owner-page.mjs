// Writes contracts/deploy/owner.html for the latest epoch in claims/epochs/: the owner's weekly page.
//   1. Fund: send the missing USDG to the claims contract (from any wallet that holds USDG).
//   2. Post: call setRoot(root, total) from the owner wallet (the fee wallet).
// The page only asks the connected wallet to send these two transactions; it holds no keys.
// Run after `node scripts/claims-epoch.mjs --write`:  node contracts/script/make-owner-page.mjs
// Serve: python -m http.server 8791 --directory contracts/deploy  →  http://localhost:8791/owner.html
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const CLAIMS = "0xDc19CA2F0110D129CB9cC7CBc990A7f614A5e53A";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const OWNER = "0xD38ffFABf5087489ae1486c7Aa9B6a993c819f37";

const dir = new URL("../../claims/epochs/", import.meta.url);
const latest = readdirSync(dir).filter((f) => /^epoch-\d+\.json$/.test(f)).sort().at(-1);
if (!latest) throw new Error("No epoch file; run scripts/claims-epoch.mjs --write first");
const epoch = JSON.parse(readFileSync(new URL(latest, dir), "utf8"));

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Veul claims: owner, epoch ${epoch.epoch}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #000; color: #f7f6f3; font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 680px; margin: 48px auto; padding: 0 20px; display: grid; gap: 18px; }
  h1 { margin: 0; font-size: 28px; letter-spacing: -0.03em; }
  h2 { margin: 8px 0 0; font-size: 17px; }
  p { margin: 0; color: #9a9993; }
  code { font: 12px ui-monospace, monospace; word-break: break-all; }
  button { padding: 10px 16px; border-radius: 8px; border: 0; background: #f7f6f3; color: #000; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: 0.4; cursor: default; }
  #log { white-space: pre-wrap; padding: 12px; border-radius: 8px; background: #0f0f0e; border: 1px solid #262624; min-height: 80px; font: 12px ui-monospace, monospace; }
  dl { display: grid; grid-template-columns: 110px 1fr; gap: 4px 12px; margin: 0; } dt { color: #9a9993; } dd { margin: 0; }
</style></head>
<body><main>
  <h1>Weekly claims, epoch ${epoch.epoch}</h1>
  <dl>
    <dt>Contract</dt><dd><code>${CLAIMS}</code></dd>
    <dt>Root</dt><dd><code>${epoch.root}</code></dd>
    <dt>Total</dt><dd>${Number(epoch.totalUsdg) / 1e6} USDG cumulative (${epoch.claims.length} wallet${epoch.claims.length === 1 ? "" : "s"})</dd>
    <dt>Owner</dt><dd><code>${OWNER}</code> (step 2 must be signed by this wallet)</dd>
  </dl>
  <div><button id="connect">Connect wallet</button></div>
  <h2>1. Fund the contract</h2>
  <p>Sends exactly the USDG still missing (contract balance + paid so far must cover the total). Any wallet with USDG can do this.</p>
  <div><button id="fund" disabled>Send missing USDG</button></div>
  <h2>2. Post the root</h2>
  <p>setRoot(root, total). The contract refuses it if step 1 is not done.</p>
  <div><button id="post" disabled>Post root (owner)</button></div>
  <div id="log">Not connected.</div>
</main>
<script>
const CLAIMS = "${CLAIMS}", USDG = "${USDG}", OWNER = "${OWNER}".toLowerCase();
const ROOT = "${epoch.root}", TOTAL = BigInt("${epoch.totalUsdg}");
const CHAIN = "0x1237";
const log = (t) => { document.getElementById("log").textContent += "\\n" + t; };
const hex = (n, bytes = 32) => n.toString(16).padStart(bytes * 2, "0");
const word = (a) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const call = (to, data) => window.ethereum.request({ method: "eth_call", params: [{ to, data }, "latest"] }).then(BigInt);
let account = null;

async function missing() {
  const balance = await call(USDG, "0x70a08231" + word(CLAIMS));       // balanceOf(contract)
  const paid = await call(CLAIMS, "0xd54ad2a1");                         // totalClaimed()
  return TOTAL > balance + paid ? TOTAL - balance - paid : 0n;
}

async function send(to, data) {
  const hash = await window.ethereum.request({ method: "eth_sendTransaction", params: [{ from: account, to, data }] });
  log("Sent " + hash + ", waiting…");
  for (let i = 0; i < 90; i++) {
    const r = await window.ethereum.request({ method: "eth_getTransactionReceipt", params: [hash] });
    if (r) { log(r.status === "0x1" ? "Confirmed." : "Failed onchain."); return r.status === "0x1"; }
    await new Promise((s) => setTimeout(s, 2000));
  }
  log("No receipt after 3 minutes.");
  return false;
}

document.getElementById("connect").onclick = async () => {
  if (!window.ethereum) return log("No wallet found. Open this page in the browser that has Rabby.");
  [account] = await window.ethereum.request({ method: "eth_requestAccounts" });
  await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN }] });
  await refresh();
};

// Enables only the step that can succeed from this wallet: funding needs enough USDG here; posting needs the owner
// and a fully funded contract (setRoot refuses an underfunded root).
async function refresh() {
  const need = await missing();
  const mine = await call(USDG, "0x70a08231" + word(account));
  const isOwner = account.toLowerCase() === OWNER;
  const lines = ["Connected " + account + (isOwner ? " (owner)" : " (not the owner)"),
    "This wallet holds " + Number(mine) / 1e6 + " USDG. The contract still needs " + Number(need) / 1e6 + " USDG."];
  if (need > 0n) lines.push(mine < need ? "Step 1: switch to a wallet that holds USDG (this one does not have enough)." : "Step 1 is ready: send the USDG.");
  else lines.push("Step 1 is done.", isOwner ? "Step 2 is ready: post the root." : "Step 2: switch to the owner wallet.");
  document.getElementById("log").textContent = lines.join("\\n");
  document.getElementById("fund").disabled = need === 0n || mine < need;
  document.getElementById("post").disabled = !isOwner || need > 0n;
}

// Rabby switches accounts without a reload; follow it.
window.ethereum?.on?.("accountsChanged", async (accounts) => {
  account = accounts[0];
  if (account) await refresh();
});

document.getElementById("fund").onclick = async () => {
  const need = await missing();
  if (need === 0n) return log("Nothing missing.");
  log("Sending " + Number(need) / 1e6 + " USDG to the contract…");
  await send(USDG, "0xa9059cbb" + word(CLAIMS) + hex(need));
  await refresh();
};

document.getElementById("post").onclick = async () => {
  log("Posting root…");
  if (await send(CLAIMS, "0xedbe2a21" + ROOT.slice(2) + hex(TOTAL))) log("Root posted. Claims for epoch ${epoch.epoch} are open in the app.");
  await refresh();
};
</script>
</body></html>
`;

writeFileSync(new URL("../deploy/owner.html", import.meta.url), html);
console.log(`wrote deploy/owner.html for epoch ${epoch.epoch}`);
