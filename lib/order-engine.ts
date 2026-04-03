import { round } from "./analysis";
import type {
  ExecutionReason,
  ExecutionRecord,
  MarketSnapshot,
  OrderBracket,
  OrderPayload,
  OrderRecord,
  OrderSimulationPayload,
  OrderStatus,
  OrderType,
  PortfolioState,
  TradeRecord,
} from "./types";

const DEFAULT_COMMISSION_RATE_PERCENT = 0.12;
const DEFAULT_COMMISSION_MINIMUM = 1.5;
const ORDER_SHARE_PRECISION = 4;
const MAX_EXECUTION_LOGS = 160;
const MAX_ORDER_LOGS = 160;
const MAX_TRADE_LOGS = 120;
const MAX_ORDER_PARTICIPATION_RATE = 0.25;
const DEFAULT_SIMULATION_PARTICIPATION_RATE = 0.025;
const SMALL_CAP_PARTICIPATION_RATE = 0.08;
const ORDER_EPSILON = 0.0001;

interface SubmitOrderOptions {
  source?: OrderRecord["source"];
  parentOrderId?: string;
  ocoGroupId?: string;
  note?: string;
}

interface SimulationResult {
  executions: ExecutionRecord[];
  orders: OrderRecord[];
  trades: TradeRecord[];
}

function roundShares(value: number) {
  return round(value, ORDER_SHARE_PRECISION);
}

function latestCandle(snapshot: MarketSnapshot) {
  const candle = snapshot.series.at(-1);

  if (!candle) {
    throw new Error(`${snapshot.symbol} icin mum verisi eksik.`);
  }

  return candle;
}

function isActiveOrderStatus(status: OrderStatus) {
  return status === "pending" || status === "partially_filled";
}

function activeSellReservations(state: PortfolioState, symbol: string, excludeOrderId?: string) {
  return roundShares(
    state.orders.reduce((total, order) => {
      if (
        order.symbol !== symbol ||
        order.side !== "sell" ||
        !isActiveOrderStatus(order.status) ||
        order.id === excludeOrderId
      ) {
        return total;
      }

      return total + order.remainingShares;
    }, 0),
  );
}

function normalizeOrderType(type?: OrderPayload["type"]): OrderType {
  return type ?? "market";
}

function normalizeOrderQuantity(order: OrderPayload, referencePrice: number) {
  if (typeof order.shares === "number" && Number.isFinite(order.shares) && order.shares > 0) {
    return roundShares(order.shares);
  }

  if (
    typeof order.dollars === "number" &&
    Number.isFinite(order.dollars) &&
    order.dollars > 0 &&
    referencePrice > 0
  ) {
    return roundShares(order.dollars / referencePrice);
  }

  return 0;
}

function createOrderRecord(
  {
    bracket,
    currency,
    note,
    parentOrderId,
    referencePrice,
    requestedShares,
    side,
    source,
    stopPrice,
    submittedAt,
    symbol,
    type,
    limitPrice,
    ocoGroupId,
  }: {
    symbol: string;
    currency: string;
    side: OrderRecord["side"];
    type: OrderType;
    requestedShares: number;
    referencePrice: number;
    submittedAt: string;
    source: OrderRecord["source"];
    limitPrice?: number;
    stopPrice?: number;
    bracket?: OrderBracket;
    parentOrderId?: string;
    ocoGroupId?: string;
    note?: string;
  },
  status: OrderStatus,
  triggerStatus: OrderRecord["triggerStatus"],
): OrderRecord {
  return {
    id: crypto.randomUUID(),
    symbol,
    currency,
    side,
    type,
    status,
    triggerStatus,
    source,
    requestedShares: roundShares(requestedShares),
    filledShares: 0,
    remainingShares: roundShares(requestedShares),
    averageFillPrice: 0,
    referencePrice: round(referencePrice, 4),
    limitPrice: typeof limitPrice === "number" ? round(limitPrice, 4) : undefined,
    stopPrice: typeof stopPrice === "number" ? round(stopPrice, 4) : undefined,
    bracket,
    submittedAt,
    updatedAt: submittedAt,
    parentOrderId,
    ocoGroupId,
    executionIds: [],
    note,
  };
}

