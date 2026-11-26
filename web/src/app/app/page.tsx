import { MarketsScreen } from "@/components/app/MarketsScreen";

// ?token=<address or symbol> (from links and the landing) opens that token's drawer and ticket.
export default async function MarketsPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  const initial = Array.isArray(token) ? token[0] : token;
  return <MarketsScreen initialToken={initial} />;
}
