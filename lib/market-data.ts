import type {
  DataQualityIssue,
  DataQualityIssueType,
  MarketDataProviderName,
  NormalizedMarketData,
} from "./types";

import { assessMarketDataQuality } from "./data-quality";
import { yahooFinanceProvider } from "./market-providers/yahoo-finance";

export interface MarketDataFetchOptions {
  interval?: string;
  period1?: number;
  period2?: number;
  range?: string;
}

export interface MarketDataProvider {
  name: MarketDataProviderName;
  label: string;
  getMarketData(
    symbol: string,
    options?: MarketDataFetchOptions,
  ): Promise<{
    data: NormalizedMarketData;
    issues?: DataQualityIssue[];
  }>;
}

export class MarketDataError extends Error {
  type: DataQualityIssueType;
  provider: MarketDataProviderName;
  issues: DataQualityIssue[];

  constructor(
    message: string,
    type: DataQualityIssueType,
    provider: MarketDataProviderName,
    issues: DataQualityIssue[] = [],
  ) {
    super(message);
    this.name = "MarketDataError";
    this.type = type;
    this.provider = provider;
    this.issues = issues;
  }
}

const defaultProvider: MarketDataProvider = yahooFinanceProvider;

export function getDefaultMarketDataProvider() {
  return defaultProvider;
}

export async function fetchMarketDataWithQuality(
  symbol: string,
  options: MarketDataFetchOptions & {
    minBars: number;
    maxQuoteAgeDays?: number;
    maxSeriesAgeDays?: number;
  },
) {
  try {
    const provider = getDefaultMarketDataProvider();
    const result = await provider.getMarketData(symbol, options);
    const quality = assessMarketDataQuality(result.data, {
      minBars: options.minBars,
      maxQuoteAgeDays: options.maxQuoteAgeDays,
      maxSeriesAgeDays: options.maxSeriesAgeDays,
      extraIssues: result.issues,
    });

    return {
      data: {
        ...result.data,
        provider: {
          ...result.data.provider,
          quality,
        },
      },
      quality,
      provider,
    };
  } catch (error) {
    if (error instanceof MarketDataError) {
      throw error;
    }

    const provider = getDefaultMarketDataProvider();
    throw new MarketDataError(
      error instanceof Error ? error.message : "Provider veri akisi hata verdi.",
      "provider_error",
      provider.name,
      [
        {
          type: "provider_error",
          severity: "error",
          message:
            error instanceof Error ? error.message : "Provider veri akisi hata verdi.",
        },
      ],
    );
  }
}
