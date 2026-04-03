import { round } from "./analysis";
import type {
  OrderRecord,
  PortfolioResponse,
  PortfolioState,
  PositionView,
  TradeJournalCreatePayload,
  TradeJournalDraft,
  TradeJournalFilters,
  TradeJournalOutcome,
  TradeJournalRecord,
  TradeJournalResponse,
  TradeJournalScope,
  TradeJournalStatus,
  TradeJournalStrategySummary,
  TradeJournalSummary,
  TradeJournalUpdatePayload,
} from "./types";

const JOURNAL_EPSILON = 0.0001;
const FLAT_RETURN_THRESHOLD_PERCENT = 0.1;

interface NormalizedTradeJournalInput {
  scope: TradeJournalScope;
  strategyTag: string;
  thesis: string;
  riskPlan: string;
  target: number | null;
  stop: number | null;
  confidence: number | null;
  tags: string[];
}

function sanitizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function normalizeTags(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .map((tag) => sanitizeText(tag, 32))
      .filter(Boolean),
  )].slice(0, 8);
}

function normalizeOptionalPrice(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return round(value, 4);
}

function normalizeOptionalConfidence(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return round(Math.min(Math.max(value, 0), 100), 2);
}

function normalizeIsoDate(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function toDisplaySymbol(symbol: string) {
  return symbol.replace(".IS", "");
}

function resolveOutcome(value: number | null, status: TradeJournalStatus): TradeJournalOutcome {
  if (status === "planned") {
    return "planned";
  }

  if (status === "cancelled") {
    return "cancelled";
  }

  if (status === "open") {
    return "open";
  }

  if (value === null || Math.abs(value) < FLAT_RETURN_THRESHOLD_PERCENT) {
    return "flat";
  }

  return value > 0 ? "win" : "loss";
}

function normalizeStatus(value: unknown): TradeJournalStatus {
  if (value === "open" || value === "closed" || value === "cancelled") {
    return value;
  }

  return "planned";
}

function normalizeOutcome(value: unknown): TradeJournalOutcome {
  if (
    value === "open" ||
    value === "win" ||
    value === "loss" ||
    value === "flat" ||
    value === "cancelled"
  ) {
    return value;
  }

  return "planned";
}

function normalizeScope(value: unknown): TradeJournalScope {
  return value === "position" ? "position" : "trade";
}

function normalizeBaseRecord(entry: Partial<TradeJournalRecord>) {
  const now = new Date().toISOString();
  const symbol = sanitizeText(entry.symbol, 24).toUpperCase();
  const createdAt = normalizeIsoDate(entry.createdAt, now);
  const updatedAt = normalizeIsoDate(entry.updatedAt, createdAt);
  const status = normalizeStatus(entry.status);
  const realizedReturnPercent =
    typeof entry.realizedReturnPercent === "number" && Number.isFinite(entry.realizedReturnPercent)
      ? round(entry.realizedReturnPercent, 2)
      : null;

  return {
    id: sanitizeText(entry.id, 64) || crypto.randomUUID(),
    scope: normalizeScope(entry.scope),
    symbol,
    displaySymbol: sanitizeText(entry.displaySymbol, 24) || toDisplaySymbol(symbol),
    entryDate: normalizeIsoDate(entry.entryDate, createdAt),
    strategyTag: sanitizeText(entry.strategyTag, 48),
    thesis: sanitizeText(entry.thesis, 600),
    riskPlan: sanitizeText(entry.riskPlan, 320),
    target: normalizeOptionalPrice(entry.target),
    stop: normalizeOptionalPrice(entry.stop),
    confidence: normalizeOptionalConfidence(entry.confidence),
    notesAfterExit: sanitizeText(entry.notesAfterExit, 1200),
    tags: normalizeTags(entry.tags),
    linkedOrderId: sanitizeText(entry.linkedOrderId, 64) || undefined,
    status,
    outcome: normalizeOutcome(entry.outcome) ?? resolveOutcome(realizedReturnPercent, status),
    createdAt,
    updatedAt,
    openedAt: entry.openedAt ? normalizeIsoDate(entry.openedAt, createdAt) : null,
    closedAt: entry.closedAt ? normalizeIsoDate(entry.closedAt, createdAt) : null,
    entryPrice: normalizeOptionalPrice(entry.entryPrice),
    exitPrice: normalizeOptionalPrice(entry.exitPrice),
    plannedShares:
      typeof entry.plannedShares === "number" && Number.isFinite(entry.plannedShares) && entry.plannedShares > 0
        ? round(entry.plannedShares, 4)
        : null,
    filledShares:
      typeof entry.filledShares === "number" && Number.isFinite(entry.filledShares) && entry.filledShares > 0
        ? round(entry.filledShares, 4)
        : null,
    closedShares:
      typeof entry.closedShares === "number" && Number.isFinite(entry.closedShares) && entry.closedShares > 0
        ? round(entry.closedShares, 4)
        : null,
    currentReturnPercent:
      typeof entry.currentReturnPercent === "number" && Number.isFinite(entry.currentReturnPercent)
        ? round(entry.currentReturnPercent, 2)
        : null,
    realizedReturnPercent,
  } satisfies TradeJournalRecord;
}

export function normalizeTradeJournalEntries(value: unknown): TradeJournalRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const entries: TradeJournalRecord[] = [];

  value.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }

    const normalized = normalizeBaseRecord(entry as Partial<TradeJournalRecord>);

    if (normalized.symbol) {
      entries.push(normalized);
    }
  });

  return entries.sort((left, right) => right.entryDate.localeCompare(left.entryDate));
}

