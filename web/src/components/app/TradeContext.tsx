"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { MarketToken } from "@/lib/market";

/**
 * What the trader has open, shared by every screen: the token in the trade dock (the ticket) and the token in the
 * detail drawer. Any row anywhere can open a drawer; the drawer's Trade button hands the token to the dock.
 * On phones the dock is a bottom sheet, so opening a ticket also raises the sheet.
 */
type Trade = {
  ticket: MarketToken | null;
  drawer: MarketToken | null;
  sheetOpen: boolean;
  openTicket: (token: MarketToken) => void;
  closeTicket: () => void;
  openDrawer: (token: MarketToken) => void;
  closeDrawer: () => void;
  setSheetOpen: (open: boolean) => void;
};

const TradeContext = createContext<Trade | null>(null);

export function TradeProvider({ children }: { children: ReactNode }) {
  const [ticket, setTicket] = useState<MarketToken | null>(null);
  const [drawer, setDrawer] = useState<MarketToken | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const openTicket = useCallback((token: MarketToken) => {
    setTicket(token);
    setDrawer(null);
    setSheetOpen(true);
  }, []);
  const closeTicket = useCallback(() => setTicket(null), []);
  const openDrawer = useCallback((token: MarketToken) => setDrawer(token), []);
  const closeDrawer = useCallback(() => setDrawer(null), []);

  const value = useMemo(
    () => ({ ticket, drawer, sheetOpen, openTicket, closeTicket, openDrawer, closeDrawer, setSheetOpen }),
    [ticket, drawer, sheetOpen, openTicket, closeTicket, openDrawer, closeDrawer],
  );
  return <TradeContext.Provider value={value}>{children}</TradeContext.Provider>;
}

export function useTrade(): Trade {
  const trade = useContext(TradeContext);
  if (!trade) throw new Error("useTrade must be used inside TradeProvider");
  return trade;
}
