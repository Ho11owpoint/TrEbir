import type {
  Candle,
  ChartRangeKey,
  ForecastAdapterDescriptor,
  ForecastResponse,
  ForecastScenarioPoint,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const TRADING_SESSION_MS = 6.5 * 60 * 60 * 1000;
const DEFAULT_CONFIDENCE_LEVEL = 0.8;

interface ForecastInput {
  range: ChartRangeKey;
  series: Candle[];
}

interface ForecastBuildResult {
  forecast: ForecastResponse | null;
  warnings: string[];
}

interface ForecastAdapter {
  descriptor: ForecastAdapterDescriptor;
  build(input: ForecastInput): ForecastBuildResult;
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function standardDeviation(values: number[]) {
  if (values.length <= 1) {
    return 0;
  }

  const mean = average(values);
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;

  return Math.sqrt(variance);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function round(value: number, digits = 2) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function inferIntervalMs(series: Candle[]) {
  if (series.length < 2) {
    return DAY_MS;
  }

  const deltas = series
    .slice(1)
    .map((candle, index) => Math.max((candle.timestamp - series[index].timestamp) * 1000, 1))
    .sort((left, right) => left - right);

  return deltas[Math.floor(deltas.length / 2)] ?? DAY_MS;
}

function annualizationFactor(intervalMs: number) {
  if (intervalMs >= DAY_MS / 2) {
    return 252;
  }

  const barsPerTradingDay = Math.max(1, Math.round(TRADING_SESSION_MS / intervalMs));
  return 252 * barsPerTradingDay;
}

function nextBusinessDate(timestamp: number) {
  const next = new Date(timestamp);
  next.setUTCDate(next.getUTCDate() + 1);

  while (next.getUTCDay() === 0 || next.getUTCDay() === 6) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return next.getTime();
}

function advanceTimestamp(timestamp: number, intervalMs: number) {
  if (intervalMs >= DAY_MS / 2) {
    return nextBusinessDate(timestamp);
  }

  return timestamp + intervalMs;
}

function determineHorizonBars(seriesLength: number, range: ChartRangeKey, intervalMs: number) {
  const isIntraday = intervalMs < DAY_MS / 2;
  const caps: Record<ChartRangeKey, number> = {
    "1d": 8,
    "5d": 12,
    "1mo": 10,
    "3mo": 16,
    "6mo": 22,
    "1y": 30,
    max: 36,
  };

  const floor = isIntraday ? 6 : 5;
  const dynamic = Math.floor(seriesLength * (isIntraday ? 0.12 : 0.16));

  return clamp(dynamic, floor, caps[range]);
}

function zScoreForConfidence(confidenceLevel: number) {
  if (confidenceLevel >= 0.95) {
    return 1.96;
  }

  if (confidenceLevel >= 0.9) {
    return 1.64;
  }

  return 1.28;
}

function buildScenarioPoint(
  anchorPrice: number,
  annualizedDrift: number,
  annualizedVolatility: number,
  step: number,
  timestamp: number,
  intervalMs: number,
): ForecastScenarioPoint {
  const stepsPerYear = annualizationFactor(intervalMs);
  const timeFraction = step / stepsPerYear;
  const driftComponent =
    (annualizedDrift - (annualizedVolatility ** 2) / 2) * timeFraction;
  const volatilityComponent = annualizedVolatility * Math.sqrt(timeFraction);
  const scenarioBias = annualizedVolatility * 0.65 * Math.sqrt(timeFraction);
  const zScore = zScoreForConfidence(DEFAULT_CONFIDENCE_LEVEL);

  const basePrice = anchorPrice * Math.exp(driftComponent);
  const bullPrice = anchorPrice * Math.exp(driftComponent + scenarioBias);
  const bearPrice = anchorPrice * Math.exp(driftComponent - scenarioBias);
  const upperBand = anchorPrice * Math.exp(driftComponent + zScore * volatilityComponent);
  const lowerBand = anchorPrice * Math.exp(driftComponent - zScore * volatilityComponent);

  return {
    timestamp: Math.floor(timestamp / 1000),
    label: new Date(timestamp).toISOString(),
    horizonIndex: step,
    basePrice: round(basePrice, 2),
    bullPrice: round(bullPrice, 2),
    bearPrice: round(bearPrice, 2),
    upperBand: round(upperBand, 2),
    lowerBand: round(lowerBand, 2),
  };
}

function buildVolatilityScenarioForecast(input: ForecastInput): ForecastBuildResult {
  const series = input.series;

  if (series.length < 25) {
    return {
      forecast: null,
      warnings: [
        "Forecast kapatildi: senaryo uretimi icin en az 25 mum gecmisi gerekiyor.",
      ],
    };
  }

  const intervalMs = inferIntervalMs(series);

  if (intervalMs < DAY_MS / 2) {
    return {
      forecast: null,
      warnings: [
        "Forecast kapatildi: intraday araliklarda seans-duyarli model tamamlanana kadar projeksiyon gosterilmiyor.",
      ],
    };
  }

  const closes = series.map((candle) => candle.close);
  const logReturns = closes.slice(1).map((price, index) => Math.log(price / closes[index]));
  const lookback = logReturns.slice(-Math.min(logReturns.length, 60));

  if (lookback.length < 15) {
    return {
      forecast: null,
      warnings: [
        "Forecast kapatildi: gecerli horizon icin yeterli return gozlemi yok.",
      ],
    };
  }

  const recentReturns = lookback.slice(-Math.min(lookback.length, 21));
  const weightedMean = average(recentReturns) * 0.65 + average(lookback) * 0.35;
  const returnStdDev = standardDeviation(lookback);
  const horizonBars = determineHorizonBars(series.length, input.range, intervalMs);
  const anchorPrice = closes.at(-1) ?? 0;
  const anchorTimestamp = (series.at(-1)?.timestamp ?? 0) * 1000;
  const stepsPerYear = annualizationFactor(intervalMs);
  const annualizedDrift = weightedMean * stepsPerYear;
  const annualizedVolatility = returnStdDev * Math.sqrt(stepsPerYear);
  const points: ForecastScenarioPoint[] = [];
  let cursor = anchorTimestamp;

  for (let step = 1; step <= horizonBars; step += 1) {
    cursor = advanceTimestamp(cursor, intervalMs);
    points.push(
      buildScenarioPoint(
        anchorPrice,
        annualizedDrift,
        annualizedVolatility,
        step,
        cursor,
        intervalMs,
      ),
    );
  }

  return {
    forecast: {
      adapter: {
        id: "volatility_scenarios",
        label: "Volatility Scenarios",
        description:
          "Recent return drift ve volatiliteye dayali senaryo egileri uretir; horizon disinda yapay uzatma yapmaz.",
      },
      anchorPrice: round(anchorPrice, 2),
      anchorTimestamp: Math.floor(anchorTimestamp / 1000),
      validHorizonBars: horizonBars,
      validUntil: points.at(-1)?.label ?? series.at(-1)?.label ?? new Date().toISOString(),
      annualizedDrift: round(annualizedDrift * 100, 2),
      annualizedVolatility: round(annualizedVolatility * 100, 2),
      confidenceLevel: DEFAULT_CONFIDENCE_LEVEL,
      points,
      warnings: [
        `Forecast yalnizca gecerli horizon olan ${horizonBars} bar icin uretildi; sabit devam cizgisi eklenmedi.`,
      ],
    },
    warnings: [],
  };
}

const DEFAULT_FORECAST_ADAPTER: ForecastAdapter = {
  descriptor: {
    id: "volatility_scenarios",
    label: "Volatility Scenarios",
    description:
      "Yakin donem drift ve oynakliktan baz, bull ve bear senaryolari uretir.",
  },
  build: buildVolatilityScenarioForecast,
};

export function buildForecast(input: ForecastInput) {
  return DEFAULT_FORECAST_ADAPTER.build(input);
}
