// Writes contracts/deploy/setup.html: the owner's page for VeulClaimsV3 after its deploy.
//   1. Set the poster (scripts/make-poster-key.mjs printed its address).
//   2. Set the poster's limits (most USDG one root may add, least hours between its roots).
//   3. Set the payout budget (most USDG paid out per 24 hours, all claims together). No claims before this.
//   4. Pause v2 and move its USDG back to the owner wallet (v3 subtracts what v1 and v2 paid).
//   5. Fund v3 with USDG.
//   6. Post an owner root: the first root, or one over the poster's cap. The daily job stores it and returns the
//      setRoot calldata; pass it as the second argument so the page fills it in.
// The page reads the contracts to show what is done, and only asks the connected wallet to send transactions; it
// holds no keys. Run: node contracts/script/make-setup-page.mjs <v3 address> [setRoot calldata], then serve on 8791.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../web/package.json", import.meta.url));
const { toFunctionSelector } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const V1 = "0xDc19CA2F0110D129CB9cC7CBc990A7f614A5e53A";
const V2 = "0x225a42c80e3dad180067e02461de7149ebad951f";
const V3 = /^0x[0-9a-fA-F]{40}$/.test(process.argv[2] ?? "") ? process.argv[2] : "";
const ROOT_CALL = /^0x[0-9a-fA-F]{136}$/.test(process.argv[3] ?? "") ? process.argv[3] : "";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const OWNER = "0xD38ffFABf5087489ae1486c7Aa9B6a993c819f37";
const keyFile = new URL("../../web/.poster-key", import.meta.url);
const POSTER = existsSync(keyFile) ? privateKeyToAccount(readFileSync(keyFile, "utf8").trim()).address : "";

const S = Object.fromEntries(
  Object.entries({
    setPoster: "setPoster(address)",
    setLimits: "setLimits(uint256,uint64)",
    setPayoutLimit: "setPayoutLimit(uint256,uint64)",
    setPaused: "setPaused(bool)",
    rescue: "rescue(address,address,uint256)",
    transfer: "transfer(address,uint256)",
    balanceOf: "balanceOf(address)",
    owner: "owner()",
    poster: "poster()",
    maxIncrease: "maxIncrease()",
    minInterval: "minInterval()",
    maxPayout: "maxPayout()",
    payoutWindow: "payoutWindow()",
    paused: "paused()",
    rootTotal: "rootTotal()",
    totalClaimed: "totalClaimed()",
  }).map(([name, signature]) => [name, toFunctionSelector(signature)]),
);

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Veul claims v3: setup</title>
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
  #status, #log { white-space: pre-wrap; padding: 12px 14px; border-radius: 14px; background: #131313; border: 1px solid #242424; font: 12px ui-monospace, monospace; }
</style></head>
<body><main>
  <h1>Daily claims v3 setup</h1>
  <p>Steps 1 to 4 must be signed by the owner wallet <code>${OWNER}</code>; step 5 by any wallet that holds USDG.</p>
  <label>VeulClaimsV3 address (from the deploy page)<input id="v3" value="${V3}" placeholder="0x…"></label>
  <div><button id="connect">Connect wallet</button></div>
  <div id="status">Not connected.</div>

  <h2>1. Set the poster</h2>
  <p>The server key that posts the daily root. It can do nothing else.</p>
  <label>Poster address<input id="poster" value="${POSTER}"></label>
  <div><button id="setPoster" disabled>Set poster (owner)</button></div>

  <h2>2. Set the poster's limits</h2>
  <p>How much one root may add, and how often the poster may post.</p>
  <div class="row">
    <label>Most USDG one root may add<input id="cap" value="25"></label>
    <label>Least hours between its roots<input id="hours" value="20"></label>
  </div>
  <div><button id="setLimits" disabled>Set limits (owner)</button></div>

  <h2>3. Set the payout budget</h2>
  <p>The most USDG all claims together may take per window. This is what bounds a loss if the poster key or a root is ever wrong. No claims are possible until it is set.</p>
  <div class="row">
    <label>Most USDG paid out per window<input id="budget" value="25"></label>
    <label>Window in hours<input id="window" value="24"></label>
  </div>
  <div><button id="setPayout" disabled>Set payout budget (owner)</button></div>

  <h2>4. Retire v2</h2>
  <p>Pause v2 <code>${V2}</code>, then move its spare USDG back to the owner wallet. v3 subtracts what v2 already paid.</p>
  <div><button id="pauseV2" disabled>Pause v2 (owner)</button> <button id="rescueV2" disabled>Move v2's USDG to owner</button></div>

  <h2>5. Fund v3</h2>
  <p>USDG for the paybacks. Keep it to a few days of paybacks at a time.</p>
  <label>USDG to send<input id="fund" value="1"></label>
  <div><button id="sendFund" disabled>Send USDG</button></div>

  <h2>6. Post the owner root</h2>
  <p>The first root, or one over the poster's cap. The daily job built and stored it; this sends its setRoot from the owner wallet.</p>
  <label>setRoot calldata<input id="rootCall" value="${ROOT_CALL}" placeholder="0x…"></label>
  <div><button id="postRoot" disabled>Post root (owner)</button></div>

  <div id="log">Log</div>
</main>
<script>
const V1 = "${V1}", V2 = "${V2}", USDG = "${USDG}", OWNER = "${OWNER}".toLowerCase();
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
const usdg = (n) => Number(n) / 1e6;
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

async function v2Spare() {
  const [balance, rootTotal, claimed] = await Promise.all([big(USDG, S.balanceOf + word(V2)), big(V2, S.rootTotal), big(V2, S.totalClaimed)]);
  const owed = rootTotal > claimed ? rootTotal - claimed : 0n;
  return balance > owed ? balance - owed : 0n;
}

