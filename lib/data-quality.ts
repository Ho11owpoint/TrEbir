import type {
  DataQualityIssue,
  DataQualityReport,
  NormalizedMarketData,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

interface AssessQualityOptions {
  minBars: number;
  maxQuoteAgeDays?: number;
  maxSeriesAgeDays?: number;
  extraIssues?: DataQualityIssue[];
}

export function assessMarketDataQuality(
  data: NormalizedMarketData,
  options: AssessQualityOptions,
): DataQualityReport {
  const issues: DataQualityIssue[] = [...(options.extraIssues ?? [])];
  const missingFields: string[] = [];
  const now = Date.now();
  const latestCandle = data.series.at(-1);
  const maxQuoteAgeDays = options.maxQuoteAgeDays ?? 3;
  const maxSeriesAgeDays = options.maxSeriesAgeDays ?? 5;
  let staleByDays: number | null = null;

  if (data.series.length === 0) {
    issues.push({
      type: "empty_series",
      severity: "error",
      message: "Provider gecerli mum serisi dondurmedi.",
    });
  }

  if (data.series.length < options.minBars) {
    issues.push({
      type: "insufficient_history",
      severity: "error",
      message: `Analiz icin en az ${options.minBars} bar gerekir, gelen seri ${data.series.length} bar.`,
    });
  }

  if (!Number.isFinite(data.quote.price) || data.quote.price <= 0) {
    missingFields.push("quote.price");
  }

  if (!Number.isFinite(data.quote.previousClose) || data.quote.previousClose <= 0) {
    missingFields.push("quote.previousClose");
  }

  if (!data.quote.marketTime) {
    missingFields.push("quote.marketTime");
  }

  if (missingFields.length > 0) {
    missingFields.forEach((field) => {
      issues.push({
        type: "missing_field",
        severity: "error",
        message: `${field} alani eksik veya gecersiz.`,
        field,
      });
    });
  }

  const quoteAgeDays = Math.floor(
    (now - Date.parse(data.quote.marketTime || new Date(0).toISOString())) / DAY_MS,
  );

  if (Number.isFinite(quoteAgeDays) && quoteAgeDays > maxQuoteAgeDays) {
    issues.push({
      type: "stale_quote",
      severity: "warning",
      message: `Son kotasyon ${quoteAgeDays} gun once guncellenmis gorunuyor.`,
    });
    staleByDays = quoteAgeDays;
  }

  if (latestCandle) {
    const seriesAgeDays = Math.floor((now - latestCandle.timestamp * 1000) / DAY_MS);

    if (seriesAgeDays > maxSeriesAgeDays) {
      issues.push({
        type: "stale_series",
        severity: "warning",
        message: `Son mum ${seriesAgeDays} gun once olusmus.`,
      });
      staleByDays = Math.max(staleByDays ?? 0, seriesAgeDays);
    }
  }

  const hasHardError = issues.some((issue) => issue.severity === "error");

  return {
    isUsable: !hasHardError,
    isStale: issues.some(
      (issue) => issue.type === "stale_quote" || issue.type === "stale_series",
    ),
    barCount: data.series.length,
    staleByDays,
    missingFields,
    issues,
  };
}
