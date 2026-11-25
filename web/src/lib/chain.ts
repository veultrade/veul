import { defineChain } from "viem";

/**
 * Robinhood Chain mainnet (chain id 4663) for Privy's embedded wallets.
 * The public RPC is fine in the browser for the preview; the app's server reads will use our own RPC (session 1.3).
 */
export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
});
