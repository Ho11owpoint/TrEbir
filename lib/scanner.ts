import "server-only";

import { round } from "./analysis";
import { FAST_SCANNER_SYMBOLS } from "./defaults";
import { createEmptyEventIntelligence, enrichRecommendationsWithEvents } from "./events";
import { getBenchmarkContext, getMarketSnapshots } from "./market";
import { suggestPositionPlan } from "./risk";
import {
  evaluateStrategyProfile,
  getStrategyProfileDescriptor,
  getStrategyProfileDescriptors,
} from "./strategies";
import { getBistUniverse } from "./universe";
import type {
  MarketContext,
  MarketDataFailure,
  MarketSnapshot,
  RecommendationCandidate,
  ScannerResponse,
  StrategyEvaluationResult,
  StrategyProfileId,
  UniverseCompany,
} from "./types";

const SCANNER_CACHE_TTL_MS = 10 * 60 * 1000;
const RECOMMENDATION_LIMIT = 8;
const EVENT_AWARE_POOL_SIZE = 14;
const FAST_EVENT_AWARE_POOL_SIZE = 6;
const DEFAULT_SCAN_CONCURRENCY = 10;
const FAST_SCAN_CONCURRENCY = 6;

interface CapitalContext {
  cash: number;
  equity: number;
}

interface ScanDatasetItem {
  company: UniverseCompany;
  snapshot: MarketSnapshot;
}

interface EvaluatedScanItem extends ScanDatasetItem {
  evaluation: StrategyEvaluationResult;
  baselineScore: number;
  strategyScores: Partial<Record<StrategyProfileId, number>>;
  thesis: string[];
}

interface ScannerCache {
  generatedAt: string;
  benchmark: MarketContext;
  universeLabel: string;
  universeCount: number;
  sourceUniverseCount: number;
  analyzedCount: number;
  failedCount: number;
  providerSummary: ScannerResponse["providerSummary"];
  scanFailures: MarketDataFailure[];
  scanItems: ScanDatasetItem[];
  warnings: string[];
}

interface ScannerRankingSnapshot {
  generatedAt: string;
  benchmark: MarketContext;
  rankedItems: EvaluatedScanItem[];
}

let scannerCache: ScannerCache | undefined;
let runningScan: Promise<ScannerCache> | null = null;
let scanStartedAt: string | null = null;

function isFastScannerMode() {
  return process.env.SCANNER_UNIVERSE?.trim().toLowerCase() === "fast";
}

function selectScannerUniverse(universe: UniverseCompany[]) {
  if (!isFastScannerMode()) {
    return {
      companies: universe,
      concurrency: DEFAULT_SCAN_CONCURRENCY,
      label: "BIST Tum Hisseler",
      warnings: [] as string[],
    };
  }

  const companyMap = new Map(universe.map((company) => [company.symbol, company]));
  const companies = FAST_SCANNER_SYMBOLS.map((symbol) => companyMap.get(symbol)).filter(
    (company): company is UniverseCompany => company !== undefined,
  );

  return {
    companies,
    concurrency: FAST_SCAN_CONCURRENCY,
    label: `BIST Hizli Tarama Evreni (${companies.length} sembol)`,
    warnings: [
      `Scanner hizli modda calisiyor; ${companies.length} likit sembolden olusan daraltulmis evren kullaniliyor.`,
      `Kaynak evren: ${universe.length} BIST sirketi.`,
    ],
  };
}

function buildThesis(
  snapshot: MarketSnapshot,
  benchmark: MarketContext,
  evaluation: StrategyEvaluationResult,
) {
  const thesis = [...snapshot.signal.reasons];

  if (benchmark.trend === "risk-on") {
    thesis.unshift("Genel piyasa tonu alicilari destekliyor; secimlerde momentum daha fazla onem kazaniyor.");
  } else if (benchmark.trend === "risk-off") {
    thesis.unshift("Genel piyasa savunmaci; onerilen tutar risk disipliniyle sinirlandi.");
  }

  thesis.push(...evaluation.filterWarnings.slice(0, 2));

  return [...new Set(thesis)].slice(0, 5);
}

function buildFailureSummary(errors: MarketDataFailure[]) {
  const map = new Map<ScannerResponse["failureSummary"][number]["type"], number>();

  errors.forEach((error) => {
    map.set(error.type, (map.get(error.type) ?? 0) + 1);
  });

  return [...map.entries()]
    .map(([type, count]) => ({
      type,
      count,
    }))
    .sort((left, right) => right.count - left.count);
}

function sortEvaluatedItems(items: EvaluatedScanItem[]) {
  return [...items].sort((left, right) => {
    if (Number(right.evaluation.passesFilters) !== Number(left.evaluation.passesFilters)) {
      return Number(right.evaluation.passesFilters) - Number(left.evaluation.passesFilters);
    }

    if (right.evaluation.score !== left.evaluation.score) {
      return right.evaluation.score - left.evaluation.score;
    }

    return right.snapshot.signal.score - left.snapshot.signal.score;
  });
}

