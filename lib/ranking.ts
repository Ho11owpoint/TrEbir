import { round } from "./analysis";
import type {
  IndicatorSet,
  MarketContext,
  RankScoreBreakdown,
  RankScoreContributionMap,
  RankScoreFactor,
  Signal,
} from "./types";

const SIGNAL_BASELINE = 50;
const SIGNAL_WEIGHT = 0.78;

interface RankScoreSnapshotLike {
  price: number;
  indicators: Pick<
    IndicatorSet,
    "momentum21" | "volatility21" | "rsi14" | "fiftyTwoWeekHigh"
  >;
  signal: Pick<Signal, "score">;
}

export interface ExplainableRankScoreResult {
  score: number;
  breakdown: RankScoreBreakdown;
}

function impactFromContribution(value: number): RankScoreFactor["impact"] {
  if (value > 0.01) {
    return "positive";
  }

  if (value < -0.01) {
    return "negative";
  }

  return "neutral";
}

function createFactor(
  key: RankScoreFactor["key"],
  label: string,
  contribution: number,
  code: string,
  summary: string,
): RankScoreFactor {
  return {
    key,
    label,
    contribution: round(contribution, 2),
    impact: impactFromContribution(contribution),
    code,
    summary,
  };
}

function buildTopFactors(
  factors: RankScoreFactor[],
  impact: RankScoreFactor["impact"],
) {
  return factors
    .filter((factor) => factor.impact === impact && factor.key !== "base_signal")
    .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution))
    .slice(0, 3);
}

function joinFactorSummaries(factors: RankScoreFactor[]) {
  return factors.map((factor) => factor.summary).join(", ");
}

function buildSummary(
  topPositiveFactors: RankScoreFactor[],
  topNegativeFactors: RankScoreFactor[],
) {
  if (topPositiveFactors.length > 0 && topNegativeFactors.length > 0) {
    return `${joinFactorSummaries(topPositiveFactors.slice(0, 2))} puani destekliyor; ${joinFactorSummaries(topNegativeFactors.slice(0, 2))} skoru asagi cekiyor.`;
  }

  if (topPositiveFactors.length > 0) {
    return `${joinFactorSummaries(topPositiveFactors.slice(0, 2))} sayesinde hisse ust siralarda yer aliyor.`;
  }

  if (topNegativeFactors.length > 0) {
    return `${joinFactorSummaries(topNegativeFactors.slice(0, 2))} nedeniyle hisse daha geride kaliyor.`;
  }

  return "Skor notr bir dagilimla olustu; belirgin bir itici veya baskilayici faktor yok.";
}

