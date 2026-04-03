import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import { round } from "./analysis";
import { simulateOrdersOnState, submitOrderToState } from "./order-engine";
import { getMarketSnapshot, getMarketSnapshots } from "./market";
import {
  buildTradeJournalResponse,
  createManualTradeJournalRecord,
  createTradeJournalFromOrder,
  hydrateTradeJournalEntries,
  normalizeTradeJournalEntries,
  normalizeTradeJournalInput,
  normalizeTradeJournalUpdatePayload,
} from "./trade-journal";
import type {
  BulkOrderPayload,
  BulkOrderResult,
  ExecutionRecord,
  MarketSnapshot,
  OrderPayload,
  OrderRecord,
  OrderResult,
  OrderSimulationPayload,
  OrderSimulationResult,
  PortfolioHistoryResponse,
  PortfolioResponse,
  PortfolioSnapshotRecord,
  PortfolioState,
  PortfolioHoldingSnapshot,
  TradeJournalCreatePayload,
  TradeJournalFilters,
  TradeJournalRecord,
  TradeJournalResponse,
  TradeJournalUpdatePayload,
  PositionRecord,
  PositionView,
  TradeRecord,
} from "./types";

const DATA_DIRECTORY = path.join(process.cwd(), "data");
const PORTFOLIO_FILE = path.join(DATA_DIRECTORY, "paper-portfolio.json");
const DEFAULT_STARTING_CASH = 250_000;
const DEFAULT_BASE_CURRENCY = "TRY";
const MAX_HISTORY_SNAPSHOTS = 750;

let portfolioQueue = Promise.resolve();

function createInitialPortfolio(
  startingCash = DEFAULT_STARTING_CASH,
  baseCurrency = DEFAULT_BASE_CURRENCY,
): PortfolioState {
  const now = new Date().toISOString();

  return {
    baseCurrency,
    startingCash: round(startingCash, 2),
    cash: round(startingCash, 2),
    realizedPnl: 0,
    positions: {},
    trades: [],
    orders: [],
    executions: [],
    journals: [],
    history: [],
    updatedAt: now,
  };
}

function normalizeHistory(
  rawHistory: PortfolioSnapshotRecord[] | null | undefined,
) {
  if (!Array.isArray(rawHistory)) {
    return [];
  }

  const snapshotMap = new Map<string, PortfolioSnapshotRecord>();

  rawHistory.forEach((snapshot) => {
    if (
      !snapshot ||
      typeof snapshot.date !== "string" ||
      typeof snapshot.equity !== "number" ||
      !Number.isFinite(snapshot.equity)
    ) {
      return;
    }

    snapshotMap.set(snapshot.date, {
      date: snapshot.date,
      capturedAt: snapshot.capturedAt ?? `${snapshot.date}T00:00:00.000Z`,
      cash: round(snapshot.cash ?? 0, 2),
      equity: round(snapshot.equity, 2),
      marketValue: round(snapshot.marketValue ?? 0, 2),
      realizedPnl: round(snapshot.realizedPnl ?? 0, 2),
      unrealizedPnl: round(snapshot.unrealizedPnl ?? 0, 2),
      totalPnl: round(snapshot.totalPnl ?? 0, 2),
      returnPercent: round(snapshot.returnPercent ?? 0, 2),
      openExposure: round(snapshot.openExposure ?? 0, 2),
      holdings: Array.isArray(snapshot.holdings)
        ? snapshot.holdings.map((holding) => ({
            symbol: holding.symbol,
            displaySymbol: holding.displaySymbol ?? holding.symbol.replace(".IS", ""),
            currency: holding.currency ?? DEFAULT_BASE_CURRENCY,
            shares: round(holding.shares ?? 0, 4),
            marketValue: round(holding.marketValue ?? 0, 2),
            weightPercent: round(holding.weightPercent ?? 0, 2),
            unrealizedPnl: round(holding.unrealizedPnl ?? 0, 2),
          }))
        : [],
    });
  });

  return [...snapshotMap.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-MAX_HISTORY_SNAPSHOTS);
}