export function normalizeTradeJournalInput(input: TradeJournalDraft): NormalizedTradeJournalInput {
  const strategyTag = sanitizeText(input.strategyTag, 48);
  const thesis = sanitizeText(input.thesis, 600);
  const riskPlan = sanitizeText(input.riskPlan, 320);
  const target = normalizeOptionalPrice(input.target);
  const stop = normalizeOptionalPrice(input.stop);
  const confidence = normalizeOptionalConfidence(input.confidence);
  const tags = normalizeTags(input.tags);
  const scope = normalizeScope(input.scope);

  if (!strategyTag) {
    throw new Error("Journal strategy etiketi zorunlu.");
  }

  if (!thesis) {
    throw new Error("Journal thesis alani zorunlu.");
  }

  if (input.target !== undefined && target === null) {
    throw new Error("Journal target pozitif bir fiyat olmali.");
  }

  if (input.stop !== undefined && stop === null) {
    throw new Error("Journal stop pozitif bir fiyat olmali.");
  }

  if (input.confidence !== undefined && confidence === null) {
    throw new Error("Confidence 0 ile 100 arasinda sayi olmali.");
  }

  return {
    scope,
    strategyTag,
    thesis,
    riskPlan,
    target,
    stop,
    confidence,
    tags,
  };
}