function appendOrder(state: PortfolioState, order: OrderRecord) {
  state.orders = [order, ...state.orders].slice(0, MAX_ORDER_LOGS);
  state.updatedAt = order.updatedAt;
}

function rejectOrder(
  state: PortfolioState,
  payload: OrderPayload,
  snapshot: MarketSnapshot,
  submittedAt: string,
  reason: string,
  options: SubmitOrderOptions = {},
) {
  const requestedShares = normalizeOrderQuantity(payload, snapshot.price);
  const order = createOrderRecord(
    {
      symbol: snapshot.symbol,
      currency: snapshot.currency,
      side: payload.side,
      type: normalizeOrderType(payload.type),
      requestedShares,
      referencePrice: snapshot.price,
      submittedAt,
      source: options.source ?? "manual",
      limitPrice: payload.limitPrice,
      stopPrice: payload.stopPrice,
      bracket: payload.bracket,
      parentOrderId: options.parentOrderId,
      ocoGroupId: options.ocoGroupId,
      note: payload.note ?? options.note,
    },
    "rejected",
    payload.type === "stop" || payload.type === "stop_limit" ? "armed" : "inactive",
  );

  order.remainingShares = 0;
  order.rejectionReason = reason;
  order.updatedAt = submittedAt;
  appendOrder(state, order);

  return order;
}

function validateBracket(
  order: OrderPayload,
  referencePrice: number,
) {
  if (!order.bracket) {
    return null;
  }

  const { stopLoss, takeProfit } = order.bracket;

  if (order.side !== "buy") {
    return "Bracket cikis sadece alis emirlerinde destekleniyor.";
  }

  if (
    typeof stopLoss === "number" &&
    (!Number.isFinite(stopLoss) || stopLoss <= 0 || stopLoss >= referencePrice)
  ) {
    return "Bracket stop-loss fiyati mevcut referans fiyatinin altinda olmali.";
  }

  if (
    typeof takeProfit === "number" &&
    (!Number.isFinite(takeProfit) || takeProfit <= 0 || takeProfit <= referencePrice)
  ) {
    return "Bracket take-profit fiyati mevcut referans fiyatinin ustunde olmali.";
  }

  return null;
}

function estimatedWorkingPrice(order: OrderPayload, snapshot: MarketSnapshot) {
  const type = normalizeOrderType(order.type);

  if (type === "limit" || type === "stop_limit") {
    return typeof order.limitPrice === "number" ? order.limitPrice : snapshot.price;
  }

  if (type === "stop") {
    return typeof order.stopPrice === "number" ? order.stopPrice : snapshot.price;
  }

  return snapshot.price;
}

function estimateCommission(amount: number) {
  return round(
    Math.max(amount * (DEFAULT_COMMISSION_RATE_PERCENT / 100), DEFAULT_COMMISSION_MINIMUM),
    2,
  );
}

function computeLiquidityCap(snapshot: MarketSnapshot) {
  const candle = latestCandle(snapshot);
  const participationRate =
    candle.volume < 10_000
      ? SMALL_CAP_PARTICIPATION_RATE
      : DEFAULT_SIMULATION_PARTICIPATION_RATE;

  return Math.max(Math.floor(candle.volume * participationRate), candle.volume > 0 ? 1 : 0);
}

function slippagePercentFor(
  order: OrderRecord,
  snapshot: MarketSnapshot,
  shares: number,
) {
  const candle = latestCandle(snapshot);
  const dailyVolume = Math.max(candle.volume, 1);
  const participation = shares / dailyVolume;
  const volatility = snapshot.indicators.volatility21 ?? 28;
  const base =
    order.type === "market"
      ? 0.04
      : order.type === "limit"
        ? 0.012
        : order.type === "stop"
          ? 0.06
          : 0.028;
  const volatilityImpact = Math.min(volatility, 80) * 0.0012;
  const liquidityImpact = participation * 14;

  return round(Math.min(base + volatilityImpact + liquidityImpact, 1.5), 4);
}

