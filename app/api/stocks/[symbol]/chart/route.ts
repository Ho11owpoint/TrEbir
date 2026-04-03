import { NextRequest, NextResponse } from "next/server";

import { MarketDataError } from "@/lib/market-data";
import { getStockChartData, parseChartRange } from "@/lib/stock-chart";
import type { StockChartResponse } from "@/lib/types";

function normalizeSymbol(symbol: string) {
  const value = symbol.trim().toUpperCase();
  return value.endsWith(".IS") ? value : `${value}.IS`;
}

function getChartErrorStatus(error: unknown) {
  if (!(error instanceof MarketDataError)) {
    return 500;
  }

  if (error.type === "provider_error") {
    return 502;
  }

  return 422;
}

export async function GET(
  request: NextRequest,
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

    const range = parseChartRange(request.nextUrl.searchParams.get("range"));
    const response: StockChartResponse = await getStockChartData(
      normalizeSymbol(symbol),
      range,
    );

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Grafik verisi olusturulamadi.",
        ...(error instanceof MarketDataError
          ? {
              provider: error.provider,
              type: error.type,
            }
          : {}),
      },
      { status: getChartErrorStatus(error) },
    );
  }
}
