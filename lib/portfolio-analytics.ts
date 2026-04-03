import { round } from "./analysis";
import type {
  PortfolioAllocationItem,
  PortfolioAnalyticsResponse,
  PortfolioBenchmarkComparison,
  PortfolioDrawdownPoint,
  PortfolioEquityCurvePoint,
  PortfolioHistoryResponse,
  PortfolioPerformanceSummary,
  PortfolioPnlBreakdown,
  PortfolioPositionInsight,
  PortfolioResponse,
  PortfolioSnapshotRecord,
  UniverseCompany,
} from "./types";

interface CompanyMetadataLike {
  symbol: string;
  companyName: string;
  sector?: string | null;
}

function buildCompanyMap(companies: CompanyMetadataLike[]) {
  return new Map(companies.map((company) => [company.symbol, company]));
}

function ensureSnapshotHistory(
  portfolio: PortfolioResponse,
  history: PortfolioSnapshotRecord[],
) {
  if (history.length > 0) {
    return [...history].sort((left, right) => left.date.localeCompare(right.date));
  }

  return [
    {
      date: portfolio.updatedAt.slice(0, 10),
      capturedAt: portfolio.updatedAt,
      cash: portfolio.cash,
      equity: portfolio.equity,
      marketValue: portfolio.marketValue,
      realizedPnl: portfolio.realizedPnl,
      unrealizedPnl: portfolio.unrealizedPnl,
      totalPnl: portfolio.totalPnl,
      returnPercent: portfolio.returnPercent,
      openExposure: portfolio.openExposure,
      holdings: portfolio.positions.map((position) => ({
        symbol: position.symbol,
        displaySymbol: position.symbol.replace(".IS", ""),
        currency: position.currency,
        shares: position.shares,
        marketValue: position.marketValue,
        weightPercent:
          portfolio.equity === 0 ? 0 : round((position.marketValue / portfolio.equity) * 100, 2),
        unrealizedPnl: position.unrealizedPnl,
      })),
    },
  ];
}

function buildEquityCurve(history: PortfolioSnapshotRecord[]) {
  return history.map<PortfolioEquityCurvePoint>((snapshot) => ({
    date: snapshot.date,
    equity: snapshot.equity,
    cash: snapshot.cash,
    marketValue: snapshot.marketValue,
    returnPercent: snapshot.returnPercent,
  }));
}

function buildDrawdownSeries(equityCurve: PortfolioEquityCurvePoint[]) {
  let peakEquity = 0;

  return equityCurve.map<PortfolioDrawdownPoint>((point) => {
    peakEquity = Math.max(peakEquity, point.equity);
    const drawdownPercent =
      peakEquity === 0 ? 0 : round(((point.equity - peakEquity) / peakEquity) * 100, 2);

    return {
      date: point.date,
      equity: point.equity,
      drawdownPercent,
      peakEquity: round(peakEquity, 2),
    };
  });
}

function buildAllocationBySymbol(
  portfolio: PortfolioResponse,
  companyMap: Map<string, CompanyMetadataLike>,
) {
  return portfolio.positions
    .map<PortfolioAllocationItem>((position) => {
      const company = companyMap.get(position.symbol);
      const weightPercent =
        portfolio.equity === 0 ? 0 : round((position.marketValue / portfolio.equity) * 100, 2);

      return {
        key: position.symbol,
        label: company?.companyName ?? position.symbol.replace(".IS", ""),
        value: round(position.marketValue, 2),
        weightPercent,
        unrealizedPnl: round(position.unrealizedPnl, 2),
        unrealizedPnlPercent: round(position.unrealizedPnlPercent, 2),
        sector: company?.sector ?? null,
      };
    })
    .sort((left, right) => right.value - left.value);
}

function buildAllocationBySector(allocationBySymbol: PortfolioAllocationItem[]) {
  if (allocationBySymbol.length === 0) {
    return [];
  }

  const sectorMap = new Map<string, PortfolioAllocationItem>();

  allocationBySymbol.forEach((item) => {
    const sector = item.sector ?? "Bilinmiyor";
    const existing = sectorMap.get(sector);

    if (existing) {
      existing.value = round(existing.value + item.value, 2);
      existing.weightPercent = round(existing.weightPercent + item.weightPercent, 2);
      existing.unrealizedPnl = round((existing.unrealizedPnl ?? 0) + (item.unrealizedPnl ?? 0), 2);
      return;
    }

    sectorMap.set(sector, {
      key: sector,
      label: sector,
      value: round(item.value, 2),
      weightPercent: round(item.weightPercent, 2),
      unrealizedPnl: round(item.unrealizedPnl ?? 0, 2),
      sector,
    });
  });

  return [...sectorMap.values()].sort((left, right) => right.value - left.value);
}

function buildPnlBreakdown(portfolio: PortfolioResponse): PortfolioPnlBreakdown {
  return {
    realized: round(portfolio.realizedPnl, 2),
    unrealized: round(portfolio.unrealizedPnl, 2),
    total: round(portfolio.totalPnl, 2),
    segments: [
      {
        key: "realized",
        label: "Gerceklesen",
        value: round(portfolio.realizedPnl, 2),
      },
      {
        key: "unrealized",
        label: "Acik pozisyon",
        value: round(portfolio.unrealizedPnl, 2),
      },
    ],
  };
}