function normalizePortfolioState(rawState: Partial<PortfolioState> | null | undefined) {
  const initialState = createInitialPortfolio();

  return {
    baseCurrency: rawState?.baseCurrency ?? initialState.baseCurrency,
    startingCash:
      typeof rawState?.startingCash === "number"
        ? round(rawState.startingCash, 2)
        : initialState.startingCash,
    cash:
      typeof rawState?.cash === "number"
        ? round(rawState.cash, 2)
        : initialState.cash,
    realizedPnl:
      typeof rawState?.realizedPnl === "number"
        ? round(rawState.realizedPnl, 2)
        : 0,
    positions: rawState?.positions ?? {},
    trades: Array.isArray(rawState?.trades) ? rawState.trades : [],
    orders: Array.isArray(rawState?.orders) ? rawState.orders : [],
    executions: Array.isArray(rawState?.executions) ? rawState.executions : [],
    journals: normalizeTradeJournalEntries(rawState?.journals),
    history: normalizeHistory(rawState?.history),
    updatedAt: rawState?.updatedAt ?? initialState.updatedAt,
  } satisfies PortfolioState;
}

async function ensurePortfolioFile() {
  await fs.mkdir(DATA_DIRECTORY, { recursive: true });

  try {
    await fs.access(PORTFOLIO_FILE);
  } catch {
    await fs.writeFile(
      PORTFOLIO_FILE,
      JSON.stringify(createInitialPortfolio(), null, 2),
      "utf8",
    );
  }
}

async function readPortfolioState() {
  await ensurePortfolioFile();

  try {
    const rawContent = await fs.readFile(PORTFOLIO_FILE, "utf8");
    return normalizePortfolioState(JSON.parse(rawContent) as PortfolioState);
  } catch {
    const initialState = createInitialPortfolio();
    await writePortfolioState(initialState);
    return initialState;
  }
}

async function writePortfolioState(state: PortfolioState) {
  await fs.mkdir(DATA_DIRECTORY, { recursive: true });
  await fs.writeFile(PORTFOLIO_FILE, JSON.stringify(state, null, 2), "utf8");
}

