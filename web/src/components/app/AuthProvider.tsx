"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { createWalletClient, custom, defineChain, type WalletClient } from "viem";
import { robinhoodChain } from "@/lib/chain";

/**
 * Login through Privy (email, Google or an existing wallet; email and Google users get an embedded wallet).
 * The App ID is public and comes from NEXT_PUBLIC_PRIVY_APP_ID (web/.env.local, and the build environment).
 * Without it the app still renders, and the login button explains what is missing.
 *
 * Wallet calls go through our /api/rpc (Alchemy behind it): the public Robinhood Chain RPC rate-limits and is
 * blocked by some ISPs. walletClient() returns a viem client for the logged-in wallet on Robinhood Chain.
 */
type Auth = {
  configured: boolean;
  ready: boolean;
  authenticated: boolean;
  address: string | null;
  label: string | null;
  login: () => void;
  logout: () => void;
  walletClient: () => Promise<WalletClient>;
};

const AuthContext = createContext<Auth | null>(null);
const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

function chainWithProxy() {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return origin ? defineChain({ ...robinhoodChain, rpcUrls: { default: { http: [`${origin}/api/rpc`] } } }) : robinhoodChain;
}

const noWallet = async (): Promise<WalletClient> => {
  throw new Error("Log in to use a wallet");
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const chain = useMemo(() => chainWithProxy(), []);
  if (!APP_ID) {
    const notConfigured: Auth = {
      configured: false,
      ready: true,
      authenticated: false,
      address: null,
      label: null,
      login: () => {},
      logout: () => {},
      walletClient: noWallet,
    };
    return <AuthContext.Provider value={notConfigured}>{children}</AuthContext.Provider>;
  }
  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        loginMethods: ["email", "google", "wallet"],
        appearance: { theme: "dark", accentColor: "#3AA0DB", walletChainType: "ethereum-only" },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        defaultChain: chain,
        supportedChains: [chain],
      }}
    >
      <PrivyBridge>{children}</PrivyBridge>
    </PrivyProvider>
  );
}

function PrivyBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const address = user?.wallet?.address ?? null;
  const label = user?.email?.address ?? user?.google?.email ?? (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : null);

  const walletClient = useCallback(async () => {
    const wallet = wallets.find((w) => address && w.address.toLowerCase() === address.toLowerCase()) ?? wallets[0];
    if (!wallet) throw new Error("No wallet is connected");
    await wallet.switchChain(robinhoodChain.id);
    const provider = await wallet.getEthereumProvider();
    return createWalletClient({ account: wallet.address as `0x${string}`, chain: robinhoodChain, transport: custom(provider) });
  }, [wallets, address]);

  const value: Auth = { configured: true, ready, authenticated, address, label, login, logout: () => void logout(), walletClient };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth must be used inside AuthProvider");
  return auth;
}