function resolveExecutionReason(order: OrderRecord): ExecutionReason {
  if (order.source === "bracket" && order.side === "sell" && order.type === "limit") {
    return "take_profit_fill";
  }

  if (order.source === "bracket" && order.side === "sell" && order.type === "stop") {
    return "stop_loss_fill";
  }

  if (order.type === "limit") {
    return "limit_fill";
  }

  if (order.type === "stop") {
    return "stop_fill";
  }

  if (order.type === "stop_limit") {
    return "stop_limit_fill";
  }

  return "market_fill";
}

function orderTriggerInfo(order: OrderRecord, snapshot: MarketSnapshot) {
  const candle = latestCandle(snapshot);
  const currentPrice = snapshot.price;

  if (order.type === "market") {
    return {
      eligible: true,
      nextTriggerStatus: "inactive" as const,
      basePrice: currentPrice,
    };
  }

  if (order.type === "limit") {
    if (order.side === "buy") {
      const crossed = currentPrice <= (order.limitPrice ?? 0) || candle.low <= (order.limitPrice ?? 0);

      return {
        eligible: crossed,
        nextTriggerStatus: "inactive" as const,
        basePrice: currentPrice <= (order.limitPrice ?? 0) ? currentPrice : order.limitPrice ?? currentPrice,
      };
    }

    const crossed = currentPrice >= (order.limitPrice ?? 0) || candle.high >= (order.limitPrice ?? 0);

    return {
      eligible: crossed,
      nextTriggerStatus: "inactive" as const,
      basePrice: currentPrice >= (order.limitPrice ?? 0) ? currentPrice : order.limitPrice ?? currentPrice,
    };
  }

  if (order.type === "stop") {
    if (order.side === "buy") {
      const triggered = currentPrice >= (order.stopPrice ?? 0) || candle.high >= (order.stopPrice ?? 0);

      return {
        eligible: triggered,
        nextTriggerStatus: triggered ? "triggered" as const : "armed" as const,
        basePrice: Math.max(currentPrice, order.stopPrice ?? currentPrice),
      };
    }

    const triggered = currentPrice <= (order.stopPrice ?? 0) || candle.low <= (order.stopPrice ?? 0);

    return {
      eligible: triggered,
      nextTriggerStatus: triggered ? "triggered" as const : "armed" as const,
      basePrice: Math.min(currentPrice, order.stopPrice ?? currentPrice),
    };
  }

  const triggeredAlready = order.triggerStatus === "triggered";
  const stopTriggered =
    triggeredAlready ||
    (order.side === "buy"
      ? currentPrice >= (order.stopPrice ?? 0) || candle.high >= (order.stopPrice ?? 0)
      : currentPrice <= (order.stopPrice ?? 0) || candle.low <= (order.stopPrice ?? 0));

  if (!stopTriggered) {
    return {
      eligible: false,
      nextTriggerStatus: "armed" as const,
      basePrice: currentPrice,
    };
  }

  if (order.side === "buy") {
    const crossed = currentPrice <= (order.limitPrice ?? 0) || candle.low <= (order.limitPrice ?? 0);

    return {
      eligible: crossed,
      nextTriggerStatus: "triggered" as const,
      basePrice:
        currentPrice <= (order.limitPrice ?? 0)
          ? currentPrice
          : order.limitPrice ?? currentPrice,
    };
  }

  const crossed = currentPrice >= (order.limitPrice ?? 0) || candle.high >= (order.limitPrice ?? 0);

  return {
    eligible: crossed,
    nextTriggerStatus: "triggered" as const,
    basePrice:
      currentPrice >= (order.limitPrice ?? 0)
        ? currentPrice
        : order.limitPrice ?? currentPrice,
  };
}

