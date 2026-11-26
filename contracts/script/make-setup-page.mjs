// Writes contracts/deploy/setup.html: the owner's page for VeulClaimsV2 after the deploy.
//   1. Set the poster (the address scripts/make-poster-key.mjs printed).
//   2. Set the poster's limits (most USDG one root may add, least hours between its roots).
//   3. Fund: send USDG to the contract (any wallet that holds USDG).
//   4. Pause v1, the weekly contract, so nothing is paid twice (v2 subtracts what v1 already paid).
// The page reads the contracts to show what is done, and only asks the connected wallet to send transactions; it
// holds no keys. Run: node contracts/script/make-setup-page.mjs, then serve contracts/deploy on localhost:8791.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../web/package.json", import.meta.url));
const { toFunctionSelector } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const V1 = "0xDc19CA2F0110D129CB9cC7CBc990A7f614A5e53A";
// VeulClaimsV2 on mainnet (deployed 2026-11-26, verified on Sourcify).
const V2 = "0x225a42c80e3dad180067e02461de7149ebad951f";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const OWNER = "0xD38ffFABf5087489ae1486c7Aa9B6a993c819f37";
const keyFile = new URL("../../web/.poster-key", import.meta.url);
const POSTER = existsSync(keyFile) ? privateKeyToAccount(readFileSync(keyFile, "utf8").trim()).address : "";

