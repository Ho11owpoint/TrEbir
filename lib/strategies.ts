import { round } from "./analysis";
import { buildRankScoreBreakdown } from "./ranking";
import type {
  Candle,
  MarketContext,
  MarketSnapshot,
  StrategyEvaluationResult,
  StrategyProfileDescriptor,
  StrategyProfileId,
  StrategyScoreBreakdown,
  StrategyScoreFactor,
} from "./types";

interface StrategyProfile {
  descriptor: StrategyProfileDescriptor;
  evaluate(snapshot: MarketSnapshot, benchmark: Pick<MarketContext, "trend">): StrategyEvaluationResult;
}

function factorImpact(value: number): StrategyScoreFactor["impact"] {
  if (value > 0.01) {
    return "positive";
  }

  if (value < -0.01) {
    return "negative";
  }

  return "neutral";
}

function createFactor(
  key: StrategyScoreFactor["key"],
  label: string,
  contribution: number,
  code: string,
  summary: string,
): StrategyScoreFactor {
  return {
    key,
    label,
    contribution: round(contribution, 2),
    impact: factorImpact(contribution),
    code,
    summary,
  };
}

function topFactors(
  factors: StrategyScoreFactor[],
  impact: StrategyScoreFactor["impact"],
) {
  return factors
    .filter((factor) => factor.impact === impact)
    .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution))
    .slice(0, 3);
}

function buildSummary(
  topPositiveFactors: StrategyScoreFactor[],
  topNegativeFactors: StrategyScoreFactor[],
  filterWarnings: string[],
) {
  const positives = topPositiveFactors.slice(0, 2).map((factor) => factor.summary);
  const negatives = topNegativeFactors.slice(0, 2).map((factor) => factor.summary);

  if (filterWarnings.length > 0) {
    return `${positives.join(", ") || "Bazi faktorler"} puani destekliyor; ${filterWarnings
      .slice(0, 2)
      .join(", ")} nedeniyle secim daha temkinli okunmali.`;
  }

  if (positives.length > 0 && negatives.length > 0) {
    return `${positives.join(", ")} puani destekliyor; ${negatives.join(", ")} skoru baskiliyor.`;
  }

  if (positives.length > 0) {
    return `${positives.join(", ")} sayesinde hisse ust siralara cikiyor.`;
  }

  if (negatives.length > 0) {
    return `${negatives.join(", ")} nedeniyle strateji skoru baskilaniyor.`;
  }

  return "Strateji skoru notr dagilimla olustu.";
}

function buildBreakdown(
  score: number,
  rawScore: number,
  contributions: Record<string, number>,
  factors: StrategyScoreFactor[],
  filterWarnings: string[],
): StrategyScoreBreakdown {
  const topPositiveFactors = topFactors(factors, "positive");
  const topNegativeFactors = topFactors(factors, "negative");

  return {
    score: round(score, 2),
    rawScore: round(rawScore, 4),
    contributions,
    factors,
    topPositiveFactors,
    topNegativeFactors,
    filterWarnings,
    explanationCodes: factors
      .filter((factor) => factor.impact !== "neutral")
      .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution))
      .map((factor) => factor.code)
      .slice(0, 6),
    summary: buildSummary(topPositiveFactors, topNegativeFactors, filterWarnings),
  };
}

function averageVolume(series: Candle[], window: number) {
  const subset = series.slice(-window);

  if (subset.length === 0) {
    return 0;
  }

  return subset.reduce((total, candle) => total + candle.volume, 0) / subset.length;
}

function evaluateRankScoreProfile(
  snapshot: MarketSnapshot,
  benchmark: Pick<MarketContext, "trend">,
): StrategyEvaluationResult {
  const result = buildRankScoreBreakdown(snapshot, benchmark);

  return {
    strategy: "rank-score",
    strategyLabel: "Rank Score",
    score: result.score,
    passesFilters: snapshot.signal.action !== "reduce",
    filterWarnings:
      snapshot.signal.action === "reduce"
        ? ["Temel signal davranisi savunmaci bolgede."]
        : [],
    breakdown: result.breakdown,
  };
}