function applyPriceConstraints(
  order: OrderRecord,
  basePrice: number,
  slippagePercent: number,
) {
  if (order.side === "buy") {
    const slipped = basePrice * (1 + slippagePercent / 100);

    if (order.type === "limit" || order.type === "stop_limit") {
      return round(Math.min(slipped, order.limitPrice ?? slipped), 4);
    }

    return round(slipped, 4);
  }

  const slipped = basePrice * (1 - slippagePercent / 100);

  if (order.type === "limit" || order.type === "stop_limit") {
    return round(Math.max(slipped, order.limitPrice ?? slipped), 4);
  }

  return round(slipped, 4);
}

function maxAffordableShares(cash: number, price: number) {
  if (cash <= 0 || price <= 0) {
    return 0;
  }

  let shares = Math.floor(cash / price);

  while (shares > 0) {
    const amount = price * shares;
    const commission = estimateCommission(amount);

    if (amount + commission <= cash + 0.01) {
      return roundShares(shares);
    }

    shares -= 1;
  }

  return 0;
}

function syncAverageFillPrice(order: OrderRecord, executedShares: number, executedPrice: number) {
  const existingNotional = order.averageFillPrice * order.filledShares;
  const nextFilledShares = roundShares(order.filledShares + executedShares);
  const nextAverageFillPrice =
    nextFilledShares <= 0
      ? 0
      : round((existingNotional + executedPrice * executedShares) / nextFilledShares, 4);

  order.filledShares = nextFilledShares;
  order.remainingShares = roundShares(Math.max(order.requestedShares - nextFilledShares, 0));
  order.averageFillPrice = nextAverageFillPrice;
  order.status = order.remainingShares <= ORDER_EPSILON ? "filled" : "partially_filled";
}

function appendExecution(
  state: PortfolioState,
  execution: ExecutionRecord,
  trade: TradeRecord,
) {
  state.executions = [execution, ...state.executions].slice(0, MAX_EXECUTION_LOGS);
  state.trades = [trade, ...state.trades].slice(0, MAX_TRADE_LOGS);
}

function applyExecutionToState(
  state: PortfolioState,
  order: OrderRecord,
  snapshot: MarketSnapshot,
  executedShares: number,
  executedPrice: number,
  executedAt: string,
  slippagePercent: number,
  availableLiquidity: number,
) {
  const symbol = order.symbol;
  const position = state.positions[symbol];
  const grossAmount = round(executedShares * executedPrice, 2);
  const commissionAmount = estimateCommission(grossAmount);
  const baseNotional = round(executedShares * order.referencePrice, 2);
  const slippageAmount =
    order.side === "buy"
      ? round(Math.max(grossAmount - baseNotional, 0), 2)
      : round(Math.max(baseNotional - grossAmount, 0), 2);
  let realizedPnl = 0;

  if (order.side === "buy") {
    if (grossAmount + commissionAmount > state.cash + 0.01) {
      throw new Error("Yeterli nakit kalmadigi icin emir doldurulamadi.");
    }

    const nextShares = roundShares((position?.shares ?? 0) + executedShares);
    const currentCost = (position?.shares ?? 0) * (position?.averageCost ?? 0);
    const nextAverageCost = round((currentCost + grossAmount + commissionAmount) / nextShares, 4);

    state.positions[symbol] = {
      symbol,
      currency: snapshot.currency,
      shares: nextShares,
      averageCost: nextAverageCost,
      openedAt: position?.openedAt ?? executedAt,
    };
    state.cash = round(state.cash - grossAmount - commissionAmount, 2);
  } else {
    if (!position || position.shares <= 0) {
      throw new Error("Satis icin acik pozisyon bulunmuyor.");
    }

    if (executedShares > position.shares + ORDER_EPSILON) {
      throw new Error("Pozisyondan fazla satis denendi.");
    }

    const netProceeds = round(grossAmount - commissionAmount, 2);
    realizedPnl = round(netProceeds - position.averageCost * executedShares, 2);
    const remainingShares = roundShares(position.shares - executedShares);

    state.cash = round(state.cash + netProceeds, 2);
    state.realizedPnl = round(state.realizedPnl + realizedPnl, 2);

    if (remainingShares <= ORDER_EPSILON) {
      delete state.positions[symbol];
    } else {
      state.positions[symbol] = {
        ...position,
        shares: remainingShares,
      };
    }
  }

  syncAverageFillPrice(order, executedShares, executedPrice);
  order.updatedAt = executedAt;
  if (order.triggerStatus === "armed") {
    order.triggerStatus = "triggered";
    order.triggeredAt = executedAt;
  }

  const execution: ExecutionRecord = {
    id: crypto.randomUUID(),
    orderId: order.id,
    symbol,
    currency: snapshot.currency,
    side: order.side,
    orderType: order.type,
    shares: executedShares,
    price: executedPrice,
    grossAmount,
    commissionAmount,
    slippageAmount,
    liquidityPercent:
      availableLiquidity > 0 ? round((executedShares / availableLiquidity) * 100, 2) : 0,
    executedAt,
    reason: resolveExecutionReason(order),
  };

  order.executionIds = [execution.id, ...order.executionIds];

  const trade: TradeRecord = {
    id: execution.id,
    orderId: order.id,
    executionId: execution.id,
    symbol,
    currency: snapshot.currency,
    side: order.side,
    orderType: order.type,
    shares: executedShares,
    price: executedPrice,
    amount: grossAmount,
    commission: commissionAmount,
    slippage: slippageAmount,
    executedAt,
    realizedPnl,
    note: order.note,
  };

  appendExecution(state, execution, trade);

  return {
    execution,
    trade,
  };
}