export function normalizeTradeJournalUpdatePayload(
  payload: TradeJournalUpdatePayload,
): TradeJournalUpdatePayload {
  const nextPayload: TradeJournalUpdatePayload = {};

  if (payload.strategyTag !== undefined) {
    const strategyTag = sanitizeText(payload.strategyTag, 48);

    if (!strategyTag) {
      throw new Error("Strategy etiketi bos birakilamaz.");
    }

    nextPayload.strategyTag = strategyTag;
  }

  if (payload.thesis !== undefined) {
    const thesis = sanitizeText(payload.thesis, 600);

    if (!thesis) {
      throw new Error("Thesis bos birakilamaz.");
    }

    nextPayload.thesis = thesis;
  }

  if (payload.riskPlan !== undefined) {
    nextPayload.riskPlan = sanitizeText(payload.riskPlan, 320);
  }

  if (payload.target !== undefined) {
    if (payload.target === null) {
      nextPayload.target = null;
    } else {
      const target = normalizeOptionalPrice(payload.target);

      if (target === null) {
        throw new Error("Target pozitif bir fiyat olmali.");
      }

      nextPayload.target = target;
    }
  }

  if (payload.stop !== undefined) {
    if (payload.stop === null) {
      nextPayload.stop = null;
    } else {
      const stop = normalizeOptionalPrice(payload.stop);

      if (stop === null) {
        throw new Error("Stop pozitif bir fiyat olmali.");
      }

      nextPayload.stop = stop;
    }
  }

  if (payload.confidence !== undefined) {
    if (payload.confidence === null) {
      nextPayload.confidence = null;
    } else {
      const confidence = normalizeOptionalConfidence(payload.confidence);

      if (confidence === null) {
        throw new Error("Confidence 0 ile 100 arasinda sayi olmali.");
      }

      nextPayload.confidence = confidence;
    }
  }

  if (payload.notesAfterExit !== undefined) {
    nextPayload.notesAfterExit = sanitizeText(payload.notesAfterExit, 1200);
  }

  if (payload.tags !== undefined) {
    nextPayload.tags = normalizeTags(payload.tags);
  }

  return nextPayload;
}

export function createTradeJournalFromOrder(
  symbol: string,
  order: OrderRecord,
  input: NormalizedTradeJournalInput,
  now: string,
): TradeJournalRecord {
  const status =
    order.status === "rejected" || order.status === "cancelled"
      ? "cancelled"
      : order.filledShares > 0
        ? "open"
        : "planned";
  const entryPrice = order.filledShares > 0 ? round(order.averageFillPrice || order.referencePrice, 4) : null;
  const plannedShares = round(order.requestedShares, 4);
  const filledShares = order.filledShares > 0 ? round(order.filledShares, 4) : null;

  return {
    id: crypto.randomUUID(),
    scope: input.scope,
    symbol,
    displaySymbol: toDisplaySymbol(symbol),
    entryDate: now,
    strategyTag: input.strategyTag,
    thesis: input.thesis,
    riskPlan: input.riskPlan,
    target: input.target,
    stop: input.stop,
    confidence: input.confidence,
    notesAfterExit: "",
    tags: input.tags,
    linkedOrderId: order.id,
    status,
    outcome: status === "cancelled" ? "cancelled" : status === "open" ? "open" : "planned",
    createdAt: now,
    updatedAt: now,
    openedAt: status === "open" ? order.updatedAt : null,
    closedAt: status === "cancelled" ? order.updatedAt : null,
    entryPrice,
    exitPrice: null,
    plannedShares,
    filledShares,
    closedShares: 0,
    currentReturnPercent: null,
    realizedReturnPercent: null,
  };
}

export function createManualTradeJournalRecord(
  payload: TradeJournalCreatePayload,
  input: NormalizedTradeJournalInput,
  now: string,
  position: PositionView | null,
): TradeJournalRecord {
  const symbol = sanitizeText(payload.symbol, 24).toUpperCase();
  const entryDate = normalizeIsoDate(payload.entryDate, now);
  const hasOpenPosition = Boolean(position && position.symbol === symbol && position.shares > 0);

  return {
    id: crypto.randomUUID(),
    scope: input.scope,
    symbol,
    displaySymbol: toDisplaySymbol(symbol),
    entryDate,
    strategyTag: input.strategyTag,
    thesis: input.thesis,
    riskPlan: input.riskPlan,
    target: input.target,
    stop: input.stop,
    confidence: input.confidence,
    notesAfterExit: "",
    tags: input.tags,
    status: hasOpenPosition ? "open" : "planned",
    outcome: hasOpenPosition ? "open" : "planned",
    createdAt: now,
    updatedAt: now,
    openedAt: hasOpenPosition ? entryDate : null,
    closedAt: null,
    entryPrice: hasOpenPosition ? round(position?.averageCost ?? 0, 4) : null,
    exitPrice: null,
    plannedShares: hasOpenPosition ? round(position?.shares ?? 0, 4) : null,
    filledShares: hasOpenPosition ? round(position?.shares ?? 0, 4) : null,
    closedShares: 0,
    currentReturnPercent: null,
    realizedReturnPercent: null,
  };
}

