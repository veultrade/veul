"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatPrice } from "@/lib/tokens";
import { parseOrder, type ParsedOrder } from "@/lib/agent-parse";
import { useBag } from "./BagStore";
import { useMarket } from "./MarketProvider";
import { CopyButton } from "./CopyButton";
import screens from "./Screens.module.css";
import styles from "./Features.module.css";

// Package name and key format are placeholders until the API exists.
const MCP_CONFIG = `{
  "mcpServers": {
    "veul": {
      "command": "npx",
      "args": ["-y", "@veul/mcp"],
      "env": { "VEUL_API_KEY": "sk_live_..." }
    }
  }
}`;

const TOOLS = ["get_quote", "swap", "risk_check", "get_bag", "set_payback_stock"];
const EXAMPLES = ["Buy $20 of NVDA if it drops 5%", "Sell 0.05 ETH of TSLA when it is up 10%", "Buy $50 of SPY"];

type Message = { id: number; from: "me" | "bot"; text: string; order?: ParsedOrder };

function describeAmount(order: ParsedOrder) {
  if (order.unit === "USD") return `$${order.amount}`;
  if (order.unit === "ETH") return `${order.amount} ETH`;
  return `${order.amount} ${order.token.symbol}`;
}

/**
 * Agents: (1) connect your own AI agent through MCP or the API and still earn stock paybacks,
 * (2) a chat that turns a sentence into a conditional order. Preview only: nothing is placed or signed.
 */
export function AgentsScreen() {
  const bag = useBag();
  const market = useMarket();
  const [messages, setMessages] = useState<Message[]>([
    { id: 0, from: "bot", text: "Tell me what to trade and when. I turn it into an order you can check before anything runs." },
  ]);
  const [draft, setDraft] = useState("");
  const chat = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chat.current?.scrollTo({ top: chat.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    const result = parseOrder(clean, market.all);
    setMessages((list) => {
      const id = list.length;
      const reply: Message = result.ok
        ? { id: id + 1, from: "bot", text: "Here is the order I understood. In the live app you confirm it once, then it runs on its own.", order: result.order }
        : { id: id + 1, from: "bot", text: result.reason };
      return [...list, { id, from: "me", text: clean }, reply];
    });
    setDraft("");
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    send(draft);
  };

  return (
    <div className={screens.page}>
      <header className={screens.title}>
        <h1>Agents</h1>
        <p>Let an AI agent trade for you, through Veul. Every agent trade still pays you back in stock.</p>
      </header>

      <section className={styles.panel} aria-labelledby="chat-title">
        <div className={styles.panelHead}>
          <h2 id="chat-title">Order agent</h2>
          <span className={`mono ${styles.tag}`}>Preview · nothing runs</span>
        </div>
        <div className={styles.chat} ref={chat} aria-live="polite">
          {messages.map((message) => (
            <div key={message.id} className={`${styles.msg} ${message.from === "me" ? styles.me : styles.bot}`}>
              {message.text}
              {message.order && (
                <dl className={styles.order}>
                  <div>
                    <dt>Action</dt>
                    <dd>
                      {message.order.side === "buy" ? "Buy" : "Sell"} {describeAmount(message.order)} {message.order.unit !== "token" ? `of ${message.order.token.symbol}` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt>When</dt>
                    <dd>
                      {message.order.trigger
                        ? `price ${message.order.trigger.direction === "drops" ? "drops" : "rises"} ${message.order.trigger.percent}% from ${formatPrice(message.order.token.priceUsd)}`
                        : "now, at market"}
                    </dd>
                  </div>
                  <div>
                    <dt>Payback</dt>
                    <dd className={styles.gold}>0.25% as {bag.ticker}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd className="mono">Not placed (preview)</dd>
                  </div>
                </dl>
              )}
            </div>
          ))}
        </div>
        <div className={styles.chips}>
          {EXAMPLES.map((example) => (
            <button key={example} type="button" onClick={() => send(example)}>
              {example}
            </button>
          ))}
        </div>
        <form className={styles.composer} onSubmit={submit}>
          <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Buy $20 of NVDA if it drops 5%" aria-label="Order in your words" />
          <button className="btn btn-main" disabled={!draft.trim()}>
            Send
          </button>
        </form>
      </section>

      <div className={styles.grid2}>
        <section className={styles.panel} aria-labelledby="mcp-title">
          <div className={styles.panelHead}>
            <h2 id="mcp-title">Connect your AI agent</h2>
            <span className={`mono ${styles.tag}`}>Coming soon</span>
          </div>
          <p>Add Veul to Claude, Cursor or any MCP client. Your agent can quote, check risk and swap on Robinhood Chain; the paybacks land in your stock bag.</p>
          <pre className={styles.code}>{MCP_CONFIG}</pre>
          <div className={styles.chips}>
            {TOOLS.map((tool) => (
              <span key={tool}>{tool}</span>
            ))}
          </div>
          <div>
            <CopyButton value={MCP_CONFIG} label="Copy config" />
          </div>
        </section>

        <section className={styles.panel} aria-labelledby="api-title">
          <div className={styles.panelHead}>
            <h2 id="api-title">API keys</h2>
            <span className={`mono ${styles.tag}`}>Coming soon</span>
          </div>
          <p>For bots and scripts. Each key has its own spending limit per day and can only trade from your Veul wallet. You can revoke a key any time.</p>
          <ul className={styles.list}>
            <li>
              <span className={styles.grow}>
                <strong>No keys yet</strong>
                <small>Keys are created once the API is live.</small>
              </span>
            </li>
          </ul>
          <button type="button" className="btn btn-quiet" disabled>
            Create key
          </button>
        </section>
      </div>
    </div>
  );
}
