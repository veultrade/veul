// Writes contracts/deploy/deploy.html: a one-page tool that deploys VeulClaims from the owner's own browser
// wallet (Rabby, MetaMask). Nobody but the person clicking holds a key; the page only asks the wallet to send the
// deploy transaction. Rebuild after `forge build`:  node script/make-deploy-page.mjs
// Then serve it locally (python -m http.server 8791 --directory deploy) and open http://localhost:8791/deploy.html.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const artifact = JSON.parse(readFileSync(new URL("../out/VeulClaims.sol/VeulClaims.json", import.meta.url), "utf8"));
const bytecode = artifact.bytecode.object;

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const ROUTER = "0x8876789976dEcBfCbBbe364623C63652db8C0904";
const DEFAULT_OWNER = "0xD38ffFABf5087489ae1486c7Aa9B6a993c819f37"; // the fee wallet

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Deploy VeulClaims</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #000; color: #f7f6f3; font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 640px; margin: 48px auto; padding: 0 20px; display: grid; gap: 16px; }
  h1 { margin: 0; font-size: 28px; letter-spacing: -0.03em; }
  p { margin: 0; color: #9a9993; }
  code, input { font: 13px ui-monospace, monospace; }
  input { width: 100%; box-sizing: border-box; padding: 10px; border-radius: 8px; border: 1px solid #363633; background: #161615; color: inherit; }
  button { padding: 10px 16px; border-radius: 8px; border: 0; background: #f7f6f3; color: #000; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: 0.4; cursor: default; }
  #log { white-space: pre-wrap; padding: 12px; border-radius: 8px; background: #0f0f0e; border: 1px solid #262624; min-height: 80px; font: 12px ui-monospace, monospace; }
  dl { display: grid; grid-template-columns: 90px 1fr; gap: 4px 12px; margin: 0; } dt { color: #9a9993; } dd { margin: 0; word-break: break-all; }
</style></head>
<body><main>
  <h1>Deploy VeulClaims</h1>
  <p>Robinhood Chain mainnet (4663). Your wallet signs one transaction that creates the claims contract. Nothing is sent but gas.</p>
  <dl>
    <dt>USDG</dt><dd><code>${USDG}</code></dd>
    <dt>Router</dt><dd><code>${ROUTER}</code> (Uniswap Universal Router)</dd>
    <dt>Bytecode</dt><dd>${(bytecode.length - 2) / 2} bytes, built from contracts/src/VeulClaims.sol</dd>
  </dl>
  <label>Owner (posts the weekly root, can pause; cannot take claimable USDG)
    <input id="owner" value="${DEFAULT_OWNER}">
  </label>
  <div><button id="connect">Connect wallet</button> <button id="deploy" disabled>Deploy</button></div>
  <div id="log">Not connected.</div>
</main>
<script>
const BYTECODE = "${bytecode}";
const USDG = "${USDG}";
const ROUTER = "${ROUTER}";
const CHAIN = "0x1237"; // 4663
const log = (text) => { document.getElementById("log").textContent += "\\n" + text; };
const word = (address) => address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
let account = null;

document.getElementById("connect").onclick = async () => {
  if (!window.ethereum) return log("No wallet found. Open this page in the browser that has Rabby.");
  [account] = await window.ethereum.request({ method: "eth_requestAccounts" });
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN }] });
  } catch (error) {
    if (error.code !== 4902) throw error;
    await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{ chainId: CHAIN, chainName: "Robinhood Chain",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://app.veul.trade/api/rpc"], blockExplorerUrls: ["https://robinhoodchain.blockscout.com"] }] });
  }
  const chain = await window.ethereum.request({ method: "eth_chainId" });
  document.getElementById("log").textContent = "Connected " + account + " on chain " + parseInt(chain, 16);
  document.getElementById("deploy").disabled = chain !== CHAIN;
};

document.getElementById("deploy").onclick = async () => {
  const owner = document.getElementById("owner").value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) return log("Owner must be a 0x address.");
  const data = BYTECODE + word(USDG) + word(ROUTER) + word(owner);
  log("Asking your wallet to sign the deploy…");
  const hash = await window.ethereum.request({ method: "eth_sendTransaction", params: [{ from: account, data }] });
  log("Sent: " + hash + "\\nWaiting for the receipt…");
  for (let i = 0; i < 90; i++) {
    const receipt = await window.ethereum.request({ method: "eth_getTransactionReceipt", params: [hash] });
    if (receipt) {
      log(receipt.status === "0x1" ? "Deployed at " + receipt.contractAddress + "\\nSend this address back to Claude." : "The deploy failed onchain.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  log("No receipt after 3 minutes; check the transaction on robinhoodchain.blockscout.com.");
};
</script>
</body></html>
`;

mkdirSync(new URL("../deploy/", import.meta.url), { recursive: true });
writeFileSync(new URL("../deploy/deploy.html", import.meta.url), html);
console.log(`wrote deploy/deploy.html (${(bytecode.length - 2) / 2} bytes of bytecode)`);
