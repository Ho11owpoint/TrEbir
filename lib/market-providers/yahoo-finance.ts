import { MarketDataError, type MarketDataFetchOptions, type MarketDataProvider } from "../market-data";
import type { Candle, NormalizedMarketData } from "../types";

const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const DEFAULT_RANGE = "6mo";
const DEFAULT_INTERVAL = "1d";

interface YahooChartMeta {
  chartPreviousClose?: number;
  currency?: string;
  exchangeName?: string;
  regularMarketPrice?: number;
  regularMarketTime?: number;
  symbol?: string;
  timezone?: string;
}

interface YahooQuote {
  close?: Array<number | null>;
  high?: Array<number | null>;
  low?: Array<number | null>;
  open?: Array<number | null>;
  volume?: Array<number | null>;
}

interface YahooChartResult {
  meta?: YahooChartMeta;
  timestamp?: number[];
  indicators?: {
    quote?: YahooQuote[];
  };
}

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase();
}

function displaySymbol(symbol: string) {
  return symbol.endsWith(".IS") ? symbol.replace(".IS", "") : symbol;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function buildChartUrl(symbol: string, options: MarketDataFetchOptions) {
  const searchParams = new URLSearchParams({
    includePrePost: "false",
    interval: options.interval ?? DEFAULT_INTERVAL,
    events: "div,splits",
  });

  if (
    typeof options.period1 === "number" &&
    Number.isFinite(options.period1) &&
    typeof options.period2 === "number" &&
    Number.isFinite(options.period2)
  ) {
    searchParams.set("period1", String(options.period1));
    searchParams.set("period2", String(options.period2));
  } else {
    searchParams.set("range", options.range ?? DEFAULT_RANGE);
  }

  return `${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}?${searchParams.toString()}`;
}

async function fetchYahooChart(symbol: string, options: MarketDataFetchOptions = {}) {
  const url = buildChartUrl(symbol, options);
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new MarketDataError(
      `Veri akisi alinmadi (${response.status}).`,
      "provider_error",
      "yahoo_finance",
    );
  }

  const data = (await response.json()) as {
    chart?: {
      error?: { description?: string } | null;
      result?: YahooChartResult[];
    };
  };

  const error = data.chart?.error;

  if (error?.description) {
    throw new MarketDataError(
      error.description,
      "provider_error",
      "yahoo_finance",
    );
  }

  const result = data.chart?.result?.[0];

  if (!result) {
    throw new MarketDataError(
      "Sembol icin fiyat serisi bulunamadi.",
      "empty_series",
      "yahoo_finance",
    );
  }

  return result;
}

function parseChartData(symbol: string, chart: YahooChartResult) {
  const timestamps = chart.timestamp ?? [];
  const quote = chart.indicators?.quote?.[0];

  if (!quote) {
    throw new MarketDataError(
      "Mum verisi eksik geldi.",
      "missing_field",
      "yahoo_finance",
      [
        {
          type: "missing_field",
          severity: "error",
          message: "quote alani provider yanitinda bulunamadi.",
          field: "quote",
        },
      ],
    );
  }

  const series: Candle[] = [];
  let skippedCandles = 0;

  timestamps.forEach((timestamp, index) => {
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];
    const volume = quote.volume?.[index];

    if (
      !isFiniteNumber(open) ||
      !isFiniteNumber(high) ||
      !isFiniteNumber(low) ||
      !isFiniteNumber(close) ||
      !isFiniteNumber(volume)
    ) {
      skippedCandles += 1;
      return;
    }

    series.push({
      timestamp,
      label: new Date(timestamp * 1000).toISOString(),
      open,
      high,
      low,
      close,
      volume,
    });
  });

  if (series.length === 0) {
    throw new MarketDataError(
      "Gecerli fiyat serisi olusmadi.",
      "empty_series",
      "yahoo_finance",
    );
  }

  const meta = chart.meta ?? {};
  const latestClose = series.at(-1)?.close ?? 0;
  const previousClose = meta.chartPreviousClose ?? series.at(-2)?.close ?? latestClose;
  const normalized = normalizeSymbol(meta.symbol ?? symbol);
  const data: NormalizedMarketData = {
    symbol: normalized,
    displaySymbol: displaySymbol(meta.symbol ?? symbol),
    quote: {
      price: meta.regularMarketPrice ?? latestClose,
      previousClose,
      marketTime: new Date(
        (meta.regularMarketTime ?? timestamps.at(-1) ?? 0) * 1000,
      ).toISOString(),
      currency: meta.currency ?? "TRY",
      exchange: meta.exchangeName ?? "UNKNOWN",
      timezone: meta.timezone ?? "UTC",
    },
    provider: {
      provider: "yahoo_finance",
      label: "Yahoo Finance",
      fetchedAt: new Date().toISOString(),
      quality: {
        isUsable: true,
        isStale: false,
        barCount: series.length,
        staleByDays: null,
        missingFields: [],
        issues: [],
      },
    },
    series,
  };

  return {
    data,
    skippedCandles,
  };
}

export const yahooFinanceProvider: MarketDataProvider = {
  name: "yahoo_finance",
  label: "Yahoo Finance",
  async getMarketData(symbolInput, options = {}) {
    const symbol = normalizeSymbol(symbolInput);
    const chart = await fetchYahooChart(symbol, options);
    const parsed = parseChartData(symbol, chart);

    return {
      data: parsed.data,
      issues:
        parsed.skippedCandles > 0
          ? [
              {
                type: "incomplete_candle",
                severity: "warning",
                message: `${parsed.skippedCandles} eksik mum bar'i atlandi.`,
              },
            ]
          : [],
    };
  },
};