function addBracketChildren(
  state: PortfolioState,
  parentOrder: OrderRecord,
  snapshot: MarketSnapshot,
  executedShares: number,
  createdAt: string,
) {
  if (parentOrder.side !== "buy" || !parentOrder.bracket) {
    return [];
  }

  const children: OrderRecord[] = [];
  const ocoGroupId = crypto.randomUUID();

  if (typeof parentOrder.bracket.takeProfit === "number") {
    const takeProfitOrder = createOrderRecord(
      {
        symbol: parentOrder.symbol,
        currency: snapshot.currency,
        side: "sell",
        type: "limit",
        requestedShares: executedShares,
        referencePrice: snapshot.price,
        submittedAt: createdAt,
        source: "bracket",
        limitPrice: parentOrder.bracket.takeProfit,
        parentOrderId: parentOrder.id,
        ocoGroupId,
        note: "Bracket take-profit",
      },
      "pending",
      "inactive",
    );

    children.push(takeProfitOrder);
  }

  if (typeof parentOrder.bracket.stopLoss === "number") {
    const stopLossOrder = createOrderRecord(
      {
        symbol: parentOrder.symbol,
        currency: snapshot.currency,
        side: "sell",
        type: "stop",
        requestedShares: executedShares,
        referencePrice: snapshot.price,
        submittedAt: createdAt,
        source: "bracket",
        stopPrice: parentOrder.bracket.stopLoss,
        parentOrderId: parentOrder.id,
        ocoGroupId,
        note: "Bracket stop-loss",
      },
      "pending",
      "armed",
    );

    children.push(stopLossOrder);
  }

  if (children.length === 0) {
    return children;
  }

  state.orders = [...children, ...state.orders].slice(0, MAX_ORDER_LOGS);
  state.updatedAt = createdAt;
  return children;
}