function orderDerivedState(entry: TradeJournalRecord, order: OrderRecord | undefined) {
  if (!order) {
    return {
      plannedShares: entry.plannedShares,
      filledShares: entry.filledShares,
      entryPrice: entry.entryPrice,
      openedAt: entry.openedAt,
      status: entry.status,
      closedAt: entry.closedAt,
    };
  }

  if ((order.status === "rejected" || order.status === "cancelled") && order.filledShares <= 0) {
    return {
      plannedShares: round(order.requestedShares, 4),
      filledShares: 0,
      entryPrice: null,
      openedAt: null,
      status: "cancelled" as const,
      closedAt: order.updatedAt,
    };
  }

  if (order.filledShares > 0) {
    return {
      plannedShares: round(order.requestedShares, 4),
      filledShares: round(order.filledShares, 4),
      entryPrice: round(order.averageFillPrice || order.referencePrice, 4),
      openedAt: entry.openedAt ?? order.updatedAt,
      status: "open" as const,
      closedAt: null,
    };
  }

  return {
    plannedShares: round(order.requestedShares, 4),
    filledShares: 0,
    entryPrice: null,
    openedAt: null,
    status: "planned" as const,
    closedAt: null,
  };
}

function buildSellTradeMap(state: PortfolioState) {
  const map = new Map<string, typeof state.trades>();

  state.trades
    .filter((trade) => trade.side === "sell")
    .sort((left, right) => left.executedAt.localeCompare(right.executedAt))
    .forEach((trade) => {
      const list = map.get(trade.symbol) ?? [];
      list.push(trade);
      map.set(trade.symbol, list);
    });

  return map;
}

function buildPositionMap(portfolio: PortfolioResponse) {
  return new Map(portfolio.positions.map((position) => [position.symbol, position]));
}