function evaluateMomentumProfile(
  snapshot: MarketSnapshot,
  benchmark: Pick<MarketContext, "trend">,
): StrategyEvaluationResult {
  const momentum = snapshot.indicators.momentum21 ?? 0;
  const rsi = snapshot.indicators.rsi14 ?? 50;
  const sma20 = snapshot.indicators.sma20 ?? snapshot.price;
  const sma50 = snapshot.indicators.sma50 ?? snapshot.price;
  const volatility = snapshot.indicators.volatility21 ?? 35;
  const trendContribution = (snapshot.signal.score - 50) * 0.45;
  const momentumContribution = momentum * 1.8;
  const maContribution = snapshot.price >= sma20 && sma20 >= sma50 ? 18 : -12;
  const marketContribution = benchmark.trend === "risk-on" ? 5 : benchmark.trend === "risk-off" ? -7 : 0;
  const volatilityPenalty = Math.max(volatility - 34, 0) * 0.24;
  const rsiPenalty = rsi > 74 ? (rsi - 74) * 0.75 : 0;
  const rawScore =
    52 +
    trendContribution +
    momentumContribution +
    maContribution +
    marketContribution -
    volatilityPenalty -
    rsiPenalty;
  const filterWarnings: string[] = [];

  if (momentum < 4) {
    filterWarnings.push("Istenen momentum esigi tam olarak saglanmiyor.");
  }

  if (snapshot.price < sma20) {
    filterWarnings.push("Fiyat kisa vade ortalamanin altinda.");
  }

  const factors = [
    createFactor(
      "momentum",
      "Momentum contribution",
      momentumContribution,
      momentumContribution >= 8 ? "momentum_strong" : "momentum_soft",
      momentumContribution >= 8 ? "guclu ivme korunuyor" : "ivme pozitif ama sinirli",
    ),
    createFactor(
      "trend",
      "Trend contribution",
      trendContribution,
      trendContribution >= 0 ? "trend_supportive" : "trend_soft",
      trendContribution >= 0 ? "temel trend yapisi destekleyici" : "trend ivmesi zayifliyor",
    ),
    createFactor(
      "ma_crossover",
      "MA alignment",
      maContribution,
      maContribution > 0 ? "ma_trend_aligned" : "ma_trend_misaligned",
      maContribution > 0 ? "hareketli ortalamalar yukari yonlu dizilmis" : "MA dizilimi momentumla uyumlu degil",
    ),
    createFactor(
      "market_regime",
      "Market regime adjustment",
      marketContribution,
      benchmark.trend === "risk-on" ? "market_risk_on" : "market_risk_off",
      benchmark.trend === "risk-on" ? "piyasa ivme stratejisini destekliyor" : "piyasa kosullari ivme icin sert",
    ),
    createFactor(
      "volatility",
      "Volatility penalty",
      -volatilityPenalty,
      volatilityPenalty > 0 ? "volatility_penalty" : "volatility_ok",
      volatilityPenalty > 0 ? "volatilite ivme takip maliyetini artiriyor" : "volatilite kabul edilebilir",
    ),
    createFactor(
      "rsi",
      "RSI penalty",
      -rsiPenalty,
      rsiPenalty > 0 ? "rsi_overheated" : "rsi_balanced",
      rsiPenalty > 0 ? "RSI cok sicak, devam marji daralabilir" : "RSI ivmeyi tasiyor",
    ),
  ];

  return {
    strategy: "momentum",
    strategyLabel: "Momentum",
    score: round(rawScore, 2),
    passesFilters: filterWarnings.length === 0,
    filterWarnings,
    breakdown: buildBreakdown(
      rawScore,
      rawScore,
      {
        trendContribution: round(trendContribution, 2),
        momentumContribution: round(momentumContribution, 2),
        maContribution: round(maContribution, 2),
        marketContribution: round(marketContribution, 2),
        volatilityPenalty: round(-volatilityPenalty, 2),
        rsiPenalty: round(-rsiPenalty, 2),
      },
      factors,
      filterWarnings,
    ),
  };
}