// Reads the contracts and enables only the steps that can succeed from this wallet.
async function refresh() {
  if (!account) return;
  const v3 = $("v3").value.trim();
  const isOwner = account.toLowerCase() === OWNER;
  const lines = ["Connected " + account + (isOwner ? " (owner)" : " (not the owner)")];
  const mine = await big(USDG, S.balanceOf + word(account));
  lines.push("This wallet holds " + usdg(mine) + " USDG.");
  const [v1Paused, v2Paused, spare] = await Promise.all([big(V1, S.paused), big(V2, S.paused), v2Spare()]);
  if (isAddress(v3)) {
    const [owner, poster, cap, interval, maxPayout, window_, balance] = await Promise.all([
      call(v3, S.owner), call(v3, S.poster), big(v3, S.maxIncrease), big(v3, S.minInterval), big(v3, S.maxPayout), big(v3, S.payoutWindow),
      big(USDG, S.balanceOf + word(v3)),
    ]);
    const ownerAddress = "0x" + owner.slice(-40);
    const posterAddress = "0x" + poster.slice(-40);
    const wanted = $("poster").value.trim().toLowerCase();
    lines.push("v3 owner " + ownerAddress + (ownerAddress.toLowerCase() === OWNER ? "" : "  (NOT the expected owner!)"));
    lines.push((posterAddress.toLowerCase() === wanted && wanted ? "done" : "todo") + "  1. poster " + posterAddress);
    lines.push((cap > 0n && interval > 0n ? "done" : "todo") + "  2. limits " + usdg(cap) + " USDG per root, " + Number(interval) / 3600 + " h");
    lines.push((maxPayout > 0n ? "done" : "todo") + "  3. payout budget " + usdg(maxPayout) + " USDG per " + Number(window_) / 3600 + " h");
    lines.push((balance > 0n ? "done" : "todo") + "  5. v3 holds " + usdg(balance) + " USDG");
    $("setPoster").disabled = !isOwner || !isAddress(wanted);
    $("setLimits").disabled = !isOwner;
    $("setPayout").disabled = !isOwner;
    $("sendFund").disabled = mine === 0n;
    $("postRoot").disabled = !isOwner || !/^0x[0-9a-fA-F]{136}$/.test($("rootCall").value.trim());
  } else {
    lines.push("Paste the VeulClaimsV3 address above.");
  }
  lines.push((v2Paused === 1n && spare === 0n ? "done" : "todo") + "  4. v2 " + (v2Paused === 1n ? "paused" : "open") + ", spare USDG " + usdg(spare) + " (v1 " + (v1Paused === 1n ? "paused" : "OPEN") + ")");
  $("pauseV2").disabled = !isOwner || v2Paused === 1n;
  $("rescueV2").disabled = !isOwner || spare === 0n;
  $("status").textContent = lines.join("\\n");
}

$("connect").onclick = async () => {
  if (!window.ethereum) return log("No wallet found. Open this page in the browser that has Rabby.");
  [account] = await window.ethereum.request({ method: "eth_requestAccounts" });
  await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN }] });
  await refresh();
};
window.ethereum?.on?.("accountsChanged", async (accounts) => { account = accounts[0]; await refresh(); });
for (const id of ["v3", "poster"]) $(id).addEventListener("change", refresh);

$("setPoster").onclick = async () => {
  const poster = $("poster").value.trim();
  if (!isAddress(poster)) return log("The poster must be a 0x address.");
  await send($("v3").value.trim(), S.setPoster + word(poster));
  await refresh();
};
$("setLimits").onclick = async () => {
  const cap = units($("cap").value);
  const seconds = BigInt(Math.round(Number($("hours").value) * 3600));
  if (cap <= 0n || seconds <= 0n) return log("Both limits must be above zero.");
  await send($("v3").value.trim(), S.setLimits + num(cap) + num(seconds));
  await refresh();
};
$("setPayout").onclick = async () => {
  const budget = units($("budget").value);
  const seconds = BigInt(Math.round(Number($("window").value) * 3600));
  if (budget <= 0n || seconds < 3600n) return log("The budget must be above zero and the window at least 1 hour.");
  await send($("v3").value.trim(), S.setPayoutLimit + num(budget) + num(seconds));
  await refresh();
};
$("pauseV2").onclick = async () => { await send(V2, S.setPaused + num(1)); await refresh(); };
$("rescueV2").onclick = async () => {
  const spare = await v2Spare();
  if (spare === 0n) return log("v2 has no spare USDG.");
  log("Moving " + usdg(spare) + " USDG from v2 to the owner wallet…");
  await send(V2, S.rescue + word(USDG) + word(OWNER) + num(spare));
  await refresh();
};
$("postRoot").onclick = async () => {
  const data = $("rootCall").value.trim();
  if (!data.startsWith("${toFunctionSelector("setRoot(bytes32,uint256)")}")) return log("That is not a setRoot call.");
  if (await send($("v3").value.trim(), data)) log("Root posted. Claims for this root are open in the app.");
  await refresh();
};
$("sendFund").onclick = async () => {
  const amount = units($("fund").value);
  if (amount <= 0n) return log("Enter an amount.");
  log("Sending " + usdg(amount) + " USDG to v3…");
  await send(USDG, S.transfer + word($("v3").value.trim()) + num(amount));
  await refresh();
};
</script>
</body></html>
`;

writeFileSync(new URL("../deploy/setup.html", import.meta.url), html);
console.log(`wrote deploy/setup.html${V3 ? ` for v3 ${V3}` : " (no v3 address yet: pass it as the first argument)"}`);
