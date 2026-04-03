import { analyzeSeries, round } from "./analysis";
import { buildRankScore } from "./ranking";
import type {
  BacktestEquityPoint,
  BacktestMetrics,
  BacktestRequest,
  BacktestResponse,
  BacktestStrategyProfile,
  BacktestTrade,
  Candle,
  HistoricalSeriesResponse,
  MarketContext,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_LOOKBACK_BARS = 60;
const MIN_RANGE_BARS = 20;
const DEFAULT_INITIAL_CAPITAL = 100_000;
const DEFAULT_COMMISSION_PERCENT = 0.15;
const DEFAULT_SLIPPAGE_PERCENT = 0.1;

const STRATEGY_LABELS: Record<BacktestStrategyProfile, string> = {
  "rank-score": "Rank Score",
  momentum: "Momentum",
  breakout: "Breakout",
  "mean-reversion": "Mean Reversion",
};

type ExitReason = BacktestTrade["exitReason"];

interface RunBacktestOptions {
  input: BacktestRequest;
  symbolData: HistoricalSeriesResponse;
  benchmarkData?: HistoricalSeriesResponse;
  warnings?: string[];
}

interface StrategyEvaluation {
  enter: boolean;
  exit: boolean;
}

interface OpenPosition {
  id: string;
  entryBarIndex: number;
  entryDate: string;
  entryPrice: number;
  entryCommission: number;
  peakPrice: number;
  shares: number;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  trailingStopPrice: number | null;
}

function toDateKey(value: string) {
  return value.slice(0, 10);
}

function normalizeBistSymbol(symbol: string) {
  const normalized = symbol.trim().toUpperCase();

  if (!normalized) {
    return "";
  }

  return normalized.includes(".") ? normalized : `${normalized}.IS`;
}

function parseIsoDate(value: string) {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);

  if (!Number.isFinite(timestamp)) {
    throw new Error(`Gecersiz tarih: ${value}`);
  }

  return timestamp;
}

function normalizeNumber(value: unknown, fallback: number) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeInteger(value: unknown, fallback: number) {
  return Math.max(Math.floor(normalizeNumber(value, fallback)), 0);
}

function validatePercentRange(
  value: number,
  label: string,
  {
    max = 100,
    min = 0,
    allowZero = true,
  }: { min?: number; max?: number; allowZero?: boolean } = {},
) {
  const minimum = allowZero ? min : Math.max(min, Number.MIN_VALUE);

  if (!Number.isFinite(value) || value < minimum || value > max) {
    throw new Error(`${label} gecersiz.`);
  }
}

function buildNeutralMarketContext(): MarketContext {
  return {
    benchmark: "XU100.IS",
    label: "Nesnel denge",
    score: 50,
    trend: "neutral",
    summary: "Benchmark verisi yok; strateji notr piyasa tonu ile calisti.",
  };
}

function buildBenchmarkContextFromSeries(series?: Candle[]): MarketContext {
  if (!series || series.length < MIN_LOOKBACK_BARS) {
    return buildNeutralMarketContext();
  }

  const { signal } = analyzeSeries(series);
  const trend =
    signal.score >= 65 ? "risk-on" : signal.score <= 40 ? "risk-off" : "neutral";

  if (trend === "risk-on") {
    return {
      benchmark: "XU100.IS",
      label: "Risk alma penceresi",
      score: signal.score,
      trend,
      summary: "Benchmark yapici trendde.",
    };
  }

  if (trend === "risk-off") {
    return {
      benchmark: "XU100.IS",
      label: "Koruma modu",
      score: signal.score,
      trend,
      summary: "Benchmark savunmaci bolgede.",
    };
  }

  return {
    benchmark: "XU100.IS",
    label: "Nesnel denge",
    score: signal.score,
    trend,
    summary: "Benchmark notr bolgede.",
  };
}

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function findRangeStartIndex(series: Candle[], dateFrom: string) {
  return series.findIndex((candle) => toDateKey(candle.label) >= dateFrom);
}

function findRangeEndIndex(series: Candle[], dateTo: string) {
  for (let index = series.length - 1; index >= 0; index -= 1) {
    if (toDateKey(series[index]?.label ?? "") <= dateTo) {
      return index;
    }
  }

  return -1;
}