export function buildRankScoreBreakdown(
  snapshot: RankScoreSnapshotLike,
  benchmark: Pick<MarketContext, "trend">,
): ExplainableRankScoreResult {
  const momentum = snapshot.indicators.momentum21 ?? 0;
  const volatility = snapshot.indicators.volatility21 ?? 40;
  const rsi = snapshot.indicators.rsi14 ?? 50;
  const nearHigh =
    snapshot.indicators.fiftyTwoWeekHigh && snapshot.indicators.fiftyTwoWeekHigh > 0
      ? (snapshot.price / snapshot.indicators.fiftyTwoWeekHigh) * 100
      : 90;
  const benchmarkBoost =
    benchmark.trend === "risk-on" ? 6 : benchmark.trend === "neutral" ? 0 : -8;
  const volatilityPenalty = Math.max(volatility - 24, 0) * 0.22;
  const rsiPenalty = rsi > 72 ? (rsi - 72) * 0.8 : 0;
  const proximityToHighContribution = nearHigh >= 94 ? 5 : nearHigh >= 88 ? 2 : -2;
  const baseSignalContribution = SIGNAL_BASELINE * SIGNAL_WEIGHT;
  const trendContribution = (snapshot.signal.score - SIGNAL_BASELINE) * SIGNAL_WEIGHT;
  const momentumContribution = momentum * 1.2;
  const marketRegimeAdjustment = benchmarkBoost;
  const liquidityPenalty = 0;
  const riskPenalty = 0;
  const rawScore =
    baseSignalContribution +
    trendContribution +
    momentumContribution +
    proximityToHighContribution +
    marketRegimeAdjustment -
    volatilityPenalty -
    rsiPenalty -
    liquidityPenalty -
    riskPenalty;
  const score = round(rawScore, 2);
  const contributions: RankScoreContributionMap = {
    baseSignalContribution: round(baseSignalContribution, 2),
    trendContribution: round(trendContribution, 2),
    momentumContribution: round(momentumContribution, 2),
    volatilityPenalty: round(-volatilityPenalty, 2),
    rsiPenalty: round(-rsiPenalty, 2),
    proximityToHighContribution: round(proximityToHighContribution, 2),
    marketRegimeAdjustment: round(marketRegimeAdjustment, 2),
    liquidityPenalty: round(-liquidityPenalty, 2),
    riskPenalty: round(-riskPenalty, 2),
  };

  const factors: RankScoreFactor[] = [
    createFactor(
      "base_signal",
      "Signal baseline",
      contributions.baseSignalContribution,
      "signal_baseline",
      "50 puanlik notr signal tabani",
    ),
    createFactor(
      "trend",
      "Trend contribution",
      contributions.trendContribution,
      contributions.trendContribution > 0
        ? "signal_above_neutral"
        : contributions.trendContribution < 0
          ? "signal_below_neutral"
          : "signal_neutral",
      contributions.trendContribution > 0
        ? "signal skoru notr bazin ustunde"
        : contributions.trendContribution < 0
          ? "signal skoru notr bazin altinda"
          : "signal skoru notr bolgede",
    ),
    createFactor(
      "momentum",
      "Momentum contribution",
      contributions.momentumContribution,
      contributions.momentumContribution > 6
        ? "momentum_strong"
        : contributions.momentumContribution > 0
          ? "momentum_positive"
          : contributions.momentumContribution < -6
            ? "momentum_weak"
            : contributions.momentumContribution < 0
              ? "momentum_negative"
              : "momentum_flat",
      contributions.momentumContribution > 6
        ? "guclu aylik momentum"
        : contributions.momentumContribution > 0
          ? "pozitif aylik momentum"
          : contributions.momentumContribution < -6
            ? "sert momentum kaybi"
            : contributions.momentumContribution < 0
              ? "zayif momentum"
              : "notr momentum",
    ),
    createFactor(
      "volatility",
      "Volatility penalty",
      contributions.volatilityPenalty,
      volatilityPenalty > 0 ? "volatility_penalty" : "volatility_ok",
      volatilityPenalty > 0
        ? "yuksek volatilite ceza yaziyor"
        : "volatilite kontrol altinda",
    ),
    createFactor(
      "rsi",
      "RSI penalty",
      contributions.rsiPenalty,
      rsiPenalty > 0 ? "rsi_overheated" : "rsi_balanced",
      rsiPenalty > 0
        ? "RSI asiri isinmis gorunuyor"
        : "RSI dengeli bolgede",
    ),
    createFactor(
      "proximity_to_high",
      "52-week high proximity",
      contributions.proximityToHighContribution,
      proximityToHighContribution >= 5
        ? "near_high_breakout"
        : proximityToHighContribution > 0
          ? "near_high_supportive"
          : "far_from_high_penalty",
      proximityToHighContribution >= 5
        ? "52 hafta zirvesine cok yakin"
        : proximityToHighContribution > 0
          ? "52 hafta zirvesine gore yapici bolgede"
          : "zirveye uzaklik puani baskiliyor",
    ),
    createFactor(
      "market_regime",
      "Market regime adjustment",
      contributions.marketRegimeAdjustment,
      benchmark.trend === "risk-on"
        ? "market_risk_on"
        : benchmark.trend === "risk-off"
          ? "market_risk_off"
          : "market_neutral",
      benchmark.trend === "risk-on"
        ? "piyasa rejimi risk alma lehine"
        : benchmark.trend === "risk-off"
          ? "piyasa rejimi savunmaci"
          : "piyasa rejimi notr",
    ),
    createFactor(
      "liquidity",
      "Liquidity penalty",
      contributions.liquidityPenalty,
      "liquidity_not_used",
      "likidite cezasi uygulanmadi",
    ),
    createFactor(
      "risk",
      "Risk penalty",
      contributions.riskPenalty,
      "risk_penalty_not_used",
      "ek risk cezasi uygulanmadi",
    ),
  ];
  const topPositiveFactors = buildTopFactors(factors, "positive");
  const topNegativeFactors = buildTopFactors(factors, "negative");
  const explanationCodes = factors
    .filter((factor) => factor.key !== "base_signal" && factor.impact !== "neutral")
    .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution))
    .map((factor) => factor.code)
    .slice(0, 6);

  return {
    score,
    breakdown: {
      score,
      rawScore: round(rawScore, 4),
      contributions,
      factors,
      topPositiveFactors,
      topNegativeFactors,
      filterWarnings: [],
      explanationCodes,
      summary: buildSummary(topPositiveFactors, topNegativeFactors),
    },
  };
}

export function buildRankScore(
  snapshot: RankScoreSnapshotLike,
  benchmark: Pick<MarketContext, "trend">,
) {
  return buildRankScoreBreakdown(snapshot, benchmark).score;
}