function evaluateBreakoutProfile(
  snapshot: MarketSnapshot,
  benchmark: Pick<MarketContext, "trend">,
): StrategyEvaluationResult {
  const series = snapshot.series;
  const latest = series.at(-1);
  const priorWindow = series.slice(-21, -1);
  const breakoutLevel = priorWindow.length > 0 ? Math.max(...priorWindow.map((bar) => bar.high)) : snapshot.price;
  const volume20 = averageVolume(series.slice(0, -1), 20);
  const latestVolume = latest?.volume ?? 0;
  const breakoutDistance =
    breakoutLevel > 0 ? ((snapshot.price / breakoutLevel) - 1) * 100 : 0;
  const volumeContribution =
    volume20 > 0 ? Math.min(((latestVolume / volume20) - 1) * 22, 18) : 0;
  const breakoutContribution =
    breakoutDistance >= 0 ? Math.min(breakoutDistance * 18, 24) : Math.max(breakoutDistance * 14, -18);
  const maContribution =
    snapshot.indicators.sma20 !== null && snapshot.price > (snapshot.indicators.sma20 ?? 0)
      ? 10
      : -8;
  const marketContribution = benchmark.trend === "risk-on" ? 4 : benchmark.trend === "risk-off" ? -6 : 0;
  const volatilityPenalty = Math.max((snapshot.indicators.volatility21 ?? 36) - 42, 0) * 0.28;
  const rawScore =
    50 +
    breakoutContribution +
    volumeContribution +
    maContribution +
    marketContribution -
    volatilityPenalty;
  const filterWarnings: string[] = [];

  if (breakoutDistance < 0) {
    filterWarnings.push("Fiyat henuz breakout seviyesinin ustune cikmadi.");
  }

  if (volume20 > 0 && latestVolume < volume20) {
    filterWarnings.push("Hacim teyidi zayif kaliyor.");
  }

  const factors = [
    createFactor(
      "breakout_distance",
      "Breakout distance",
      breakoutContribution,
      breakoutContribution > 0 ? "breakout_above_trigger" : "breakout_below_trigger",
      breakoutContribution > 0 ? "fiyat breakout seviyesinin ustunde" : "breakout esigi asilmadi",
    ),
    createFactor(
      "volume_confirmation",
      "Volume confirmation",
      volumeContribution,
      volumeContribution > 0 ? "volume_confirmed" : "volume_soft",
      volumeContribution > 0 ? "hacim kirilimi destekliyor" : "hacim teyidi sinirli",
    ),
    createFactor(
      "ma_crossover",
      "Trend alignment",
      maContribution,
      maContribution > 0 ? "ma_trend_aligned" : "ma_trend_misaligned",
      maContribution > 0 ? "fiyat kisa ortalamanin ustunde" : "fiyat kisa ortalama altinda",
    ),
    createFactor(
      "market_regime",
      "Market regime adjustment",
      marketContribution,
      benchmark.trend === "risk-on" ? "market_risk_on" : "market_risk_off",
      benchmark.trend === "risk-on" ? "piyasa kirilim stratejisini destekliyor" : "piyasa kirilimlar icin ters ruzgar uretiyor",
    ),
    createFactor(
      "volatility",
      "Volatility penalty",
      -volatilityPenalty,
      volatilityPenalty > 0 ? "volatility_penalty" : "volatility_ok",
      volatilityPenalty > 0 ? "kirilim sonrasi oynaklik yuksek" : "oynaklik tolere edilebilir",
    ),
  ];

  return {
    strategy: "breakout",
    strategyLabel: "Breakout",
    score: round(rawScore, 2),
    passesFilters: filterWarnings.length === 0,
    filterWarnings,
    breakdown: buildBreakdown(
      rawScore,
      rawScore,
      {
        breakoutContribution: round(breakoutContribution, 2),
        volumeContribution: round(volumeContribution, 2),
        maContribution: round(maContribution, 2),
        marketContribution: round(marketContribution, 2),
        volatilityPenalty: round(-volatilityPenalty, 2),
      },
      factors,
      filterWarnings,
    ),
  };
}