function sliceSeriesUntilTimestamp(series: Candle[] | undefined, timestamp: number) {
  if (!series || series.length === 0) {
    return undefined;
  }

  let endIndex = -1;

  for (let index = 0; index < series.length; index += 1) {
    if ((series[index]?.timestamp ?? 0) <= timestamp) {
      endIndex = index;
    } else {
      break;
    }
  }

  return endIndex >= 0 ? series.slice(0, endIndex + 1) : undefined;
}

function applyBuySlippage(price: number, slippagePercent: number) {
  return price * (1 + slippagePercent / 100);
}

function applySellSlippage(price: number, slippagePercent: number) {
  return price * (1 - slippagePercent / 100);
}

function commissionAmount(grossAmount: number, commissionPercent: number) {
  return grossAmount * (commissionPercent / 100);
}

function evaluateRankScoreStrategy(
  series: Candle[],
  benchmarkSeries?: Candle[],
): StrategyEvaluation {
  if (series.length < MIN_LOOKBACK_BARS) {
    return {
      enter: false,
      exit: false,
    };
  }

  const latestPrice = series.at(-1)?.close ?? 0;
  const { indicators, signal } = analyzeSeries(series);
  const benchmark = buildBenchmarkContextFromSeries(benchmarkSeries);
  const rankScore = buildRankScore(
    {
      price: latestPrice,
      indicators,
      signal,
    },
    benchmark,
  );

  return {
    enter:
      signal.action === "buy" &&
      signal.score >= 62 &&
      rankScore >= 60 &&
      benchmark.trend !== "risk-off",
    exit: signal.action === "reduce" || rankScore < 48,
  };
}

function evaluateMomentumStrategy(series: Candle[]): StrategyEvaluation {
  if (series.length < MIN_LOOKBACK_BARS) {
    return {
      enter: false,
      exit: false,
    };
  }

  const latestPrice = series.at(-1)?.close ?? 0;
  const { indicators } = analyzeSeries(series);
  const sma20 = indicators.sma20 ?? 0;
  const sma50 = indicators.sma50 ?? 0;
  const momentum21 = indicators.momentum21 ?? 0;
  const rsi14 = indicators.rsi14 ?? 50;

  return {
    enter:
      sma20 > 0 &&
      sma50 > 0 &&
      latestPrice > sma20 &&
      sma20 > sma50 &&
      momentum21 >= 5 &&
      rsi14 >= 48 &&
      rsi14 <= 72,
    exit:
      (sma20 > 0 && latestPrice < sma20) ||
      momentum21 < 0 ||
      rsi14 > 78,
  };
}

function evaluateBreakoutStrategy(series: Candle[]): StrategyEvaluation {
  if (series.length < 30) {
    return {
      enter: false,
      exit: false,
    };
  }

  const latest = series.at(-1);
  const priorWindow = series.slice(-21, -1);
  const pullbackWindow = series.slice(-11, -1);
  const averageVolume20 = average(priorWindow.map((bar) => bar.volume)) ?? 0;
  const breakoutLevel = Math.max(...priorWindow.map((bar) => bar.high));
  const pullbackFloor = Math.min(...pullbackWindow.map((bar) => bar.low));
  const { indicators } = analyzeSeries(series);
  const sma20 = indicators.sma20 ?? 0;

  if (!latest) {
    return {
      enter: false,
      exit: false,
    };
  }

  return {
    enter:
      latest.close > breakoutLevel &&
      latest.volume >= averageVolume20 * 1.1 &&
      sma20 > 0 &&
      latest.close > sma20,
    exit:
      latest.close < pullbackFloor ||
      (sma20 > 0 && latest.close < sma20),
  };
}

function evaluateMeanReversionStrategy(series: Candle[]): StrategyEvaluation {
  if (series.length < MIN_LOOKBACK_BARS) {
    return {
      enter: false,
      exit: false,
    };
  }

  const latestPrice = series.at(-1)?.close ?? 0;
  const { indicators } = analyzeSeries(series);
  const sma20 = indicators.sma20 ?? 0;
  const rsi14 = indicators.rsi14 ?? 50;

  return {
    enter: sma20 > 0 && latestPrice <= sma20 * 0.96 && rsi14 <= 35,
    exit: (sma20 > 0 && latestPrice >= sma20) || rsi14 >= 55,
  };
}

function evaluateStrategy(
  strategy: BacktestStrategyProfile,
  series: Candle[],
  benchmarkSeries?: Candle[],
) {
  switch (strategy) {
    case "rank-score":
      return evaluateRankScoreStrategy(series, benchmarkSeries);
    case "momentum":
      return evaluateMomentumStrategy(series);
    case "breakout":
      return evaluateBreakoutStrategy(series);
    case "mean-reversion":
      return evaluateMeanReversionStrategy(series);
    default:
      return {
        enter: false,
        exit: false,
      };
  }
}