export function hydrateTradeJournalEntries(
  entries: TradeJournalRecord[],
  state: PortfolioState,
  portfolio: PortfolioResponse,
): TradeJournalRecord[] {
  const orderMap = new Map(state.orders.map((order) => [order.id, order]));
  const sellTradesBySymbol = buildSellTradeMap(state);
  const positionMap = buildPositionMap(portfolio);

  const derivedEntries = entries.map<TradeJournalRecord>((entry) => {
    const orderState = orderDerivedState(entry, entry.linkedOrderId ? orderMap.get(entry.linkedOrderId) : undefined);
    const position = positionMap.get(entry.symbol) ?? null;
    const isManualOpen = !entry.linkedOrderId && position && entry.scope === "position";
    const filledShares =
      orderState.filledShares && orderState.filledShares > 0
        ? orderState.filledShares
        : isManualOpen && position
          ? round(position.shares, 4)
          : entry.filledShares;
    const entryPrice =
      orderState.entryPrice ??
      (isManualOpen && position ? round(position.averageCost, 4) : entry.entryPrice);
    const openedAt =
      orderState.openedAt ??
      (isManualOpen ? entry.openedAt ?? entry.entryDate : entry.openedAt);
    const status = orderState.status ?? entry.status;

    return {
      ...entry,
      plannedShares: orderState.plannedShares ?? entry.plannedShares,
      filledShares,
      entryPrice,
      openedAt,
      status,
      closedAt: orderState.closedAt ?? entry.closedAt,
      closedShares: 0,
      exitPrice: null,
      currentReturnPercent: null,
      realizedReturnPercent: null,
      outcome:
        status === "cancelled"
          ? "cancelled"
          : status === "planned"
            ? "planned"
            : "open",
    };
  });

  const activeBySymbol = new Map<string, TradeJournalRecord[]>();

  derivedEntries
    .filter((entry) => (entry.filledShares ?? 0) > JOURNAL_EPSILON && entry.status !== "cancelled")
    .sort((left, right) =>
      (left.openedAt ?? left.entryDate).localeCompare(right.openedAt ?? right.entryDate),
    )
    .forEach((entry) => {
      const list = activeBySymbol.get(entry.symbol) ?? [];
      list.push(entry);
      activeBySymbol.set(entry.symbol, list);
    });

  activeBySymbol.forEach((symbolEntries, symbol) => {
    const sells = sellTradesBySymbol.get(symbol) ?? [];
    const closedSharesById = new Map<string, number>();
    const exitNotionalById = new Map<string, number>();
    const closedAtById = new Map<string, string>();

    sells.forEach((trade) => {
      let remainingShares = trade.shares;

      for (const entry of symbolEntries) {
        if (remainingShares <= JOURNAL_EPSILON) {
          break;
        }

        const openedAt = entry.openedAt ?? entry.entryDate;

        if (trade.executedAt < openedAt) {
          continue;
        }

        const filledShares = entry.filledShares ?? 0;
        const consumedShares = closedSharesById.get(entry.id) ?? 0;
        const availableShares = Math.max(filledShares - consumedShares, 0);

        if (availableShares <= JOURNAL_EPSILON) {
          continue;
        }

        const matchedShares = round(Math.min(availableShares, remainingShares), 4);

        closedSharesById.set(entry.id, round(consumedShares + matchedShares, 4));
        exitNotionalById.set(
          entry.id,
          round((exitNotionalById.get(entry.id) ?? 0) + matchedShares * trade.price, 4),
        );
        closedAtById.set(entry.id, trade.executedAt);
        remainingShares = round(remainingShares - matchedShares, 4);
      }
    });

    symbolEntries.forEach((entry) => {
      const closedShares = round(closedSharesById.get(entry.id) ?? 0, 4);
      entry.closedShares = closedShares;

      if (closedShares > JOURNAL_EPSILON) {
        const exitNotional = exitNotionalById.get(entry.id) ?? 0;
        entry.exitPrice = round(exitNotional / closedShares, 4);
      }

      const filledShares = entry.filledShares ?? 0;

      if (
        filledShares > JOURNAL_EPSILON &&
        closedShares >= filledShares - JOURNAL_EPSILON &&
        entry.entryPrice
      ) {
        entry.status = "closed";
        entry.closedAt = closedAtById.get(entry.id) ?? entry.closedAt;
        entry.realizedReturnPercent =
          entry.exitPrice === null
            ? null
            : round(((entry.exitPrice / entry.entryPrice) - 1) * 100, 2);
        entry.currentReturnPercent = null;
        entry.outcome = resolveOutcome(entry.realizedReturnPercent, "closed");
        return;
      }

      if (entry.status === "cancelled") {
        entry.outcome = "cancelled";
        entry.currentReturnPercent = null;
        return;
      }

      if (filledShares > JOURNAL_EPSILON && entry.entryPrice) {
        const position = positionMap.get(entry.symbol);

        entry.status = "open";
        entry.realizedReturnPercent = null;
        entry.currentReturnPercent =
          position && entry.entryPrice > 0
            ? round(((position.marketPrice / entry.entryPrice) - 1) * 100, 2)
            : null;
        entry.outcome = "open";
        return;
      }

      entry.status = "planned";
      entry.outcome = "planned";
      entry.currentReturnPercent = null;
      entry.realizedReturnPercent = null;
    });
  });

  return derivedEntries.sort((left, right) => right.entryDate.localeCompare(left.entryDate));
}