function evaluateMeanReversionProfile(
  snapshot: MarketSnapshot,
  benchmark: Pick<MarketContext, "trend">,
): StrategyEvaluationResult {
  const series = snapshot.series;
  const recentWindow = series.slice(-20);
  const recentLow = recentWindow.length > 0 ? Math.min(...recentWindow.map((bar) => bar.low)) : snapshot.price;
  const distanceToLow =
    recentLow > 0 ? ((snapshot.price / recentLow) - 1) * 100 : 0;
  const rsi = snapshot.indicators.rsi14 ?? 50;
  const sma20 = snapshot.indicators.sma20 ?? snapshot.price;
  const oversoldContribution = rsi <= 35 ? 20 : rsi <= 42 ? 12 : -10;
  const pullbackContribution = distanceToLow <= 4 ? 14 : distanceToLow <= 8 ? 6 : -10;
  const maContribution = snapshot.price <= sma20 * 1.02 ? 8 : -8;
  const trendContribution = benchmark.trend === "risk-off" ? 4 : benchmark.trend === "risk-on" ? -3 : 0;
  const momentumPenalty = Math.max((snapshot.indicators.momentum21 ?? 0) - 8, 0) * 0.8;
  const volatilityPenalty = Math.max((snapshot.indicators.volatility21 ?? 35) - 48, 0) * 0.18;
  const rawScore =
    48 +
    oversoldContribution +
    pullbackContribution +
    maContribution +
    trendContribution -
    momentumPenalty -
    volatilityPenalty;
  const filterWarnings: string[] = [];

  if (rsi > 45) {
    filterWarnings.push("RSI mean reversion icin yeterince sikismis degil.");
  }

  if (distanceToLow > 8) {
    filterWarnings.push("Fiyat dip bolgesinden fazla uzaklasmis.");
  }

  const factors = [
    createFactor(
      "oversold_signal",
      "Oversold signal",
      oversoldContribution,
      oversoldContribution > 0 ? "rsi_oversold_ready" : "rsi_not_oversold",
      oversoldContribution > 0 ? "RSI tepki potansiyeli veriyor" : "RSI mean reversion icin sicak",
    ),
    createFactor(
      "pullback_zone",
      "Pullback zone",
      pullbackContribution,
      pullbackContribution > 0 ? "pullback_near_low" : "pullback_extended",
      pullbackContribution > 0 ? "fiyat tepki bolgesine yakin" : "fiyat dipten uzaklasmis",
    ),
    createFactor(
      "mean_reversion",
      "Mean reversion setup",
      maContribution,
      maContribution > 0 ? "price_below_mean" : "price_far_above_mean",
      maContribution > 0 ? "fiyat ortalamaya donus setupina uygun" : "fiyat ortalamadan kopuk",
    ),
    createFactor(
      "market_regime",
      "Market regime adjustment",
      trendContribution,
      benchmark.trend === "risk-off" ? "market_risk_off" : "market_neutral",
      benchmark.trend === "risk-off" ? "savunmaci ortam tepki tradeini destekliyor" : "piyasa mean reversion icin notr",
    ),
    createFactor(
      "momentum",
      "Momentum penalty",
      -momentumPenalty,
      momentumPenalty > 0 ? "momentum_too_hot" : "momentum_ok",
      momentumPenalty > 0 ? "asiri guclu momentum geri cekilme senaryosunu zayiflatiyor" : "momentum tepki setupini bozmuyor",
    ),
    createFactor(
      "volatility",
      "Volatility penalty",
      -volatilityPenalty,
      volatilityPenalty > 0 ? "volatility_penalty" : "volatility_ok",
      volatilityPenalty > 0 ? "oynaklik tepki tradeini zorlastiriyor" : "volatilite makul",
    ),
  ];

  return {
    strategy: "mean-reversion",
    strategyLabel: "Mean Reversion",
    score: round(rawScore, 2),
    passesFilters: filterWarnings.length === 0,
    filterWarnings,
    breakdown: buildBreakdown(
      rawScore,
      rawScore,
      {
        oversoldContribution: round(oversoldContribution, 2),
        pullbackContribution: round(pullbackContribution, 2),
        maContribution: round(maContribution, 2),
        trendContribution: round(trendContribution, 2),
        momentumPenalty: round(-momentumPenalty, 2),
        volatilityPenalty: round(-volatilityPenalty, 2),
      },
      factors,
      filterWarnings,
    ),
  };
}

const STRATEGY_REGISTRY: Record<StrategyProfileId, StrategyProfile> = {
  "rank-score": {
    descriptor: {
      id: "rank-score",
      label: "Rank Score",
      description: "Mevcut signal, momentum, volatilite ve piyasa rejimi karmasini kullanir.",
      inputs: [],
    },
    evaluate: evaluateRankScoreProfile,
  },
  momentum: {
    descriptor: {
      id: "momentum",
      label: "Momentum",
      description: "Guclu ivme, MA dizilimi ve piyasa destegine agirlik verir.",
      inputs: [
        {
          key: "momentum21",
          label: "21 gun ivme",
          type: "number",
          defaultValue: 5,
          description: "Ana giris esigi.",
        },
      ],
    },
    evaluate: evaluateMomentumProfile,
  },
  breakout: {
    descriptor: {
      id: "breakout",
      label: "Breakout",
      description: "20 gunluk direnclere yakinlasan ve hacimle teyit alan kurulumlari one cikarir.",
      inputs: [
        {
          key: "breakoutWindow",
          label: "Breakout pencere",
          type: "integer",
          defaultValue: 20,
          description: "Direnc hesabinda bakilan bar sayisi.",
        },
      ],
    },
    evaluate: evaluateBreakoutProfile,
  },
  "mean-reversion": {
    descriptor: {
      id: "mean-reversion",
      label: "Mean Reversion",
      description: "RSI ve dip bolgesine yakinlikla tepki alimi kurulumlarini tarar.",
      inputs: [
        {
          key: "rsiFloor",
          label: "RSI taban",
          type: "number",
          defaultValue: 35,
          description: "Asiri satim referansi.",
        },
      ],
    },
    evaluate: evaluateMeanReversionProfile,
  },
};

export function getStrategyProfileDescriptors() {
  return Object.values(STRATEGY_REGISTRY).map((profile) => profile.descriptor);
}

export function getStrategyProfileDescriptor(strategy: StrategyProfileId) {
  return STRATEGY_REGISTRY[strategy].descriptor;
}

export function evaluateStrategyProfile(
  strategy: StrategyProfileId,
  snapshot: MarketSnapshot,
  benchmark: Pick<MarketContext, "trend">,
) {
  return STRATEGY_REGISTRY[strategy].evaluate(snapshot, benchmark);
}