function calculateOrderSize(
  input: BacktestRequest,
  cash: number,
  equity: number,
  entryPrice: number,
) {
  const adjustedEntryPrice = applyBuySlippage(entryPrice, input.slippagePercent);
  const commissionFactor = 1 + input.commissionPercent / 100;
  const maxAffordableShares = Math.floor(cash / (adjustedEntryPrice * commissionFactor));

  if (maxAffordableShares <= 0) {
    return 0;
  }

  if (input.positionSizing.mode === "fixed_amount") {
    return Math.max(
      Math.min(Math.floor(input.positionSizing.value / adjustedEntryPrice), maxAffordableShares),
      0,
    );
  }

  if (input.positionSizing.mode === "percent_of_equity") {
    const budget = equity * (input.positionSizing.value / 100);
    return Math.max(
      Math.min(Math.floor(budget / adjustedEntryPrice), maxAffordableShares),
      0,
    );
  }

  const stopDistance = entryPrice * (input.stopLossPercent / 100);

  if (stopDistance <= 0) {
    return 0;
  }

  const riskBudget = equity * (input.positionSizing.value / 100);
  const sharesByRisk = Math.floor(riskBudget / stopDistance);

  return Math.max(Math.min(sharesByRisk, maxAffordableShares), 0);
}

function closePosition(
  position: OpenPosition,
  {
    currentBar,
    currentIndex,
    exitPrice,
    reason,
    input,
    symbol,
    cash,
  }: {
    currentBar: Candle;
    currentIndex: number;
    exitPrice: number;
    reason: ExitReason;
    input: BacktestRequest;
    symbol: string;
    cash: number;
  },
) {
  const adjustedExitPrice = round(
    applySellSlippage(exitPrice, input.slippagePercent),
    4,
  );
  const grossExitAmount = adjustedExitPrice * position.shares;
  const exitCommission = commissionAmount(grossExitAmount, input.commissionPercent);
  const grossPnl = (adjustedExitPrice - position.entryPrice) * position.shares;
  const netPnl = grossPnl - position.entryCommission - exitCommission;
  const entryCost = position.entryPrice * position.shares + position.entryCommission;

  const trade: BacktestTrade = {
    id: position.id,
    symbol,
    entryDate: position.entryDate,
    exitDate: currentBar.label,
    entryPrice: round(position.entryPrice, 4),
    exitPrice: round(adjustedExitPrice, 4),
    shares: position.shares,
    grossPnl: round(grossPnl, 2),
    netPnl: round(netPnl, 2),
    returnPercent: round(entryCost > 0 ? (netPnl / entryCost) * 100 : 0, 2),
    barsHeld: Math.max(currentIndex - position.entryBarIndex + 1, 1),
    exitReason: reason,
  };

  return {
    cash: cash + grossExitAmount - exitCommission,
    trade,
  };
}

function buildMetrics(
  {
    equityCurve,
    initialCapital,
    rangeDayCount,
    trades,
    exposureBars,
  }: {
    equityCurve: BacktestEquityPoint[];
    initialCapital: number;
    rangeDayCount: number;
    trades: BacktestTrade[];
    exposureBars: number;
  },
) {
  const endingEquity = equityCurve.at(-1)?.equity ?? initialCapital;
  const totalReturn =
    initialCapital === 0 ? 0 : ((endingEquity / initialCapital) - 1) * 100;
  const wins = trades.filter((trade) => trade.netPnl > 0);
  const losses = trades.filter((trade) => trade.netPnl < 0);
  const grossProfit = wins.reduce((total, trade) => total + trade.netPnl, 0);
  const grossLoss = losses.reduce((total, trade) => total + Math.abs(trade.netPnl), 0);
  const averageGain = average(wins.map((trade) => trade.returnPercent)) ?? 0;
  const averageLoss = average(losses.map((trade) => trade.returnPercent)) ?? 0;
  const maxDrawdown = Math.abs(
    Math.min(...equityCurve.map((point) => point.drawdown), 0),
  );
  const durationDays =
    equityCurve.length > 1
      ? Math.max(
          (Date.parse(equityCurve.at(-1)?.date ?? "") -
            Date.parse(equityCurve[0]?.date ?? "")) /
            DAY_MS,
          0,
        )
      : 0;
  const cagr =
    durationDays >= 365
      ? round((Math.pow(endingEquity / initialCapital, 365 / durationDays) - 1) * 100, 2)
      : null;

  return {
    startingCapital: round(initialCapital, 2),
    endingEquity: round(endingEquity, 2),
    totalReturn: round(totalReturn, 2),
    cagr,
    winRate: round(trades.length > 0 ? (wins.length / trades.length) * 100 : 0, 2),
    averageGain: round(averageGain, 2),
    averageLoss: round(averageLoss, 2),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 2) : null,
    maxDrawdown: round(maxDrawdown, 2),
    numberOfTrades: trades.length,
    exposure: round(rangeDayCount > 0 ? (exposureBars / rangeDayCount) * 100 : 0, 2),
  } satisfies BacktestMetrics;
}