async function withPortfolioLock<T>(task: () => Promise<T>) {
  const result = portfolioQueue.then(task, task);
  portfolioQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function reservedSharesBySymbol(state: PortfolioState) {
  const reservations = new Map<string, number>();

  state.orders.forEach((order) => {
    if (
      order.side !== "sell" ||
      (order.status !== "pending" && order.status !== "partially_filled")
    ) {
      return;
    }

    reservations.set(
      order.symbol,
      round((reservations.get(order.symbol) ?? 0) + order.remainingShares, 4),
    );
  });

  return reservations;
}

async function buildPortfolioResponse(
  state: PortfolioState,
  snapshotOverrides: Record<string, MarketSnapshot> = {},
): Promise<PortfolioResponse> {
  const positionSymbols = Object.keys(state.positions);
  const missingSymbols = positionSymbols.filter((symbol) => !snapshotOverrides[symbol]);
  const fetchedSnapshots =
    missingSymbols.length > 0
      ? await getMarketSnapshots(missingSymbols)
      : { symbols: [], errors: [] };

  const snapshotMap = new Map<string, MarketSnapshot>();
  const reservationMap = reservedSharesBySymbol(state);

  fetchedSnapshots.symbols.forEach((snapshot) => {
    snapshotMap.set(snapshot.symbol, snapshot);
  });

  Object.values(snapshotOverrides).forEach((snapshot) => {
    snapshotMap.set(snapshot.symbol, snapshot);
  });

  const positions = positionSymbols
    .map<PositionView>((symbol) => {
      const position = state.positions[symbol] as PositionRecord;
      const snapshot = snapshotMap.get(symbol);
      const marketPrice = snapshot?.price ?? position.averageCost;
      const marketValue = round(position.shares * marketPrice, 2);
      const costBasis = round(position.shares * position.averageCost, 2);
      const unrealizedPnl = round(marketValue - costBasis, 2);
      const unrealizedPnlPercent =
        costBasis === 0 ? 0 : round((unrealizedPnl / costBasis) * 100, 2);
      const reservedShares = round(Math.min(reservationMap.get(symbol) ?? 0, position.shares), 4);
      const availableShares = round(Math.max(position.shares - reservedShares, 0), 4);

      return {
        ...position,
        currency: snapshot?.currency ?? position.currency,
        marketPrice,
        marketValue,
        costBasis,
        unrealizedPnl,
        unrealizedPnlPercent,
        reservedShares,
        availableShares,
      };
    })
    .sort((left, right) => right.marketValue - left.marketValue);

  const marketValue = round(
    positions.reduce((total, position) => total + position.marketValue, 0),
    2,
  );
  const unrealizedPnl = round(
    positions.reduce((total, position) => total + position.unrealizedPnl, 0),
    2,
  );
  const equity = round(state.cash + marketValue, 2);
  const totalPnl = round(state.realizedPnl + unrealizedPnl, 2);
  const returnPercent =
    state.startingCash === 0
      ? 0
      : round(((equity / state.startingCash) - 1) * 100, 2);
  const openExposure = equity === 0 ? 0 : round((marketValue / equity) * 100, 2);

  return {
    baseCurrency: state.baseCurrency,
    startingCash: state.startingCash,
    cash: state.cash,
    equity,
    marketValue,
    realizedPnl: state.realizedPnl,
    unrealizedPnl,
    totalPnl,
    returnPercent,
    openExposure,
    positions,
    trades: [...state.trades],
    orders: [...state.orders],
    executions: [...state.executions],
    updatedAt: state.updatedAt,
  };
}

function snapshotDateKey(value = new Date().toISOString()) {
  return value.slice(0, 10);
}

function toHoldingSnapshot(position: PositionView): PortfolioHoldingSnapshot {
  return {
    symbol: position.symbol,
    displaySymbol: position.symbol.replace(".IS", ""),
    currency: position.currency,
    shares: round(position.shares, 4),
    marketValue: round(position.marketValue, 2),
    weightPercent: 0,
    unrealizedPnl: round(position.unrealizedPnl, 2),
  };
}

function buildSnapshotRecord(portfolio: PortfolioResponse): PortfolioSnapshotRecord {
  const totalMarketValue = portfolio.marketValue;
  const holdings = portfolio.positions.map((position) => ({
    ...toHoldingSnapshot(position),
    weightPercent:
      totalMarketValue === 0 ? 0 : round((position.marketValue / totalMarketValue) * 100, 2),
  }));

  return {
    date: snapshotDateKey(),
    capturedAt: new Date().toISOString(),
    cash: round(portfolio.cash, 2),
    equity: round(portfolio.equity, 2),
    marketValue: round(portfolio.marketValue, 2),
    realizedPnl: round(portfolio.realizedPnl, 2),
    unrealizedPnl: round(portfolio.unrealizedPnl, 2),
    totalPnl: round(portfolio.totalPnl, 2),
    returnPercent: round(portfolio.returnPercent, 2),
    openExposure: round(portfolio.openExposure, 2),
    holdings,
  };
}

function hasSnapshotChanged(
  current: PortfolioSnapshotRecord | undefined,
  next: PortfolioSnapshotRecord,
) {
  if (!current) {
    return true;
  }

  return (
    current.cash !== next.cash ||
    current.equity !== next.equity ||
    current.marketValue !== next.marketValue ||
    current.realizedPnl !== next.realizedPnl ||
    current.unrealizedPnl !== next.unrealizedPnl ||
    current.totalPnl !== next.totalPnl ||
    current.returnPercent !== next.returnPercent ||
    current.openExposure !== next.openExposure ||
    JSON.stringify(current.holdings) !== JSON.stringify(next.holdings)
  );
}

async function syncPortfolioSnapshot(
  state: PortfolioState,
  snapshotOverrides: Record<string, MarketSnapshot> = {},
) {
  const portfolio = await buildPortfolioResponse(state, snapshotOverrides);
  const nextSnapshot = buildSnapshotRecord(portfolio);
  const existingIndex = state.history.findIndex((snapshot) => snapshot.date === nextSnapshot.date);
  const existingSnapshot =
    existingIndex >= 0 ? (state.history[existingIndex] as PortfolioSnapshotRecord) : undefined;
  const changed = hasSnapshotChanged(existingSnapshot, nextSnapshot);

  if (changed) {
    if (existingIndex >= 0) {
      state.history[existingIndex] = nextSnapshot;
    } else {
      state.history.push(nextSnapshot);
      state.history.sort((left, right) => left.date.localeCompare(right.date));
      state.history = state.history.slice(-MAX_HISTORY_SNAPSHOTS);
    }
  }

  return {
    portfolio,
    snapshotChanged: changed,
  };
}

function orderStatusMessage(order: OrderRecord) {
  if (order.status === "rejected") {
    return order.rejectionReason ?? "Emir reddedildi.";
  }

  if (order.status === "filled") {
    return `${order.symbol} ${order.type} emri tamamen doldu.`;
  }

  if (order.status === "partially_filled") {
    return `${order.symbol} emri kismi doldu: ${order.filledShares}/${order.requestedShares} lot.`;
  }

  return `${order.symbol} ${order.type} emri beklemeye alindi.`;
}

function uniqueSymbolsFromOrders(orders: OrderRecord[]) {
  return [...new Set(orders.map((order) => order.symbol))];
}

async function loadSnapshotsBySymbols(symbols: string[]) {
  if (symbols.length === 0) {
    return {};
  }

  const market = await getMarketSnapshots(symbols, 8);
  return Object.fromEntries(
    market.symbols.map((snapshot) => [snapshot.symbol, snapshot]),
  ) as Record<string, MarketSnapshot>;
}

function normalizeJournalSymbol(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  return normalized.endsWith(".IS") ? normalized : `${normalized}.IS`;
}

export async function getTradeJournal(
  filters: TradeJournalFilters = {},
): Promise<TradeJournalResponse> {
  return withPortfolioLock(async () => {
    const state = await readPortfolioState();
    const portfolio = await buildPortfolioResponse(state);
    const entries = hydrateTradeJournalEntries(state.journals, state, portfolio);

    return buildTradeJournalResponse(entries, filters);
  });
}

export async function createTradeJournalEntry(
  payload: TradeJournalCreatePayload,
): Promise<TradeJournalRecord> {
  return withPortfolioLock(async () => {
    const state = await readPortfolioState();
    const symbol = normalizeJournalSymbol(payload.symbol);
    const now = new Date().toISOString();
    const journalInput = normalizeTradeJournalInput(payload);
    const portfolio = await buildPortfolioResponse(state);
    const position =
      portfolio.positions.find((item) => item.symbol === symbol) ?? null;
    const entry = createManualTradeJournalRecord(
      {
        ...payload,
        symbol,
      },
      journalInput,
      now,
      position,
    );

    state.journals = [entry, ...state.journals];
    state.updatedAt = now;
    await writePortfolioState(state);

    const hydratedEntries = hydrateTradeJournalEntries(state.journals, state, portfolio);
    return hydratedEntries.find((item) => item.id === entry.id) ?? entry;
  });
}

export async function updateTradeJournalEntry(
  id: string,
  payload: TradeJournalUpdatePayload,
): Promise<TradeJournalRecord> {
  return withPortfolioLock(async () => {
    const state = await readPortfolioState();
    const index = state.journals.findIndex((entry) => entry.id === id);

    if (index < 0) {
      throw new Error("Guncellenecek journal kaydi bulunamadi.");
    }

    const updates = normalizeTradeJournalUpdatePayload(payload);
    const current = state.journals[index] as TradeJournalRecord;
    const nextEntry: TradeJournalRecord = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    state.journals[index] = nextEntry;
    state.updatedAt = nextEntry.updatedAt;
    await writePortfolioState(state);

    const portfolio = await buildPortfolioResponse(state);
    const hydratedEntries = hydrateTradeJournalEntries(state.journals, state, portfolio);
    const hydratedEntry = hydratedEntries.find((entry) => entry.id === id);

    if (!hydratedEntry) {
      throw new Error("Journal kaydi guncellenemedi.");
    }

    return hydratedEntry;
  });
}

export async function getPortfolio() {
  return withPortfolioLock(async () => {
    const state = await readPortfolioState();
    const { portfolio, snapshotChanged } = await syncPortfolioSnapshot(state);

    if (snapshotChanged) {
      await writePortfolioState(state);
    }

    return portfolio;
  });
}

export async function resetPortfolio(startingCash = DEFAULT_STARTING_CASH) {
  return withPortfolioLock(async () => {
    const nextState = createInitialPortfolio(startingCash, DEFAULT_BASE_CURRENCY);
    const { portfolio } = await syncPortfolioSnapshot(nextState);
    await writePortfolioState(nextState);
    return portfolio;
  });
}

export async function getPortfolioHistory(days = 180): Promise<PortfolioHistoryResponse> {
  return withPortfolioLock(async () => {
    const state = await readPortfolioState();
    const { snapshotChanged } = await syncPortfolioSnapshot(state);

    if (snapshotChanged) {
      await writePortfolioState(state);
    }

    const safeDays = Math.max(Math.min(Math.floor(days), MAX_HISTORY_SNAPSHOTS), 1);
    const snapshots = state.history.slice(-safeDays);

    return {
      generatedAt: new Date().toISOString(),
      snapshots,
      totalSnapshots: state.history.length,
    };
  });
}

export async function getPortfolioAnalyticsInput(days = 180) {
  return withPortfolioLock(async () => {
    const state = await readPortfolioState();
    const { portfolio, snapshotChanged } = await syncPortfolioSnapshot(state);

    if (snapshotChanged) {
      await writePortfolioState(state);
    }

    const safeDays = Math.max(Math.min(Math.floor(days), MAX_HISTORY_SNAPSHOTS), 1);

    return {
      portfolio,
      history: state.history.slice(-safeDays),
      totalSnapshots: state.history.length,
    };
  });
}

export async function placeOrder(order: OrderPayload): Promise<OrderResult> {
  return withPortfolioLock(async () => {
    const state = await readPortfolioState();
    const symbol = order.symbol.trim().toUpperCase();
    const snapshot = await getMarketSnapshot(symbol);
    const now = new Date().toISOString();
    const journalInput = order.journal ? normalizeTradeJournalInput(order.journal) : null;

    if (journalInput && order.side !== "buy") {
      throw new Error("Journal girisi su an sadece alis emirlerinde destekleniyor.");
    }

    const submittedOrder = submitOrderToState(
      state,
      {
        ...order,
        symbol: snapshot.symbol,
      },
      snapshot,
      now,
    );

    let executions: ExecutionRecord[] = [];
    let trades: TradeRecord[] = [];

    if (submittedOrder.status === "pending") {
      const simulation = simulateOrdersOnState(
        state,
        {
          [snapshot.symbol]: snapshot,
        },
        now,
        {
          symbol: snapshot.symbol,
        },
      );

      executions = simulation.executions;
      trades = simulation.trades;
    }

    const finalOrder =
      state.orders.find((item) => item.id === submittedOrder.id) ?? submittedOrder;
    let journalEntry: TradeJournalRecord | null = null;

    if (journalInput) {
      const createdJournal = createTradeJournalFromOrder(snapshot.symbol, finalOrder, journalInput, now);

      state.journals = [createdJournal, ...state.journals];
      journalEntry = createdJournal;
    }

    const { portfolio } = await syncPortfolioSnapshot(state, {
      [snapshot.symbol]: snapshot,
    });
    await writePortfolioState(state);

    const hydratedJournal =
      journalEntry === null
        ? null
        : hydrateTradeJournalEntries(state.journals, state, portfolio).find(
            (entry) => entry.id === journalEntry?.id,
          ) ?? journalEntry;

    return {
      portfolio,
      order: finalOrder,
      executions,
      trades,
      journal: hydratedJournal,
      message: orderStatusMessage(finalOrder),
    };
  });
}

export async function simulateOrders(
  payload: OrderSimulationPayload = {},
): Promise<OrderSimulationResult> {
  return withPortfolioLock(async () => {
    const state = await readPortfolioState();
    const activeOrders = state.orders.filter((order) => {
      if (order.status !== "pending" && order.status !== "partially_filled") {
        return false;
      }

      if (payload.symbol && order.symbol !== payload.symbol.trim().toUpperCase()) {
        return false;
      }

      if (payload.orderIds?.length && !payload.orderIds.includes(order.id)) {
        return false;
      }

      return true;
    });

    if (activeOrders.length === 0) {
      const { portfolio, snapshotChanged } = await syncPortfolioSnapshot(state);

      if (snapshotChanged) {
        await writePortfolioState(state);
      }

      return {
        portfolio,
        orders: [],
        executions: [],
        trades: [],
        message: "Simule edilecek bekleyen emir bulunmuyor.",
      };
    }

    const snapshots = await loadSnapshotsBySymbols(uniqueSymbolsFromOrders(activeOrders));
    const now = new Date().toISOString();
    const simulation = simulateOrdersOnState(state, snapshots, now, payload);
    const { portfolio } = await syncPortfolioSnapshot(state, snapshots);

    await writePortfolioState(state);

    return {
      portfolio,
      orders: simulation.orders,
      executions: simulation.executions,
      trades: simulation.trades,
      message:
        simulation.executions.length > 0
          ? `${simulation.executions.length} execution olustu ve bekleyen emirler guncellendi.`
          : "Bekleyen emirler kontrol edildi; yeni fill olusmadi.",
    };
  });
}

export async function placeBulkBuy(
  payload: BulkOrderPayload,
): Promise<BulkOrderResult> {
  return withPortfolioLock(async () => {
    const items = payload.items
      .map((item) => ({
        symbol: item.symbol.trim().toUpperCase(),
        shares: round(item.shares, 4),
      }))
      .filter((item) => item.symbol && item.shares > 0);

    if (items.length === 0) {
      throw new Error("Sepette satin alinacak hisse bulunmuyor.");
    }

    const mergedItems = Array.from(
      items.reduce((map, item) => {
        map.set(item.symbol, round((map.get(item.symbol) ?? 0) + item.shares, 4));
        return map;
      }, new Map<string, number>()),
    ).map(([symbol, shares]) => ({
      symbol,
      shares,
    }));

    const state = await readPortfolioState();
    const snapshots = await loadSnapshotsBySymbols(mergedItems.map((item) => item.symbol));
    const orders: OrderRecord[] = [];
    const executions: ExecutionRecord[] = [];
    const trades: TradeRecord[] = [];

    for (const item of mergedItems) {
      const snapshot = snapshots[item.symbol];

      if (!snapshot) {
        throw new Error(`${item.symbol} icin guncel fiyat alinamadi.`);
      }

      const now = new Date().toISOString();
      const order = submitOrderToState(
        state,
        {
          symbol: snapshot.symbol,
          side: "buy",
          type: "market",
          shares: item.shares,
          note: "Sepet alim emri",
        },
        snapshot,
        now,
        {
          source: "basket",
        },
      );

      orders.push(order);

      if (order.status === "pending") {
        const simulation = simulateOrdersOnState(
          state,
          {
            [snapshot.symbol]: snapshot,
          },
          now,
          {
            orderIds: [order.id],
          },
        );

        executions.push(...simulation.executions);
        trades.push(...simulation.trades);
      }
    }

    const finalOrders = orders.map(
      (order) => state.orders.find((item) => item.id === order.id) ?? order,
    );
    const filledCount = finalOrders.filter((order) => order.status === "filled").length;
    const partialCount = finalOrders.filter(
      (order) => order.status === "partially_filled",
    ).length;
    const pendingCount = finalOrders.filter((order) => order.status === "pending").length;
    const rejectedCount = finalOrders.filter((order) => order.status === "rejected").length;
    const { portfolio } = await syncPortfolioSnapshot(state, snapshots);

    await writePortfolioState(state);

    return {
      portfolio,
      orders: finalOrders,
      executions,
      trades,
      message:
        `${finalOrders.length} emir alindi. ` +
        `Tam dolan: ${filledCount}, kismi dolan: ${partialCount}, bekleyen: ${pendingCount}, reddedilen: ${rejectedCount}.`,
    };
  });
}
