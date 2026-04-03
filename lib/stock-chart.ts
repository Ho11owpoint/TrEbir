import "server-only";

import { round } from "./analysis";
import { buildForecast } from "./forecast";
import { buildChartOverlaySeries } from "./indicators";
import { fetchMarketDataWithQuality, MarketDataError } from "./market-data";
import type {
  ChartRangeKey,
  StockChartResponse,
} from "./types";

const CHART_RANGE_CONFIG: Record<
  ChartRangeKey,
  {
    interval: string;
    minBars: number;
    range: string;
  }
> = {
  "1d": {
    range: "1d",
    interval: "15m",
    minBars: 12,
  },
  "5d": {
    range: "5d",
    interval: "30m",
    minBars: 16,
  },
  "1mo": {
    range: "1mo",
    interval: "1d",
    minBars: 12,
  },
  "3mo": {
    range: "3mo",
    interval: "1d",
    minBars: 20,
  },
  "6mo": {
    range: "6mo",
    interval: "1d",
    minBars: 30,
  },
  "1y": {
    range: "1y",
    interval: "1d",
    minBars: 50,
  },
  max: {
    range: "max",
    interval: "1d",
    minBars: 50,
  },
};

function normalizeSymbol(symbol: string) {
  const trimmed = symbol.trim().toUpperCase();
  return trimmed.endsWith(".IS") ? trimmed : `${trimmed}.IS`;
}

export function parseChartRange(value: string | null): ChartRangeKey {
  if (
    value === "1d" ||
    value === "5d" ||
    value === "1mo" ||
    value === "3mo" ||
    value === "6mo" ||
    value === "1y" ||
    value === "max"
  ) {
    return value;
  }

  return "6mo";
}

export async function getStockChartData(
  symbolInput: string,
  range: ChartRangeKey = "6mo",
): Promise<StockChartResponse> {
  const symbol = normalizeSymbol(symbolInput);
  const config = CHART_RANGE_CONFIG[range];
  const { data, quality } = await fetchMarketDataWithQuality(symbol, {
    range: config.range,
    interval: config.interval,
    minBars: config.minBars,
    maxQuoteAgeDays: range === "1d" || range === "5d" ? 3 : 14,
    maxSeriesAgeDays: range === "1d" || range === "5d" ? 5 : 30,
  });

  if (data.series.length < 2) {
    throw new MarketDataError(
      "Grafik icin yeterli fiyat serisi bulunamadi.",
      "insufficient_history",
      data.provider.provider,
      quality.issues,
    );
  }

  const overlays = buildChartOverlaySeries(data.series);
  const forecastResult = buildForecast({
    range,
    series: data.series,
  });
  const change = data.quote.price - data.quote.previousClose;
  const changePercent =
    data.quote.previousClose === 0 ? 0 : (change / data.quote.previousClose) * 100;

  return {
    symbol: data.symbol,
    displaySymbol: data.displaySymbol,
    currency: data.quote.currency,
    exchange: data.quote.exchange,
    timezone: data.quote.timezone,
    range,
    interval: config.interval,
    provider: data.provider,
    lastPrice: round(data.quote.price, 2),
    previousClose: round(data.quote.previousClose, 2),
    change: round(change, 2),
    changePercent: round(changePercent, 2),
    series: data.series,
    overlays,
    forecast: forecastResult.forecast,
    warnings: Array.from(
      new Set([
        ...data.provider.quality.issues
          .filter((issue) => issue.severity !== "info")
          .map((issue) => issue.message),
        ...forecastResult.warnings,
        ...(forecastResult.forecast?.warnings ?? []),
      ]),
    ),
  };
}
