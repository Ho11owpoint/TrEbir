import { NextRequest, NextResponse } from "next/server";

import { createEmptyEventIntelligence, getStockEventIntelligence } from "@/lib/events";
import { getMarketSnapshot } from "@/lib/market";
import { getBistUniverse } from "@/lib/universe";
import type { StockDetailResponse } from "@/lib/types";

function normalizeSymbol(symbol: string) {
  const value = symbol.trim().toUpperCase();
  return value.endsWith(".IS") ? value : `${value}.IS`;
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ symbol: string }> },
) {
  try {
    const { symbol } = await context.params;

    if (!symbol || !symbol.trim()) {
      return NextResponse.json(
        {
          message: "Gecerli bir sembol gerekli.",
        },
        { status: 400 },
      );
    }

    const normalizedSymbol = normalizeSymbol(symbol);
    const [snapshot, universe] = await Promise.all([
      getMarketSnapshot(normalizedSymbol),
      getBistUniverse(),
    ]);
    const company =
      universe.find((item) => item.symbol === normalizedSymbol) ??
      universe.find((item) => item.displaySymbol === snapshot.displaySymbol) ??
      null;
    const eventIntelligence = company
      ? await getStockEventIntelligence(company)
      : createEmptyEventIntelligence({
          symbol: snapshot.symbol,
          displaySymbol: snapshot.displaySymbol,
          companyName: snapshot.displaySymbol,
        });
    const response: StockDetailResponse = {
      snapshot,
      company,
      eventIntelligence,
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Hisse detayi olusturulamadi.",
      },
      { status: 500 },
    );
  }
}
