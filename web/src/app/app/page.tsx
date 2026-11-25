import { SwapScreen } from "@/components/app/SwapScreen";

// ?token=<address or symbol> (from Discover) preselects the token.
export default async function SwapPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  const initial = Array.isArray(token) ? token[0] : token;
  return <SwapScreen key={initial ?? "default"} initialToken={initial} />;
}