function buildPositionInsights(
  portfolio: PortfolioResponse,
  companyMap: Map<string, CompanyMetadataLike>,
) {
  const insights = portfolio.positions.map<PortfolioPositionInsight>((position) => {
    const company = companyMap.get(position.symbol);

    return {
      symbol: position.symbol,
      displaySymbol: position.symbol.replace(".IS", ""),
      companyName: company?.companyName ?? position.symbol.replace(".IS", ""),
      sector: company?.sector ?? null,
      marketValue: round(position.marketValue, 2),
      weightPercent:
        portfolio.equity === 0 ? 0 : round((position.marketValue / portfolio.equity) * 100, 2),
      unrealizedPnl: round(position.unrealizedPnl, 2),
      unrealizedPnlPercent: round(position.unrealizedPnlPercent, 2),
    };
  });

  return {
    bestPositions: [...insights]
      .sort((left, right) => right.unrealizedPnl - left.unrealizedPnl)
      .slice(0, 3),
    worstPositions: [...insights]
      .sort((left, right) => left.unrealizedPnl - right.unrealizedPnl)
      .slice(0, 3),
  };
}

function buildPerformanceSummary(
  portfolio: PortfolioResponse,
  equityCurve: PortfolioEquityCurvePoint[],
  drawdownSeries: PortfolioDrawdownPoint[],
  allocationBySymbol: PortfolioAllocationItem[],
) {
  const dailyReturns = equityCurve
    .slice(1)
    .map((point, index) => {
      const previousEquity = equityCurve[index]?.equity ?? 0;
      return previousEquity === 0 ? null : round(((point.equity / previousEquity) - 1) * 100, 2);
    })
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const topPositionWeight = allocationBySymbol[0]?.weightPercent ?? 0;
  const topThreeWeight = round(
    allocationBySymbol.slice(0, 3).reduce((total, item) => total + item.weightPercent, 0),
    2,
  );

  return {
    startingCapital: round(portfolio.startingCash, 2),
    endingEquity: round(portfolio.equity, 2),
    totalReturnPercent: round(portfolio.returnPercent, 2),
    maxDrawdownPercent: Math.min(...drawdownSeries.map((point) => point.drawdownPercent), 0),
    bestDayReturnPercent: dailyReturns.length > 0 ? Math.max(...dailyReturns) : null,
    worstDayReturnPercent: dailyReturns.length > 0 ? Math.min(...dailyReturns) : null,
    positiveDays: dailyReturns.filter((value) => value > 0).length,
    negativeDays: dailyReturns.filter((value) => value < 0).length,
    trackedDays: equityCurve.length,
    cashRatio:
      portfolio.equity === 0 ? 0 : round((portfolio.cash / portfolio.equity) * 100, 2),
    topPositionWeight: round(topPositionWeight, 2),
    topThreeWeight,
  } satisfies PortfolioPerformanceSummary;
}

function buildBenchmarkPlaceholder(
  equityCurve: PortfolioEquityCurvePoint[],
): PortfolioBenchmarkComparison {
  return {
    benchmarkSymbol: "XU100.IS",
    benchmarkLabel: "BIST 100",
    status: "placeholder",
    note:
      "Yapi hazir. Sonraki iterasyonda ayni snapshot tarihleri uzerinden benchmark normalize edilerek karsilastirma serisi doldurulabilir.",
    series: equityCurve.map((point) => ({
      date: point.date,
      portfolioEquity: point.equity,
      benchmarkValue: null,
    })),
  };
}

export function buildPortfolioAnalytics(
  portfolio: PortfolioResponse,
  history: PortfolioSnapshotRecord[],
  companies: UniverseCompany[],
): PortfolioAnalyticsResponse {
  const normalizedHistory = ensureSnapshotHistory(portfolio, history);
  const companyMap = buildCompanyMap(companies);
  const equityCurve = buildEquityCurve(normalizedHistory);
  const drawdownSeries = buildDrawdownSeries(equityCurve);
  const allocationBySymbol = buildAllocationBySymbol(portfolio, companyMap);
  const allocationBySector = buildAllocationBySector(allocationBySymbol);
  const pnlBreakdown = buildPnlBreakdown(portfolio);
  const positionInsights = buildPositionInsights(portfolio, companyMap);

  return {
    generatedAt: new Date().toISOString(),
    updatedAt: portfolio.updatedAt,
    baseCurrency: portfolio.baseCurrency,
    performance: buildPerformanceSummary(
      portfolio,
      equityCurve,
      drawdownSeries,
      allocationBySymbol,
    ),
    equityCurve,
    drawdownSeries,
    allocationBySymbol,
    allocationBySector,
    pnlBreakdown,
    bestPositions: positionInsights.bestPositions,
    worstPositions: positionInsights.worstPositions,
    recentSnapshots: [...normalizedHistory].slice(-7).reverse(),
    benchmarkComparison: buildBenchmarkPlaceholder(equityCurve),
  };
}

export function buildPortfolioHistoryResponse(
  snapshots: PortfolioSnapshotRecord[],
): PortfolioHistoryResponse {
  return {
    generatedAt: new Date().toISOString(),
    snapshots: [...snapshots],
    totalSnapshots: snapshots.length,
  };
}