function evaluateScanItems(
  cache: ScannerCache,
  strategy: StrategyProfileId,
): EvaluatedScanItem[] {
  return sortEvaluatedItems(
    cache.scanItems.map((item) => {
      const strategyScores = getStrategyProfileDescriptors().reduce<
        Partial<Record<StrategyProfileId, number>>
      >((scores, descriptor) => {
        scores[descriptor.id] = evaluateStrategyProfile(
          descriptor.id,
          item.snapshot,
          cache.benchmark,
        ).score;
        return scores;
      }, {});
      const evaluation = evaluateStrategyProfile(strategy, item.snapshot, cache.benchmark);
      const baselineScore = strategyScores["rank-score"] ?? evaluation.score;

      return {
        ...item,
        evaluation,
        baselineScore,
        strategyScores,
        thesis: buildThesis(item.snapshot, cache.benchmark, evaluation),
      };
    }),
  );
}

function buildStrategySummary(cache: ScannerCache, strategy: StrategyProfileId) {
  const activeDescriptor = getStrategyProfileDescriptor(strategy);

  return {
    activeStrategy: strategy,
    activeLabel: activeDescriptor.label,
    activeDescription: activeDescriptor.description,
    availableStrategies: getStrategyProfileDescriptors(),
    comparisons: getStrategyProfileDescriptors().map((descriptor) => ({
      strategy: descriptor.id,
      label: descriptor.label,
      topSymbols: evaluateScanItems(cache, descriptor.id)
        .slice(0, 4)
        .map((item) => item.snapshot.displaySymbol),
    })),
  };
}

function toRecommendation(
  item: EvaluatedScanItem,
  benchmark: MarketContext,
  capitalContext: CapitalContext,
  weightedBudget: number,
) {
  const riskPlan = suggestPositionPlan({
    price: item.snapshot.price,
    atr14: item.snapshot.indicators.atr14,
    equity: capitalContext.equity,
    cash: capitalContext.cash,
  });
  const riskCap =
    riskPlan.positionValue > 0 ? riskPlan.positionValue : riskPlan.capitalCap;
  const rawAmount = Math.min(Math.max(weightedBudget, item.snapshot.price), riskCap);
  const suggestedShares = Math.max(Math.floor(rawAmount / item.snapshot.price), 0);
  const suggestedAmount = round(suggestedShares * item.snapshot.price, 2);

  return {
    ...item.snapshot,
    companyName: item.company.companyName,
    city: item.company.city,
    strategy: item.evaluation.strategy,
    strategyLabel: item.evaluation.strategyLabel,
    rankScore: item.evaluation.score,
    baselineRankScore: item.baselineScore,
    strategyDeltaFromDefault: round(item.evaluation.score - item.baselineScore, 2),
    strategyScores: item.strategyScores,
    eventAdjustedRankScore: item.evaluation.score,
    scoreBreakdown: item.evaluation.breakdown,
    eventIntelligence: createEmptyEventIntelligence({
      symbol: item.snapshot.symbol,
      displaySymbol: item.snapshot.displaySymbol,
      companyName: item.company.companyName,
    }),
    suggestedAmount,
    suggestedShares,
    stopLoss: riskPlan.stopLoss,
    riskBudget: riskPlan.riskBudget,
    thesis: item.thesis,
  } satisfies RecommendationCandidate;
}

async function buildRecommendations(
  cache: ScannerCache,
  capitalContext: CapitalContext,
  strategy: StrategyProfileId,
) {
  const investableMultiplier =
    cache.benchmark.trend === "risk-on"
      ? 0.88
      : cache.benchmark.trend === "neutral"
        ? 0.55
        : 0.3;
  const investableCash = Math.max(capitalContext.cash * investableMultiplier, 0);
  const evaluatedItems = evaluateScanItems(cache, strategy);
  const eligibleItems = evaluatedItems.filter(
    (item) => item.snapshot.signal.action !== "reduce" && item.evaluation.passesFilters,
  );
  const fallbackItems = evaluatedItems.filter((item) => item.snapshot.signal.action !== "reduce");
  const shortlist = (eligibleItems.length > 0 ? eligibleItems : fallbackItems).slice(
    0,
    isFastScannerMode() ? FAST_EVENT_AWARE_POOL_SIZE : EVENT_AWARE_POOL_SIZE,
  );
  const totalWeight = shortlist.reduce(
    (total, item) => total + Math.max(item.evaluation.score, 1),
    0,
  );

  const technicalRecommendations = shortlist
    .map((item) => {
      const weight = Math.max(item.evaluation.score, 1);
      const weightedBudget =
        totalWeight === 0 ? 0 : (investableCash * weight) / totalWeight;

      return toRecommendation(item, cache.benchmark, capitalContext, weightedBudget);
    })
    .filter((item) => item.suggestedShares > 0);

  const eventAwareCandidates = await enrichRecommendationsWithEvents(
    technicalRecommendations.slice(
      0,
      isFastScannerMode() ? FAST_EVENT_AWARE_POOL_SIZE : EVENT_AWARE_POOL_SIZE,
    ),
  );
  const enrichedBySymbol = new Map(
    eventAwareCandidates.map((item) => [item.symbol, item]),
  );

  return technicalRecommendations
    .map((item) => enrichedBySymbol.get(item.symbol) ?? item)
    .sort((left, right) => {
      if (right.eventAdjustedRankScore !== left.eventAdjustedRankScore) {
        return right.eventAdjustedRankScore - left.eventAdjustedRankScore;
      }

      if (right.rankScore !== left.rankScore) {
        return right.rankScore - left.rankScore;
      }

      return right.signal.score - left.signal.score;
    })
    .slice(0, RECOMMENDATION_LIMIT);
}