export function getBacktestStrategyLabel(strategy: BacktestStrategyProfile) {
  return STRATEGY_LABELS[strategy];
}

export function normalizeBacktestRequest(
  payload: Partial<BacktestRequest> | null | undefined,
): BacktestRequest {
  const symbol = normalizeBistSymbol(payload?.symbol ?? "");
  const dateFrom = String(payload?.dateFrom ?? "").trim();
  const dateTo = String(payload?.dateTo ?? "").trim();
  const strategy = (payload?.strategy ?? "rank-score") as BacktestStrategyProfile;
  const initialCapital = normalizeNumber(payload?.initialCapital, DEFAULT_INITIAL_CAPITAL);
  const maxOpenPositions = normalizeInteger(payload?.maxOpenPositions, 1);
  const commissionPercent = normalizeNumber(
    payload?.commissionPercent,
    DEFAULT_COMMISSION_PERCENT,
  );
  const slippagePercent = normalizeNumber(
    payload?.slippagePercent,
    DEFAULT_SLIPPAGE_PERCENT,
  );
  const stopLossPercent = normalizeNumber(payload?.stopLossPercent, 8);
  const takeProfitPercent = normalizeNumber(payload?.takeProfitPercent, 16);
  const trailingStopPercent = normalizeNumber(payload?.trailingStopPercent, 6);
  const positionSizingMode = payload?.positionSizing?.mode ?? "percent_of_equity";
  const positionSizingValue = normalizeNumber(payload?.positionSizing?.value, 20);

  if (!symbol) {
    throw new Error("Sembol zorunludur.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    throw new Error("Tarih araligi gecersiz.");
  }

  const supportedStrategies = Object.keys(STRATEGY_LABELS);
  if (!supportedStrategies.includes(strategy)) {
    throw new Error("Strateji profili desteklenmiyor.");
  }

  const startTimestamp = parseIsoDate(dateFrom);
  const endTimestamp = parseIsoDate(dateTo);

  if (startTimestamp >= endTimestamp) {
    throw new Error("Baslangic tarihi bitis tarihinden once olmalidir.");
  }

  if (!Number.isFinite(initialCapital) || initialCapital <= 0) {
    throw new Error("Baslangic sermayesi gecersiz.");
  }

  if (maxOpenPositions < 1 || maxOpenPositions > 10) {
    throw new Error("Acik pozisyon limiti 1 ile 10 arasinda olmalidir.");
  }

  validatePercentRange(commissionPercent, "Komisyon", {
    max: 5,
  });
  validatePercentRange(slippagePercent, "Slippage", {
    max: 5,
  });
  validatePercentRange(stopLossPercent, "Stop-loss", {
    max: 50,
  });
  validatePercentRange(takeProfitPercent, "Take-profit", {
    max: 200,
  });
  validatePercentRange(trailingStopPercent, "Trailing stop", {
    max: 50,
  });

  if (
    positionSizingMode !== "percent_of_equity" &&
    positionSizingMode !== "fixed_amount" &&
    positionSizingMode !== "risk_based"
  ) {
    throw new Error("Pozisyon boyutlama modu gecersiz.");
  }

  if (!Number.isFinite(positionSizingValue) || positionSizingValue <= 0) {
    throw new Error("Pozisyon boyutlama degeri gecersiz.");
  }

  if (positionSizingMode === "percent_of_equity") {
    validatePercentRange(positionSizingValue, "Pozisyon yuzdesi", {
      max: 100,
      allowZero: false,
    });
  }

  if (positionSizingMode === "risk_based") {
    validatePercentRange(positionSizingValue, "Risk butcesi", {
      max: 25,
      allowZero: false,
    });

    if (stopLossPercent <= 0) {
      throw new Error("Risk bazli boyutlama icin stop-loss sifirdan buyuk olmali.");
    }
  }

  return {
    symbol,
    dateFrom,
    dateTo,
    strategy,
    initialCapital: round(initialCapital, 2),
    maxOpenPositions,
    commissionPercent: round(commissionPercent, 4),
    slippagePercent: round(slippagePercent, 4),
    stopLossPercent: round(stopLossPercent, 4),
    takeProfitPercent: round(takeProfitPercent, 4),
    trailingStopPercent: round(trailingStopPercent, 4),
    positionSizing: {
      mode: positionSizingMode,
      value: round(positionSizingValue, 4),
    },
  };
}

export function runBacktest({
  input,
  symbolData,
  benchmarkData,
  warnings: initialWarnings = [],
}: RunBacktestOptions): BacktestResponse {
  const warnings = [...initialWarnings];
  const symbolSeries = [...symbolData.series].sort((left, right) => left.timestamp - right.timestamp);
  const benchmarkSeries = benchmarkData
    ? [...benchmarkData.series].sort((left, right) => left.timestamp - right.timestamp)
    : undefined;

  if (symbolSeries.length < MIN_LOOKBACK_BARS) {
    throw new Error("Backtest icin yeterli fiyat gecmisi yok.");
  }

  const startIndex = findRangeStartIndex(symbolSeries, input.dateFrom);
  const endIndex = findRangeEndIndex(symbolSeries, input.dateTo);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error("Secilen tarih araliginda fiyat verisi bulunamadi.");
  }

  const rangeDayCount = endIndex - startIndex + 1;
  if (rangeDayCount < MIN_RANGE_BARS) {
    throw new Error("Secilen tarih araligi cok kisa. En az 20 islem gunu gerekli.");
  }

  if (startIndex < MIN_LOOKBACK_BARS) {
    warnings.push(
      "Secili donemin basinda indikator warmup verisi kisitli; ilk sinyaller daha gec olusabilir.",
    );
  }

  if (!benchmarkSeries && input.strategy === "rank-score") {
    warnings.push(
      "Benchmark serisi alinamadi; rank-score stratejisi notr piyasa rejimi varsayimi ile calisti.",
    );
  }

  let cash = input.initialCapital;
  let rollingPeak = input.initialCapital;
  let exposureBars = 0;
  let sequence = 0;
  const openPositions: OpenPosition[] = [];
  const trades: BacktestTrade[] = [];
  const equityCurve: BacktestEquityPoint[] = [];

  for (let index = startIndex; index <= endIndex; index += 1) {
    const currentBar = symbolSeries[index] as Candle;
    const priorSeries = symbolSeries.slice(0, index);
    const priorBenchmarkSeries = sliceSeriesUntilTimestamp(
      benchmarkSeries,
      (currentBar.timestamp - 1),
    );
    const strategy = evaluateStrategy(input.strategy, priorSeries, priorBenchmarkSeries);

    if (strategy.exit && openPositions.length > 0) {
      while (openPositions.length > 0) {
        const position = openPositions.shift();

        if (!position) {
          continue;
        }

        const result = closePosition(position, {
          currentBar,
          currentIndex: index,
          exitPrice: currentBar.open,
          reason: "signal_exit",
          input,
          symbol: symbolData.symbol,
          cash,
        });

        cash = result.cash;
        trades.push(result.trade);
      }
    }

    const markedEquityBeforeEntry =
      cash +
      openPositions.reduce((total, position) => total + position.shares * currentBar.open, 0);

    if (strategy.enter && openPositions.length < input.maxOpenPositions) {
      const shares = calculateOrderSize(input, cash, markedEquityBeforeEntry, currentBar.open);

      if (shares > 0) {
        const adjustedEntryPrice = round(
          applyBuySlippage(currentBar.open, input.slippagePercent),
          4,
        );
        const grossAmount = adjustedEntryPrice * shares;
        const entryCommission = commissionAmount(grossAmount, input.commissionPercent);
        const totalCost = grossAmount + entryCommission;

        if (totalCost <= cash) {
          sequence += 1;
          cash -= totalCost;
          openPositions.push({
            id: `${symbolData.symbol}-${currentBar.timestamp}-${sequence}`,
            entryBarIndex: index,
            entryDate: currentBar.label,
            entryPrice: adjustedEntryPrice,
            entryCommission: round(entryCommission, 2),
            peakPrice: currentBar.open,
            shares,
            stopLossPrice:
              input.stopLossPercent > 0
                ? round(adjustedEntryPrice * (1 - input.stopLossPercent / 100), 4)
                : null,
            takeProfitPrice:
              input.takeProfitPercent > 0
                ? round(adjustedEntryPrice * (1 + input.takeProfitPercent / 100), 4)
                : null,
            trailingStopPrice:
              input.trailingStopPercent > 0
                ? round(adjustedEntryPrice * (1 - input.trailingStopPercent / 100), 4)
                : null,
          });
        }
      }
    }

    const wasExposedToday = openPositions.length > 0;

    for (let positionIndex = openPositions.length - 1; positionIndex >= 0; positionIndex -= 1) {
      const position = openPositions[positionIndex];

      if (!position) {
        continue;
      }

      let exitReason: ExitReason | null = null;
      let exitPrice = 0;

      if (position.stopLossPrice !== null && currentBar.open <= position.stopLossPrice) {
        exitReason = "stop_loss";
        exitPrice = currentBar.open;
      } else if (
        position.trailingStopPrice !== null &&
        currentBar.open <= position.trailingStopPrice
      ) {
        exitReason = "trailing_stop";
        exitPrice = currentBar.open;
      } else if (
        position.stopLossPrice !== null &&
        currentBar.low <= position.stopLossPrice
      ) {
        exitReason = "stop_loss";
        exitPrice = position.stopLossPrice;
      } else if (
        position.trailingStopPrice !== null &&
        currentBar.low <= position.trailingStopPrice
      ) {
        exitReason = "trailing_stop";
        exitPrice = position.trailingStopPrice;
      } else if (
        position.takeProfitPrice !== null &&
        currentBar.high >= position.takeProfitPrice
      ) {
        exitReason = "take_profit";
        exitPrice = position.takeProfitPrice;
      }

      if (exitReason) {
        const [removedPosition] = openPositions.splice(positionIndex, 1);

        if (!removedPosition) {
          continue;
        }

        const result = closePosition(removedPosition, {
          currentBar,
          currentIndex: index,
          exitPrice,
          reason: exitReason,
          input,
          symbol: symbolData.symbol,
          cash,
        });

        cash = result.cash;
        trades.push(result.trade);
        continue;
      }

      if (input.trailingStopPercent > 0) {
        position.peakPrice = Math.max(position.peakPrice, currentBar.high);
        position.trailingStopPrice = round(
          position.peakPrice * (1 - input.trailingStopPercent / 100),
          4,
        );
      }
    }

    if (index === endIndex && openPositions.length > 0) {
      while (openPositions.length > 0) {
        const position = openPositions.shift();

        if (!position) {
          continue;
        }

        const result = closePosition(position, {
          currentBar,
          currentIndex: index,
          exitPrice: currentBar.close,
          reason: "end_of_test",
          input,
          symbol: symbolData.symbol,
          cash,
        });

        cash = result.cash;
        trades.push(result.trade);
      }
    }

    if (wasExposedToday) {
      exposureBars += 1;
    }

    const equity =
      cash +
      openPositions.reduce((total, position) => total + position.shares * currentBar.close, 0);
    rollingPeak = Math.max(rollingPeak, equity);
    const drawdown = rollingPeak === 0 ? 0 : ((equity / rollingPeak) - 1) * 100;

    equityCurve.push({
      date: currentBar.label,
      equity: round(equity, 2),
      cash: round(cash, 2),
      drawdown: round(drawdown, 2),
    });
  }

  if (equityCurve.length === 0) {
    throw new Error("Backtest sonucu olusturulamadi.");
  }

  return {
    symbol: symbolData.symbol,
    displaySymbol: symbolData.displaySymbol,
    currency: symbolData.currency,
    strategy: input.strategy,
    strategyLabel: getBacktestStrategyLabel(input.strategy),
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    metrics: buildMetrics({
      equityCurve,
      initialCapital: input.initialCapital,
      rangeDayCount,
      trades,
      exposureBars,
    }),
    equityCurve,
    trades,
    warnings,
    input,
  };
}

export function getBacktestWarmupDays(strategy: BacktestStrategyProfile) {
  switch (strategy) {
    case "breakout":
      return 180;
    case "rank-score":
    case "momentum":
    case "mean-reversion":
    default:
      return 150;
  }
}