function matchesFilters(entry: TradeJournalRecord, filters: TradeJournalFilters) {
  const symbol = sanitizeText(filters.symbol, 24).toUpperCase();
  const strategy = sanitizeText(filters.strategy, 48);
  const outcome = filters.outcome ?? "all";

  if (symbol && entry.symbol !== symbol) {
    return false;
  }

  if (strategy && entry.strategyTag !== strategy) {
    return false;
  }

  if (outcome !== "all" && entry.outcome !== outcome && entry.status !== outcome) {
    return false;
  }

  return true;
}

function buildStrategyBreakdown(entries: TradeJournalRecord[]) {
  const strategyMap = new Map<
    string,
    {
      totalCount: number;
      closedCount: number;
      winCount: number;
      returnSum: number;
    }
  >();

  entries.forEach((entry) => {
    const existing = strategyMap.get(entry.strategyTag) ?? {
      totalCount: 0,
      closedCount: 0,
      winCount: 0,
      returnSum: 0,
    };

    existing.totalCount += 1;

    if (entry.status === "closed" && entry.realizedReturnPercent !== null) {
      existing.closedCount += 1;
      existing.returnSum += entry.realizedReturnPercent;
      if (entry.outcome === "win") {
        existing.winCount += 1;
      }
    }

    strategyMap.set(entry.strategyTag, existing);
  });

  return [...strategyMap.entries()]
    .map<TradeJournalStrategySummary>(([strategyTag, value]) => ({
      strategyTag,
      journalCount: value.totalCount,
      closedCount: value.closedCount,
      winRate:
        value.closedCount > 0 ? round((value.winCount / value.closedCount) * 100, 2) : null,
      averageReturnPercent:
        value.closedCount > 0 ? round(value.returnSum / value.closedCount, 2) : null,
    }))
    .sort((left, right) => right.journalCount - left.journalCount);
}

function buildTradeJournalSummary(
  allEntries: TradeJournalRecord[],
  filteredEntries: TradeJournalRecord[],
): TradeJournalSummary {
  const setupCounts = new Map<string, number>();
  const confidenceValues = filteredEntries
    .map((entry) => entry.confidence)
    .filter((value): value is number => value !== null);
  const closedEntries = filteredEntries.filter((entry) => entry.status === "closed");
  const notesCount = closedEntries.filter((entry) => entry.notesAfterExit.trim().length > 0).length;

  filteredEntries.forEach((entry) => {
    setupCounts.set(entry.strategyTag, (setupCounts.get(entry.strategyTag) ?? 0) + 1);
  });

  const mostCommonSetup =
    [...setupCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;

  return {
    totalEntries: allEntries.length,
    filteredEntries: filteredEntries.length,
    openEntries: filteredEntries.filter((entry) => entry.status === "open").length,
    closedEntries: closedEntries.length,
    mostCommonSetup,
    averageConfidence:
      confidenceValues.length > 0
        ? round(
            confidenceValues.reduce((total, value) => total + value, 0) /
              confidenceValues.length,
            2,
          )
        : null,
    notesCompletenessRate:
      closedEntries.length > 0 ? round((notesCount / closedEntries.length) * 100, 2) : null,
    strategyBreakdown: buildStrategyBreakdown(filteredEntries),
  };
}

export function buildTradeJournalResponse(
  hydratedEntries: TradeJournalRecord[],
  filters: TradeJournalFilters = {},
): TradeJournalResponse {
  const filteredEntries = hydratedEntries.filter((entry) => matchesFilters(entry, filters));

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      symbol: sanitizeText(filters.symbol, 24).toUpperCase() || undefined,
      strategy: sanitizeText(filters.strategy, 48) || undefined,
      outcome: filters.outcome ?? "all",
    },
    entries: filteredEntries,
    summary: buildTradeJournalSummary(hydratedEntries, filteredEntries),
    availableSymbols: [...new Set(hydratedEntries.map((entry) => entry.symbol))].sort(),
    availableStrategies: [...new Set(hydratedEntries.map((entry) => entry.strategyTag))].sort(),
  };
}
