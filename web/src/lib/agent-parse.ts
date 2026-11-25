import type { MarketToken } from "./market";
import { findIn } from "./tokens";

type Token = MarketToken;

/**
 * Turns a short order sentence into a structured order, with plain rules (no AI model yet).
 * Understands: "buy $20 of MOW if it drops 10%", "sell 0.1 eth of CDOG when up 25%", "buy 50 PONS".
 */
export type ParsedOrder = {
  side: "buy" | "sell";
  amount: number;
  unit: "USD" | "ETH" | "token";
  token: Token;
  trigger: { direction: "drops" | "rises"; percent: number } | null;
};

export type ParseResult = { ok: true; order: ParsedOrder } | { ok: false; reason: string };

export function parseOrder(text: string, tokens: MarketToken[]): ParseResult {
  const input = text.trim();
  const side = /\b(buy|sell)\b/i.exec(input)?.[1]?.toLowerCase() as "buy" | "sell" | undefined;
  if (!side) return { ok: false, reason: "Start with buy or sell, for example: buy $20 of MOW if it drops 10%." };

  const amountMatch = /(\$)?\s*(\d+(?:\.\d+)?)\s*(eth|usd|dollars?)?/i.exec(input.slice(input.toLowerCase().indexOf(side) + side.length));
  if (!amountMatch) return { ok: false, reason: "How much? Add an amount like $20 or 0.05 ETH." };
  const amount = Number(amountMatch[2]);
  const unitWord = amountMatch[3]?.toLowerCase();
  const unit: ParsedOrder["unit"] = amountMatch[1] || unitWord?.startsWith("usd") || unitWord?.startsWith("dollar") ? "USD" : unitWord === "eth" ? "ETH" : "token";

  // The token is the first word that matches a known symbol (case-insensitive).
  // Skip order words so a token called "buy" or "if" cannot match by accident.
  const STOP = new Set(["buy", "sell", "of", "if", "when", "it", "is", "up", "down", "eth", "usd", "at", "the"]);
  const words = input.split(/[^a-zA-Z0-9]+/).filter((word) => word && !STOP.has(word.toLowerCase()));
  const token = words.map((word) => findIn(tokens, word)).find((found): found is Token => Boolean(found));
  if (!token) return { ok: false, reason: "I could not find that token in the live lists. Use its symbol, like NVDA, or its contract address." };

  const triggerMatch = /\b(drops?|falls?|dips?|down|rises?|pumps?|up)\b\D{0,12}(\d+(?:\.\d+)?)\s*%/i.exec(input);
  const trigger = triggerMatch
    ? { direction: /^(rise|rises|pump|pumps|up)$/i.test(triggerMatch[1]) ? ("rises" as const) : ("drops" as const), percent: Number(triggerMatch[2]) }
    : null;

  return { ok: true, order: { side, amount, unit, token, trigger } };
}