async function runScanner() {
  const [benchmark, universe] = await Promise.all([
    getBenchmarkContext(),
    getBistUniverse(),
  ]);
  const selectedUniverse = selectScannerUniverse(universe);
  const market = await getMarketSnapshots(
    selectedUniverse.companies.map((item) => item.symbol),
    selectedUniverse.concurrency,
  );
  const companyMap = new Map(selectedUniverse.companies.map((item) => [item.symbol, item]));
  const scanItems = market.symbols
    .map<ScanDatasetItem | null>((snapshot) => {
      const company = companyMap.get(snapshot.symbol);

      if (!company) {
        return null;
      }

      return {
        company,
        snapshot,
      };
    })
    .filter((item): item is ScanDatasetItem => item !== null);

  return {
    generatedAt: new Date().toISOString(),
    benchmark,
    universeLabel: selectedUniverse.label,
    universeCount: selectedUniverse.companies.length,
    sourceUniverseCount: universe.length,
    analyzedCount: market.symbols.length,
    failedCount: market.errors.length,
    providerSummary: market.providerSummary,
    scanFailures: market.errors.slice(0, 24),
    scanItems,
    warnings: selectedUniverse.warnings,
  } satisfies ScannerCache;
}

async function ensureScannerReady(forceRefresh = false) {
  const cacheExpired =
    !scannerCache ||
    Date.now() - new Date(scannerCache.generatedAt).getTime() > SCANNER_CACHE_TTL_MS;

  if (forceRefresh || cacheExpired) {
    if (!runningScan) {
      scanStartedAt = new Date().toISOString();
      runningScan = runScanner()
        .then((result) => {
          scannerCache = result;
          return result;
        })
        .finally(() => {
          runningScan = null;
        });
    }

    return runningScan;
  }

  if (!scannerCache && !runningScan) {
    scanStartedAt = new Date().toISOString();
    runningScan = runScanner()
      .then((result) => {
        scannerCache = result;
        return result;
      })
      .finally(() => {
        runningScan = null;
      });
  }

  if (runningScan) {
    return runningScan;
  }

  return scannerCache;
}

export async function getScannerRankingSnapshot(
  strategy: StrategyProfileId = "rank-score",
  forceRefresh = false,
): Promise<ScannerRankingSnapshot> {
  const activeCache = await ensureScannerReady(forceRefresh);

  if (!activeCache) {
    throw new Error("Tarama sonuclari hazir degil.");
  }

  return {
    generatedAt: activeCache.generatedAt,
    benchmark: activeCache.benchmark,
    rankedItems: evaluateScanItems(activeCache, strategy),
  };
}

export async function getScannerOverview(
  capitalContext: CapitalContext,
  forceRefresh = false,
  strategy: StrategyProfileId = "rank-score",
): Promise<ScannerResponse> {
  const activeCache = await ensureScannerReady(forceRefresh);

  if (!activeCache) {
    throw new Error("Tarama sonuclari hazir degil.");
  }

  const recommendations = await buildRecommendations(activeCache, capitalContext, strategy);
  const eventWarnings = recommendations
    .flatMap((item) => item.eventIntelligence.warningList)
    .slice(0, 4);
  const failureSummary = buildFailureSummary(activeCache.scanFailures);
  const failureWarnings = failureSummary
    .slice(0, 3)
    .map((item) => `${item.type}: ${item.count} sembol`);

  return {
    status: {
      state: "ready",
      stale: false,
    },
    generatedAt: activeCache.generatedAt,
    startedAt: scanStartedAt,
    strategy: buildStrategySummary(activeCache, strategy),
    benchmark: activeCache.benchmark,
    universeLabel: activeCache.universeLabel,
    universeCount: activeCache.universeCount,
    analyzedCount: activeCache.analyzedCount,
    failedCount: activeCache.failedCount,
    providerSummary: activeCache.providerSummary,
    failureSummary,
    scanFailures: activeCache.scanFailures,
    recommendations,
    topSymbols: recommendations.map((item) => item.symbol),
    warnings: [
      ...activeCache.warnings,
      ...failureWarnings,
      ...activeCache.scanFailures.slice(0, 4).map((item) => `${item.symbol}: ${item.message}`),
      ...eventWarnings,
    ],
  };
}