function rebalanceOcoSiblings(
  state: PortfolioState,
  filledOrder: OrderRecord,
  filledShares: number,
  updatedAt: string,
) {
  if (!filledOrder.ocoGroupId || filledOrder.side !== "sell") {
    return;
  }

  state.orders.forEach((candidate) => {
    if (
      candidate.ocoGroupId !== filledOrder.ocoGroupId ||
      candidate.id === filledOrder.id ||
      !isActiveOrderStatus(candidate.status)
    ) {
      return;
    }

    candidate.requestedShares = roundShares(Math.max(candidate.requestedShares - filledShares, 0));
    candidate.remainingShares = roundShares(Math.max(candidate.remainingShares - filledShares, 0));
    candidate.updatedAt = updatedAt;

    if (candidate.remainingShares <= ORDER_EPSILON) {
      candidate.remainingShares = 0;
      candidate.status = "cancelled";
      candidate.cancellationReason = "OCO eslesmesi diger bacak dolduruldugu icin iptal edildi.";
    }
  });
}

export function submitOrderToState(
  state: PortfolioState,
  payload: OrderPayload,
  snapshot: MarketSnapshot,
  submittedAt: string,
  options: SubmitOrderOptions = {},
) {
  const type = normalizeOrderType(payload.type);
  const requestedShares = normalizeOrderQuantity(payload, estimatedWorkingPrice(payload, snapshot));

  if (snapshot.currency !== state.baseCurrency) {
    return rejectOrder(
      state,
      payload,
      snapshot,
      submittedAt,
      `${snapshot.symbol} ${snapshot.currency} ile islem goruyor. Demo hesap ${state.baseCurrency} tabanli.`,
      options,
    );
  }

  if (requestedShares <= 0) {
    return rejectOrder(
      state,
      payload,
      snapshot,
      submittedAt,
      "Gecerli lot veya tutar girilmeli.",
      options,
    );
  }

  if (
    (type === "limit" || type === "stop_limit") &&
    (!Number.isFinite(payload.limitPrice) || (payload.limitPrice ?? 0) <= 0)
  ) {
    return rejectOrder(
      state,
      payload,
      snapshot,
      submittedAt,
      "Limit emirleri icin limit fiyat zorunlu.",
      options,
    );
  }

  if (
    (type === "stop" || type === "stop_limit") &&
    (!Number.isFinite(payload.stopPrice) || (payload.stopPrice ?? 0) <= 0)
  ) {
    return rejectOrder(
      state,
      payload,
      snapshot,
      submittedAt,
      "Stop emirleri icin stop fiyat zorunlu.",
      options,
    );
  }

  const bracketError = validateBracket(payload, estimatedWorkingPrice(payload, snapshot));
  if (bracketError) {
    return rejectOrder(state, payload, snapshot, submittedAt, bracketError, options);
  }

  const candle = latestCandle(snapshot);
  const maxOrderShares = Math.max(Math.floor(candle.volume * MAX_ORDER_PARTICIPATION_RATE), 250);

  if (requestedShares > maxOrderShares) {
    return rejectOrder(
      state,
      payload,
      snapshot,
      submittedAt,
      `Emir boyutu mevcut gunluk hacme gore cok buyuk. Azami izin verilen boyut yaklasik ${maxOrderShares} lot.`,
      options,
    );
  }

  if (payload.side === "buy") {
    const buyPrice = estimatedWorkingPrice(payload, snapshot);
    const grossAmount = round(requestedShares * buyPrice, 2);
    const totalCost = grossAmount + estimateCommission(grossAmount);

    if (totalCost > state.cash + 0.01) {
      return rejectOrder(
        state,
        payload,
        snapshot,
        submittedAt,
        "Yeterli nakit veya alim gucu yok.",
        options,
      );
    }
  } else {
    const position = state.positions[snapshot.symbol];
    const reservedShares = activeSellReservations(state, snapshot.symbol);
    const availableShares = roundShares((position?.shares ?? 0) - reservedShares);

    if (!position || position.shares <= ORDER_EPSILON) {
      return rejectOrder(
        state,
        payload,
        snapshot,
        submittedAt,
        "Satilabilecek acik pozisyon bulunmuyor.",
        options,
      );
    }

    if (requestedShares > availableShares + ORDER_EPSILON) {
      return rejectOrder(
        state,
        payload,
        snapshot,
        submittedAt,
        `Pozisyondan fazla satis denendi. Kullanilabilir miktar ${Math.max(availableShares, 0)} lot.`,
        options,
      );
    }
  }

  const order = createOrderRecord(
    {
      symbol: snapshot.symbol,
      currency: snapshot.currency,
      side: payload.side,
      type,
      requestedShares,
      referencePrice: snapshot.price,
      submittedAt,
      source: options.source ?? "manual",
      limitPrice: payload.limitPrice,
      stopPrice: payload.stopPrice,
      bracket: payload.bracket,
      parentOrderId: options.parentOrderId,
      ocoGroupId: options.ocoGroupId,
      note: payload.note ?? options.note,
    },
    "pending",
    type === "stop" || type === "stop_limit" ? "armed" : "inactive",
  );

  appendOrder(state, order);
  return order;
}

