import "server-only";

import { analyzeSeries, round } from "./analysis";
import { DEFAULT_SYMBOLS } from "./defaults";
import { fetchMarketDataWithQuality, MarketDataError } from "./market-data";
import type {
  DashboardError,
  DashboardResponse,
  HistoricalSeriesResponse,
  MarketContext,
  MarketDataFailure,
  MarketProviderSummary,
  MarketSnapshot,
} from "./types";

const DEFAULT_RANGE = "6mo";
const DEFAULT_INTERVAL = "1d";
const CACHE_TTL_MS = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_CACHE = new Map<
  string,
  {
    expiresAt: number;
    promise: Promise<MarketSnapshot>;
  }
>();

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase();
}

function toUtcTimestamp(dateValue: string, extraDays = 0) {
  return Date.parse(`${dateValue}T00:00:00.000Z`) + extraDays * DAY_MS;
}

async function mapWithConcurrency<TItem, TResult>(
  items: TItem[],
  concurrency: number,
  task: (item: TItem, index: number) => Promise<TResult>,
) {
  const settledResults: PromiseSettledResult<TResult>[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      try {
        settledResults[currentIndex] = {
          status: "fulfilled",
          value: await task(items[currentIndex] as TItem, currentIndex),
        };
      } catch (error) {
        settledResults[currentIndex] = {
          status: "rejected",
          reason: error,
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );

  return settledResults;
}

function createMarketFailure(symbol: string, error: unknown): MarketDataFailure {
  if (error instanceof MarketDataError) {
    return {
      symbol,
      message: error.message,
      type: error.type,
      provider: error.provider,
      issues: error.issues,
    };
  }

  return {
    symbol,
    message: error instanceof Error ? error.message : "Sembol verisi alinamadi.",
    type: "provider_error",
    provider: "yahoo_finance",
    issues: [
      {
        type: "provider_error",
        severity: "error",
        message:
          error instanceof Error ? error.message : "Sembol verisi alinamadi.",
      },
    ],
  };
}

function buildProviderSummary(
  snapshots: MarketSnapshot[],
  errors: MarketDataFailure[],
): MarketProviderSummary[] {
  const providerMap = new Map<string, MarketProviderSummary>();

  snapshots.forEach((snapshot) => {
    const key = snapshot.provider.provider;
    const existing = providerMap.get(key) ?? {
      provider: snapshot.provider.provider,
      label: snapshot.provider.label,
      analyzedCount: 0,
      failedCount: 0,
      staleCount: 0,
      warningCount: 0,
    };

    existing.analyzedCount += 1;
    if (snapshot.provider.quality.isStale) {
      existing.staleCount += 1;
    }
    existing.warningCount += snapshot.provider.quality.issues.filter(
      (issue) => issue.severity === "warning",
    ).length;
    providerMap.set(key, existing);
  });

  errors.forEach((error) => {
    const existing = providerMap.get(error.provider) ?? {
      provider: error.provider,
      label: error.provider === "yahoo_finance" ? "Yahoo Finance" : error.provider,
      analyzedCount: 0,
      failedCount: 0,
      staleCount: 0,
      warningCount: 0,
    };

    existing.failedCount += 1;
    providerMap.set(error.provider, existing);
  });

  return [...providerMap.values()];
}

async function loadMarketSnapshot(symbol: string): Promise<MarketSnapshot> {
  const { data, quality } = await fetchMarketDataWithQuality(symbol, {
    range: DEFAULT_RANGE,
    interval: DEFAULT_INTERVAL,
    minBars: 60,
  });

  if (!quality.isUsable) {
    const primaryIssue = quality.issues.find((issue) => issue.severity === "error");

    throw new MarketDataError(
      primaryIssue?.message ?? "Analiz icin kullanilabilir veri olusmadi.",
      primaryIssue?.type ?? "insufficient_history",
      data.provider.provider,
      quality.issues,
    );
  }

  const price = data.quote.price;
  const change = price - data.quote.previousClose;
  const changePercent =
    data.quote.previousClose === 0 ? 0 : (change / data.quote.previousClose) * 100;
  const { indicators, signal } = analyzeSeries(data.series);

  return {
    symbol: data.symbol,
    displaySymbol: data.displaySymbol,
    currency: data.quote.currency,
    exchange: data.quote.exchange,
    price: round(price, 2),
    previousClose: round(data.quote.previousClose, 2),
    change: round(change, 2),
    changePercent: round(changePercent, 2),
    marketTime: data.quote.marketTime,
    timezone: data.quote.timezone,
    provider: data.provider,
    series: data.series,
    indicators,
    signal,
  };
}

export async function getHistoricalSeries(
  symbolInput: string,
  options: {
    dateFrom: string;
    dateTo: string;
    interval?: string;
    warmupDays?: number;
  },
): Promise<HistoricalSeriesResponse> {
  const symbol = normalizeSymbol(symbolInput);
  const warmupDays = Math.max(Math.floor(options.warmupDays ?? 0), 0);
  const period1 = Math.floor((toUtcTimestamp(options.dateFrom) - warmupDays * DAY_MS) / 1000);
  const period2 = Math.floor(toUtcTimestamp(options.dateTo, 1) / 1000);
  const { data } = await fetchMarketDataWithQuality(symbol, {
    interval: options.interval ?? DEFAULT_INTERVAL,
    period1,
    period2,
    minBars: 1,
  });

  return {
    symbol: data.symbol,
    displaySymbol: data.displaySymbol,
    currency: data.quote.currency,
    exchange: data.quote.exchange,
    timezone: data.quote.timezone,
    provider: data.provider,
    series: data.series,
  };
}

export async function getMarketSnapshot(symbolInput: string) {
  const symbol = normalizeSymbol(symbolInput);
  const now = Date.now();
  const cached = SNAPSHOT_CACHE.get(symbol);

  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = loadMarketSnapshot(symbol).catch((error) => {
    SNAPSHOT_CACHE.delete(symbol);
    throw error;
  });

  SNAPSHOT_CACHE.set(symbol, {
    expiresAt: now + CACHE_TTL_MS,
    promise,
  });

  return promise;
}

export async function getMarketSnapshots(symbols: string[], concurrency = 12) {
  const uniqueSymbols = [...new Set(symbols.map(normalizeSymbol).filter(Boolean))];
  const results = await mapWithConcurrency(uniqueSymbols, concurrency, (symbol) =>
    getMarketSnapshot(symbol),
  );
  const snapshots: MarketSnapshot[] = [];
  const errors: MarketDataFailure[] = [];

  results.forEach((result, index) => {
    const symbol = uniqueSymbols[index] ?? "UNKNOWN";

    if (result.status === "fulfilled") {
      snapshots.push(result.value);
    } else {
      errors.push(createMarketFailure(symbol, result.reason));
    }
  });

  return {
    symbols: snapshots,
    errors,
    providerSummary: buildProviderSummary(snapshots, errors),
  };
}

export async function getBenchmarkContext(): Promise<MarketContext> {
  const benchmark = await getMarketSnapshot("XU100.IS");
  const score = benchmark.signal.score;
  const trend =
    score >= 65 ? "risk-on" : score <= 40 ? "risk-off" : "neutral";

  let label = "Nesnel denge";
  let summary =
    "Piyasa net bir yone karar vermemis. Pozisyon boyutunu kademeli tutmak mantikli.";

  if (trend === "risk-on") {
    label = "Risk alma penceresi";
    summary =
      "BIST 100 yapici trend bolgesinde. Guclu hisselerde alis simule etmek daha anlamli.";
  }

  if (trend === "risk-off") {
    label = "Koruma modu";
    summary =
      "BIST 100 zayif. Paper trade tarafinda daha kucuk pozisyon ve daha siki stop uygun olur.";
  }

  return {
    benchmark: benchmark.symbol,
    label,
    score,
    trend,
    summary,
  };
}

export async function getDashboard(symbols: string[]): Promise<DashboardResponse> {
  const requestedSymbols = symbols.length > 0 ? symbols : DEFAULT_SYMBOLS;
  const [market, benchmark] = await Promise.all([
    getMarketSnapshots(requestedSymbols),
    getBenchmarkContext(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    benchmark,
    symbols: market.symbols,
    errors: market.errors.map<DashboardError>((error) => ({
      symbol: error.symbol,
      message: error.message,
      type: error.type,
      provider: error.provider,
    })),
  };
}
