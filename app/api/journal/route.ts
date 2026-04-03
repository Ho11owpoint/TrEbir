import { NextRequest, NextResponse } from "next/server";

import { createTradeJournalEntry, getTradeJournal } from "@/lib/portfolio";
import type { TradeJournalCreatePayload, TradeJournalFilters } from "@/lib/types";

function parseFilters(request: NextRequest): TradeJournalFilters {
  const symbol = request.nextUrl.searchParams.get("symbol") ?? undefined;
  const strategy = request.nextUrl.searchParams.get("strategy") ?? undefined;
  const outcome = request.nextUrl.searchParams.get("outcome") ?? undefined;

  return {
    symbol,
    strategy,
    outcome:
      outcome === "planned" ||
      outcome === "open" ||
      outcome === "win" ||
      outcome === "loss" ||
      outcome === "flat" ||
      outcome === "cancelled"
        ? outcome
        : "all",
  };
}

export async function GET(request: NextRequest) {
  try {
    const response = await getTradeJournal(parseFilters(request));
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Trade journal okunamadi.",
      },
      { status: 400 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as TradeJournalCreatePayload;

    if (!payload.symbol) {
      return NextResponse.json(
        { message: "Journal olusturmak icin sembol zorunlu." },
        { status: 400 },
      );
    }

    const entry = await createTradeJournalEntry(payload);
    return NextResponse.json(entry);
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Trade journal kaydi olusturulamadi.",
      },
      { status: 400 },
    );
  }
}