export function simulateOrdersOnState(
  state: PortfolioState,
  snapshots: Record<string, MarketSnapshot>,
  simulatedAt: string,
  filter?: OrderSimulationPayload,
): SimulationResult {
  const liquidityRemaining = new Map<string, number>();
  const executions: ExecutionRecord[] = [];
  const trades: TradeRecord[] = [];
  const changedOrders: OrderRecord[] = [];

  Object.values(snapshots).forEach((snapshot) => {
    liquidityRemaining.set(snapshot.symbol, computeLiquidityCap(snapshot));
  });

  const activeOrders = state.orders
    .filter((order) => {
      if (!isActiveOrderStatus(order.status)) {
        return false;
      }

      if (filter?.symbol && order.symbol !== filter.symbol) {
        return false;
      }

      if (filter?.orderIds?.length && !filter.orderIds.includes(order.id)) {
        return false;
      }

      return true;
    })
    .sort(
      (left, right) =>
        new Date(left.submittedAt).getTime() - new Date(right.submittedAt).getTime(),
    );

  for (const order of activeOrders) {
    const snapshot = snapshots[order.symbol];

    if (!snapshot) {
      continue;
    }

    const trigger = orderTriggerInfo(order, snapshot);
    if (trigger.nextTriggerStatus === "triggered" && order.triggerStatus !== "triggered") {
      order.triggerStatus = "triggered";
      order.triggeredAt = simulatedAt;
      order.updatedAt = simulatedAt;
      changedOrders.push(order);
    }

    if (!trigger.eligible) {
      continue;
    }

    const availableLiquidity = liquidityRemaining.get(order.symbol) ?? 0;
    if (availableLiquidity <= 0) {
      continue;
    }

    let executableShares = Math.min(order.remainingShares, availableLiquidity);

    if (order.side === "buy") {
      const slipPercent = slippagePercentFor(order, snapshot, executableShares);
      const price = applyPriceConstraints(order, trigger.basePrice, slipPercent);
      const affordableShares = maxAffordableShares(state.cash, price);
      executableShares = Math.min(executableShares, affordableShares);
    }

    if (executableShares <= ORDER_EPSILON) {
      continue;
    }

    executableShares = roundShares(executableShares);
    const slippagePercent = slippagePercentFor(order, snapshot, executableShares);
    const executionPrice = applyPriceConstraints(order, trigger.basePrice, slippagePercent);
    const { execution, trade } = applyExecutionToState(
      state,
      order,
      snapshot,
      executableShares,
      executionPrice,
      simulatedAt,
      slippagePercent,
      availableLiquidity,
    );

    executions.push(execution);
    trades.push(trade);
    liquidityRemaining.set(order.symbol, Math.max(availableLiquidity - executableShares, 0));
    changedOrders.push(order);

    if (order.side === "buy" && order.bracket) {
      changedOrders.push(...addBracketChildren(state, order, snapshot, executableShares, simulatedAt));
    }

    if (order.side === "sell" && order.ocoGroupId) {
      rebalanceOcoSiblings(state, order, executableShares, simulatedAt);
    }
  }

  state.updatedAt = simulatedAt;

  return {
    executions,
    orders: Array.from(new Map(changedOrders.map((order) => [order.id, order])).values()),
    trades,
  };
}