const sel = (signature) => toFunctionSelector(signature);
const S = {
  setPoster: sel("setPoster(address)"),
  setLimits: sel("setLimits(uint256,uint64)"),
  setPaused: sel("setPaused(bool)"),
  transfer: sel("transfer(address,uint256)"),
  balanceOf: sel("balanceOf(address)"),
  owner: sel("owner()"),
  poster: sel("poster()"),
  maxIncrease: sel("maxIncrease()"),
  minInterval: sel("minInterval()"),
  paused: sel("paused()"),
  rootTotal: sel("rootTotal()"),
  totalClaimed: sel("totalClaimed()"),
};

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Veul claims v2: setup</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #090909; color: #fcfcfc; font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 680px; margin: 48px auto; padding: 0 20px; display: grid; gap: 16px; }
  h1 { margin: 0; font-size: 30px; font-weight: 400; letter-spacing: -0.03em; }
  h2 { margin: 10px 0 0; font-size: 17px; font-weight: 500; }
  p { margin: 0; color: #b1b1b1; }
  code { font: 12px ui-monospace, monospace; word-break: break-all; }
  input { width: 100%; box-sizing: border-box; padding: 10px 14px; border-radius: 99px; border: 1px solid #2e2e2e; background: #131313; color: inherit; font: 13px ui-monospace, monospace; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  label { display: grid; gap: 6px; font-size: 13px; color: #b1b1b1; }
  button { padding: 10px 18px; border-radius: 99px; border: 0; background: #3aa0db; color: #04121b; font-weight: 500; cursor: pointer; }
  button:disabled { opacity: 0.4; cursor: default; }
  .done { color: #2fc27a; } .todo { color: #e8b04a; }
  #status, #log { white-space: pre-wrap; padding: 12px 14px; border-radius: 14px; background: #131313; border: 1px solid #242424; font: 12px ui-monospace, monospace; }
</style></head>
<body><main>
  <h1>Daily claims setup</h1>
  <p>For VeulClaimsV2 after its deploy. Steps 1, 2 and 4 must be signed by the owner wallet <code>${OWNER}</code>; step 3 by any wallet that holds USDG.</p>
  <label>VeulClaimsV2 address (from the deploy page)<input id="v2" value="${V2}" placeholder="0x…"></label>
  <div><button id="connect">Connect wallet</button></div>
  <div id="status">Not connected.</div>

  <h2>1. Set the poster</h2>
  <p>The server key that posts the daily root. It can do nothing else.</p>
  <label>Poster address<input id="poster" value="${POSTER}" placeholder="0x… from scripts/make-poster-key.mjs"></label>
  <div><button id="setPoster" disabled>Set poster (owner)</button></div>

  <h2>2. Set the poster's limits</h2>
  <p>A stolen poster key could misdirect at most this much per interval, until you pause.</p>
  <div class="row">
    <label>Most USDG one root may add<input id="cap" value="50"></label>
    <label>Least hours between its roots<input id="hours" value="20"></label>
  </div>
  <div><button id="setLimits" disabled>Set limits (owner)</button></div>

  <h2>3. Fund the contract</h2>
  <p>USDG for the paybacks. The daily root is refused while the contract holds too little; fund a few weeks ahead.</p>
  <label>USDG to send<input id="fund" value="20"></label>
  <div><button id="sendFund" disabled>Send USDG</button></div>

  <h2>4. Pause v1</h2>
  <p>The weekly contract <code>${V1}</code>. v2 subtracts what v1 already paid; pausing v1 stops it paying again.</p>
  <div><button id="pauseV1" disabled>Pause v1 (owner)</button></div>

  <div id="log">Log</div>
</main>
<script>
const V1 = "${V1}", USDG = "${USDG}", OWNER = "${OWNER}".toLowerCase();
const S = ${JSON.stringify(S)};
const CHAIN = "0x1237";
const $ = (id) => document.getElementById(id);
const log = (t) => { $("log").textContent += "\\n" + t; };
const word = (a) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const num = (n) => BigInt(n).toString(16).padStart(64, "0");
const isAddress = (a) => /^0x[0-9a-fA-F]{40}$/.test(a);
const call = (to, data) => window.ethereum.request({ method: "eth_call", params: [{ to, data }, "latest"] });
const big = async (to, data) => BigInt(await call(to, data));
const units = (text) => { const [w, f = ""] = String(text).trim().split("."); return BigInt(w || "0") * 1000000n + BigInt((f + "000000").slice(0, 6)); };
let account = null;

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

// Reads both contracts and enables only the steps that can succeed from this wallet.
async function refresh() {
  if (!account) return;
  const v2 = $("v2").value.trim();
  const isOwner = account.toLowerCase() === OWNER;
  const lines = ["Connected " + account + (isOwner ? " (owner)" : " (not the owner)")];
  const mine = await big(USDG, S.balanceOf + word(account));
  lines.push("This wallet holds " + Number(mine) / 1e6 + " USDG.");
  if (!isAddress(v2)) {
    lines.push("Paste the VeulClaimsV2 address above.");
  } else {
    const [owner, poster, cap, interval, balance, rootTotal, claimed] = await Promise.all([
      call(v2, S.owner), call(v2, S.poster), big(v2, S.maxIncrease), big(v2, S.minInterval),
      big(USDG, S.balanceOf + word(v2)), big(v2, S.rootTotal), big(v2, S.totalClaimed),
    ]);
    const posterAddress = "0x" + poster.slice(-40);
    const wanted = $("poster").value.trim().toLowerCase();
    lines.push("v2 owner: 0x" + owner.slice(-40) + ((("0x" + owner.slice(-40)).toLowerCase() === OWNER) ? "" : "  (not the expected owner!)"));
    lines.push((posterAddress.toLowerCase() === wanted && wanted ? "done" : "todo") + "  1. poster " + posterAddress);
    lines.push((cap > 0n && interval > 0n ? "done" : "todo") + "  2. limits " + Number(cap) / 1e6 + " USDG per root, " + Number(interval) / 3600 + " h between roots");
    lines.push((balance > 0n ? "done" : "todo") + "  3. contract holds " + Number(balance) / 1e6 + " USDG (posted total " + Number(rootTotal) / 1e6 + ", paid " + Number(claimed) / 1e6 + ")");
    $("setPoster").disabled = !isOwner || !isAddress(wanted);
    $("setLimits").disabled = !isOwner;
    $("sendFund").disabled = mine === 0n;
  }
  const v1Paused = BigInt(await call(V1, S.paused)) === 1n;
  lines.push((v1Paused ? "done" : "todo") + "  4. v1 " + (v1Paused ? "paused" : "still open"));
  $("pauseV1").disabled = !isOwner || v1Paused;
  $("status").textContent = lines.join("\\n");
}

$("connect").onclick = async () => {
  if (!window.ethereum) return log("No wallet found. Open this page in the browser that has Rabby.");
  [account] = await window.ethereum.request({ method: "eth_requestAccounts" });
  await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN }] });
  await refresh();
};
window.ethereum?.on?.("accountsChanged", async (accounts) => { account = accounts[0]; await refresh(); });
for (const id of ["v2", "poster"]) $(id).addEventListener("change", refresh);

$("setPoster").onclick = async () => {
  const poster = $("poster").value.trim();
  if (!isAddress(poster)) return log("The poster must be a 0x address.");
  await send($("v2").value.trim(), S.setPoster + word(poster));
  await refresh();
};
$("setLimits").onclick = async () => {
  const cap = units($("cap").value);
  const seconds = BigInt(Math.round(Number($("hours").value) * 3600));
  if (cap <= 0n || seconds <= 0n) return log("Both limits must be above zero.");
  await send($("v2").value.trim(), S.setLimits + num(cap) + num(seconds));
  await refresh();
};
$("sendFund").onclick = async () => {
  const amount = units($("fund").value);
  if (amount <= 0n) return log("Enter an amount.");
  log("Sending " + Number(amount) / 1e6 + " USDG to the contract…");
  await send(USDG, S.transfer + word($("v2").value.trim()) + num(amount));
  await refresh();
};
$("pauseV1").onclick = async () => {
  await send(V1, S.setPaused + num(1));
  await refresh();
};
</script>
</body></html>
`;

writeFileSync(new URL("../deploy/setup.html", import.meta.url), html);
console.log(`wrote deploy/setup.html${POSTER ? ` (poster ${POSTER})` : " (no poster key yet: run scripts/make-poster-key.mjs first)"}`);
