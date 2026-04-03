import type {
  Candle,
  IndicatorSeriesPoint,
  IndicatorSet,
  StockChartOverlaySeries,
} from "./types";

function round(value: number, digits = 2) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function percentageChange(current: number, previous: number) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
    return null;
  }

  return ((current / previous) - 1) * 100;
}

export function simpleMovingAverage(values: number[], period: number) {
  if (values.length < period) {
    return null;
  }

  return average(values.slice(-period));
}

export function buildSimpleMovingAverageSeries(values: number[], period: number) {
  return values.map((_, index) => {
    if (index + 1 < period) {
      return null;
    }

    return average(values.slice(index + 1 - period, index + 1));
  });
}

export function relativeStrengthIndex(values: number[], period: number) {
  return buildRelativeStrengthIndexSeries(values, period).at(-1) ?? null;
}

export function buildRelativeStrengthIndexSeries(values: number[], period: number) {
  if (values.length <= period) {
    return values.map(() => null);
  }

  const series = values.map<number | null>(() => null);
  let gains = 0;
  let losses = 0;

  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];

    if (change >= 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  let averageGain = gains / period;
  let averageLoss = losses / period;
  series[period] =
    averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);

  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    averageGain = ((averageGain * (period - 1)) + gain) / period;
    averageLoss = ((averageLoss * (period - 1)) + loss) / period;

    series[index] =
      averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  }

  return series;
}

export function annualizedVolatility(values: number[], period: number) {
  if (values.length <= period) {
    return null;
  }

  const closes = values.slice(-(period + 1));
  const returns = closes.slice(1).map((price, index) => price / closes[index] - 1);
  const mean = average(returns);

  if (mean === null) {
    return null;
  }

  const variance =
    returns.reduce((total, item) => total + (item - mean) ** 2, 0) / returns.length;

  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

export function averageTrueRange(series: Candle[], period: number) {
  return buildAverageTrueRangeSeries(series, period).at(-1) ?? null;
}

export function buildAverageTrueRangeSeries(series: Candle[], period: number) {
  if (series.length <= period) {
    return series.map(() => null);
  }

  const trueRanges = series.map((candle, index) => {
    if (index === 0) {
      return candle.high - candle.low;
    }

    const previousClose = series[index - 1]?.close ?? candle.close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });

  return trueRanges.map((_, index) => {
    if (index + 1 < period) {
      return null;
    }

    return average(trueRanges.slice(index + 1 - period, index + 1));
  });
}

function mapSeriesPoints(
  candles: Candle[],
  values: Array<number | null>,
): IndicatorSeriesPoint[] {
  return candles.map((candle, index) => ({
    timestamp: candle.timestamp,
    label: candle.label,
    value: values[index] === null ? null : round(values[index] as number, 2),
  }));
}

export function inferSeriesIntervalMs(series: Candle[]) {
  if (series.length < 2) {
    return 24 * 60 * 60 * 1000;
  }

  const deltas = series
    .slice(1)
    .map((candle, index) => Math.max((candle.timestamp - series[index].timestamp) * 1000, 1))
    .sort((left, right) => left - right);

  return deltas[Math.floor(deltas.length / 2)] ?? 24 * 60 * 60 * 1000;
}

export function buildChartOverlaySeries(series: Candle[]): StockChartOverlaySeries {
  const closes = series.map((candle) => candle.close);
  const sma20 = buildSimpleMovingAverageSeries(closes, 20);
  const sma50 = buildSimpleMovingAverageSeries(closes, 50);
  const atr14 = buildAverageTrueRangeSeries(series, 14);
  const rsi14 = buildRelativeStrengthIndexSeries(closes, 14);

  return {
    sma20: mapSeriesPoints(series, sma20),
    sma50: mapSeriesPoints(series, sma50),
    atr14: mapSeriesPoints(series, atr14),
    rsi14: mapSeriesPoints(series, rsi14),
  };
}

export function getLatestIndicatorSet(series: Candle[]): IndicatorSet {
  const closes = series.map((candle) => candle.close);
  const latestPrice = closes.at(-1) ?? 0;
  const sma20 = simpleMovingAverage(closes, 20);
  const sma50 = simpleMovingAverage(closes, 50);
  const rsi14 = relativeStrengthIndex(closes, 14);
  const momentum21 =
    closes.length > 21
      ? percentageChange(latestPrice, closes.at(-22) ?? latestPrice)
      : null;
  const volatility21 = annualizedVolatility(closes, 21);
  const atr14 = averageTrueRange(series, 14);
  const fiftyTwoWeekHigh = series.reduce<number | null>((high, candle) => {
    if (high === null || candle.high > high) {
      return candle.high;
    }

    return high;
  }, null);
  const fiftyTwoWeekLow = series.reduce<number | null>((low, candle) => {
    if (low === null || candle.low < low) {
      return candle.low;
    }

    return low;
  }, null);

  return {
    sma20: sma20 === null ? null : round(sma20, 2),
    sma50: sma50 === null ? null : round(sma50, 2),
    rsi14: rsi14 === null ? null : round(rsi14, 2),
    momentum21: momentum21 === null ? null : round(momentum21, 2),
    volatility21: volatility21 === null ? null : round(volatility21, 2),
    atr14: atr14 === null ? null : round(atr14, 2),
    fiftyTwoWeekHigh: fiftyTwoWeekHigh === null ? null : round(fiftyTwoWeekHigh, 2),
    fiftyTwoWeekLow: fiftyTwoWeekLow === null ? null : round(fiftyTwoWeekLow, 2),
  };
}
