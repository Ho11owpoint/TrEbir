import { NextRequest, NextResponse } from "next/server";

import {
  getBacktestWarmupDays,
  normalizeBacktestRequest,
  runBacktest,
} from "@/lib/backtest";
import { getHistoricalSeries } from "@/lib/market";
import type { BacktestRequest } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<BacktestRequest>;
    const input = normalizeBacktestRequest(body);
    const warnings: string[] = [];
    const warmupDays = getBacktestWarmupDays(input.strategy);

    const benchmarkPromise =
      input.strategy === "rank-score"
        ? getHistoricalSeries("XU100.IS", {
            dateFrom: input.dateFrom,
            dateTo: input.dateTo,
            warmupDays,
          }).catch(() => {
            warnings.push(
              "Benchmark verisi alinamadi; rank-score stratejisi notr piyasa rejimiyle calistirildi.",
            );

            return undefined;
          })
        : Promise.resolve(undefined);

    const [symbolData, benchmarkData] = await Promise.all([
      getHistoricalSeries(input.symbol, {
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        warmupDays,
      }),
      benchmarkPromise,
    ]);

    const result = runBacktest({
      input,
      symbolData,
      benchmarkData,
      warnings,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Backtest sonucu olusturulamadi.";

    return NextResponse.json(
      {
        message,
      },
      { status: 400 },
    );
  }
}
