import { NextRequest, NextResponse } from "next/server";

import { getPortfolio } from "@/lib/portfolio";
import { getScannerOverview } from "@/lib/scanner";
import type { ScannerResponse, StrategyProfileId } from "@/lib/types";

function parseStrategy(value: string | null): StrategyProfileId {
  if (
    value === "momentum" ||
    value === "breakout" ||
    value === "mean-reversion" ||
    value === "rank-score"
  ) {
    return value;
  }

  return "rank-score";
}

export async function GET(request: NextRequest) {
  try {
    const refresh = request.nextUrl.searchParams.get("refresh") === "1";
    const strategy = parseStrategy(request.nextUrl.searchParams.get("strategy"));
    const portfolio = await getPortfolio();
    const scanner: ScannerResponse = await getScannerOverview(
      {
        cash: portfolio.cash,
        equity: portfolio.equity,
      },
      refresh,
      strategy,
    );

    return NextResponse.json(scanner);
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Tarama verisi olusturulamadi.",
      },
      { status: 500 },
    );
  }
}
