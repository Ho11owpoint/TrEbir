import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import { getMarketSnapshot } from "./market";
import { getScannerRankingSnapshot } from "./scanner";
import type {
  AlertCreatePayload,
  AlertHistoryEntry,
  AlertListResponse,
  AlertRule,
  StrategyProfileId,
} from "./types";

const DATA_DIRECTORY = path.join(process.cwd(), "data");
const ALERTS_FILE = path.join(DATA_DIRECTORY, "alerts.json");
const MAX_ALERT_HISTORY = 250;

interface AlertStore {
  rules: AlertRule[];
  history: AlertHistoryEntry[];
  updatedAt: string;
}

function createInitialStore(): AlertStore {
  return {
    rules: [],
    history: [],
    updatedAt: new Date().toISOString(),
  };
}

function sanitizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function normalizeSymbol(value: unknown) {
  const symbol = sanitizeText(value, 24).toUpperCase();

  if (!symbol) {
    return "";
  }

  return symbol.endsWith(".IS") ? symbol : `${symbol}.IS`;
}

function normalizeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function normalizeRule(rawRule: Partial<AlertRule>): AlertRule | null {
  const type = rawRule.type;

  if (
    type !== "price_above" &&
    type !== "price_below" &&
    type !== "rank_score_above" &&
    type !== "regime_change" &&
    type !== "rsi_overbought" &&
    type !== "rsi_oversold" &&
    type !== "ma_crossover" &&
    type !== "enters_top_ranked_list"
  ) {
    return null;
  }

  const now = new Date().toISOString();

  return {
    id: sanitizeText(rawRule.id, 64) || crypto.randomUUID(),
    name: sanitizeText(rawRule.name, 120) || "Yeni alarm",
    type,
    enabled: rawRule.enabled !== false,
    symbol: normalizeSymbol(rawRule.symbol) || undefined,
    strategy:
      rawRule.strategy === "momentum" ||
      rawRule.strategy === "breakout" ||
      rawRule.strategy === "mean-reversion" ||
      rawRule.strategy === "rank-score"
        ? rawRule.strategy
        : "rank-score",
    threshold: normalizeNumber(rawRule.threshold),
    topListLimit: normalizeInteger(rawRule.topListLimit) ?? 8,
    crossoverDirection:
      rawRule.crossoverDirection === "bearish" ? "bearish" : "bullish",
    shortWindow: normalizeInteger(rawRule.shortWindow) ?? 20,
    longWindow: normalizeInteger(rawRule.longWindow) ?? 50,
    channels: ["in_app"],
    lastStateKey: typeof rawRule.lastStateKey === "string" ? rawRule.lastStateKey : null,
    createdAt:
      typeof rawRule.createdAt === "string" ? rawRule.createdAt : now,
    updatedAt:
      typeof rawRule.updatedAt === "string" ? rawRule.updatedAt : now,
  };
}

function normalizeHistoryEntry(rawEntry: Partial<AlertHistoryEntry>) {
  const type = rawEntry.type;

  if (
    type !== "price_above" &&
    type !== "price_below" &&
    type !== "rank_score_above" &&
    type !== "regime_change" &&
    type !== "rsi_overbought" &&
    type !== "rsi_oversold" &&
    type !== "ma_crossover" &&
    type !== "enters_top_ranked_list"
  ) {
    return null;
  }

  return {
    id: sanitizeText(rawEntry.id, 64) || crypto.randomUUID(),
    ruleId: sanitizeText(rawEntry.ruleId, 64),
    ruleName: sanitizeText(rawEntry.ruleName, 120),
    type,
    symbol: normalizeSymbol(rawEntry.symbol) || null,
    strategy:
      rawEntry.strategy === "momentum" ||
      rawEntry.strategy === "breakout" ||
      rawEntry.strategy === "mean-reversion" ||
      rawEntry.strategy === "rank-score"
        ? rawEntry.strategy
        : null,
    message: sanitizeText(rawEntry.message, 240),
    triggeredAt:
      typeof rawEntry.triggeredAt === "string"
        ? rawEntry.triggeredAt
        : new Date().toISOString(),
    channel: "in_app" as const,
    context:
      rawEntry.context && typeof rawEntry.context === "object"
        ? (rawEntry.context as Record<string, string | number | boolean | null>)
        : {},
  } satisfies AlertHistoryEntry;
}

function normalizeStore(rawStore: Partial<AlertStore> | null | undefined): AlertStore {
  const initial = createInitialStore();

  return {
    rules: Array.isArray(rawStore?.rules)
      ? rawStore.rules
          .map((rule) => normalizeRule(rule))
          .filter((rule): rule is AlertRule => rule !== null)
      : [],
    history: Array.isArray(rawStore?.history)
      ? rawStore.history
          .map((entry) => normalizeHistoryEntry(entry))
          .filter((entry): entry is AlertHistoryEntry => entry !== null)
          .slice(0, MAX_ALERT_HISTORY)
      : [],
    updatedAt:
      typeof rawStore?.updatedAt === "string" ? rawStore.updatedAt : initial.updatedAt,
  };
}

async function ensureAlertsFile() {
  await fs.mkdir(DATA_DIRECTORY, { recursive: true });

  try {
    await fs.access(ALERTS_FILE);
  } catch {
    await fs.writeFile(ALERTS_FILE, JSON.stringify(createInitialStore(), null, 2), "utf8");
  }
}

async function readAlertStore() {
  await ensureAlertsFile();

  try {
    const rawContent = await fs.readFile(ALERTS_FILE, "utf8");
    return normalizeStore(JSON.parse(rawContent) as AlertStore);
  } catch {
    const initial = createInitialStore();
    await writeAlertStore(initial);
    return initial;
  }
}

async function writeAlertStore(store: AlertStore) {
  await fs.mkdir(DATA_DIRECTORY, { recursive: true });
  await fs.writeFile(ALERTS_FILE, JSON.stringify(store, null, 2), "utf8");
}

function validateAlertPayload(payload: AlertCreatePayload) {
  const name = sanitizeText(payload.name, 120);

  if (!name) {
    throw new Error("Alarm ismi zorunlu.");
  }

  const type = payload.type;
  const symbol = normalizeSymbol(payload.symbol);
  const threshold = normalizeNumber(payload.threshold);
  const topListLimit = normalizeInteger(payload.topListLimit) ?? 8;
  const shortWindow = normalizeInteger(payload.shortWindow) ?? 20;
  const longWindow = normalizeInteger(payload.longWindow) ?? 50;
  const strategy: StrategyProfileId =
    payload.strategy === "momentum" ||
    payload.strategy === "breakout" ||
    payload.strategy === "mean-reversion" ||
    payload.strategy === "rank-score"
      ? payload.strategy
      : "rank-score";

  if (
    (type === "price_above" ||
      type === "price_below" ||
      type === "rank_score_above" ||
      type === "rsi_overbought" ||
      type === "rsi_oversold" ||
      type === "ma_crossover" ||
      type === "enters_top_ranked_list") &&
    !symbol
  ) {
    throw new Error("Bu alarm tipi icin sembol secilmeli.");
  }

  if (
    (type === "price_above" ||
      type === "price_below" ||
      type === "rank_score_above" ||
      type === "rsi_overbought" ||
      type === "rsi_oversold") &&
    (threshold === undefined || threshold <= 0)
  ) {
    throw new Error("Bu alarm tipi icin pozitif threshold gerekli.");
  }

  if (type === "ma_crossover" && shortWindow >= longWindow) {
    throw new Error("Kisa MA penceresi uzun pencerenin altinda olmali.");
  }

  if (type === "enters_top_ranked_list" && topListLimit <= 0) {
    throw new Error("Top liste limiti pozitif olmali.");
  }

  return {
    name,
    type,
    symbol: symbol || undefined,
    threshold,
    topListLimit,
    shortWindow,
    longWindow,
    strategy,
    crossoverDirection:
      payload.crossoverDirection === "bearish" ? "bearish" : "bullish",
  } as const;
}

function simpleMovingAverage(closes: number[], period: number) {
  if (closes.length < period) {
    return null;
  }

  const subset = closes.slice(-period);
  return subset.reduce((total, value) => total + value, 0) / subset.length;
}

function buildAlertMessage(
  rule: AlertRule,
  valueText: string,
) {
  const symbolText = rule.symbol ? `${rule.symbol} ` : "";
  return `${symbolText}${rule.name}: ${valueText}`;
}

function createHistoryEntry(
  rule: AlertRule,
  message: string,
  context: Record<string, string | number | boolean | null>,
): AlertHistoryEntry {
  return {
    id: crypto.randomUUID(),
    ruleId: rule.id,
    ruleName: rule.name,
    type: rule.type,
    symbol: rule.symbol ?? null,
    strategy: rule.strategy ?? null,
    message,
    triggeredAt: new Date().toISOString(),
    channel: "in_app",
    context,
  };
}

export async function createAlertRule(payload: AlertCreatePayload) {
  const store = await readAlertStore();
  const validated = validateAlertPayload(payload);
  const now = new Date().toISOString();
  const rule: AlertRule = {
    id: crypto.randomUUID(),
    name: validated.name,
    type: validated.type,
    enabled: true,
    symbol: validated.symbol,
    strategy: validated.strategy,
    threshold: validated.threshold,
    topListLimit: validated.topListLimit,
    crossoverDirection: validated.crossoverDirection,
    shortWindow: validated.shortWindow,
    longWindow: validated.longWindow,
    channels: ["in_app"],
    lastStateKey: null,
    createdAt: now,
    updatedAt: now,
  };

  store.rules = [rule, ...store.rules];
  store.updatedAt = now;
  await writeAlertStore(store);

  return rule;
}

export async function deleteAlertRule(id: string) {
  const store = await readAlertStore();
  const nextRules = store.rules.filter((rule) => rule.id !== id);

  if (nextRules.length === store.rules.length) {
    throw new Error("Silinecek alarm kurali bulunamadi.");
  }

  store.rules = nextRules;
  store.updatedAt = new Date().toISOString();
  await writeAlertStore(store);
}

export async function getAlertCenter(): Promise<AlertListResponse> {
  const store = await readAlertStore();
  const triggeredNow: AlertHistoryEntry[] = [];
  const rankingCache = new Map<StrategyProfileId, Awaited<ReturnType<typeof getScannerRankingSnapshot>>>();
  const symbolSnapshotCache = new Map<string, Awaited<ReturnType<typeof getMarketSnapshot>>>();
  let storeChanged = false;

  async function getRanking(strategy: StrategyProfileId) {
    const cached = rankingCache.get(strategy);

    if (cached) {
      return cached;
    }

    const snapshot = await getScannerRankingSnapshot(strategy);
    rankingCache.set(strategy, snapshot);
    return snapshot;
  }

  async function getSymbolSnapshot(symbol: string) {
    const cached = symbolSnapshotCache.get(symbol);

    if (cached) {
      return cached;
    }

    const snapshot = await getMarketSnapshot(symbol);
    symbolSnapshotCache.set(symbol, snapshot);
    return snapshot;
  }

  for (const rule of store.rules) {
    if (!rule.enabled) {
      continue;
    }

    let nextStateKey = rule.lastStateKey;
    let historyEntry: AlertHistoryEntry | null = null;

    if (rule.type === "regime_change") {
      const ranking = await getRanking(rule.strategy ?? "rank-score");
      const currentRegime = ranking.benchmark.trend;

      if (rule.lastStateKey && rule.lastStateKey !== currentRegime) {
        historyEntry = createHistoryEntry(
          rule,
          buildAlertMessage(rule, `piyasa rejimi ${currentRegime} moduna gecti.`),
          {
            regime: currentRegime,
          },
        );
      }

      nextStateKey = currentRegime;
    }

    if (
      rule.type === "price_above" ||
      rule.type === "price_below" ||
      rule.type === "rsi_overbought" ||
      rule.type === "rsi_oversold" ||
      rule.type === "ma_crossover"
    ) {
      const snapshot = await getSymbolSnapshot(rule.symbol as string);

      if (rule.type === "price_above" || rule.type === "price_below") {
        const matched =
          rule.type === "price_above"
            ? snapshot.price >= (rule.threshold ?? 0)
            : snapshot.price <= (rule.threshold ?? 0);

        if (matched && rule.lastStateKey !== "matched") {
          historyEntry = createHistoryEntry(
            rule,
            buildAlertMessage(rule, `fiyat ${snapshot.price} ile esigi gecti.`),
            {
              price: snapshot.price,
              threshold: rule.threshold ?? null,
            },
          );
        }

        nextStateKey = matched ? "matched" : "waiting";
      }

      if (rule.type === "rsi_overbought" || rule.type === "rsi_oversold") {
        const rsi = snapshot.indicators.rsi14 ?? 0;
        const matched =
          rule.type === "rsi_overbought"
            ? rsi >= (rule.threshold ?? 70)
            : rsi <= (rule.threshold ?? 30);

        if (matched && rule.lastStateKey !== "matched") {
          historyEntry = createHistoryEntry(
            rule,
            buildAlertMessage(rule, `RSI ${rsi} ile siniri tetikledi.`),
            {
              rsi,
              threshold: rule.threshold ?? null,
            },
          );
        }

        nextStateKey = matched ? "matched" : "waiting";
      }

      if (rule.type === "ma_crossover") {
        const closes = snapshot.series.map((bar) => bar.close);
        const shortWindow = rule.shortWindow ?? 20;
        const longWindow = rule.longWindow ?? 50;
        const latestShort = simpleMovingAverage(closes, shortWindow);
        const latestLong = simpleMovingAverage(closes, longWindow);
        const previousShort = simpleMovingAverage(closes.slice(0, -1), shortWindow);
        const previousLong = simpleMovingAverage(closes.slice(0, -1), longWindow);
        const direction = rule.crossoverDirection ?? "bullish";
        const crossed =
          latestShort !== null &&
          latestLong !== null &&
          previousShort !== null &&
          previousLong !== null &&
          (direction === "bullish"
            ? previousShort <= previousLong && latestShort > latestLong
            : previousShort >= previousLong && latestShort < latestLong);
        const currentState =
          latestShort !== null && latestLong !== null && latestShort > latestLong
            ? "bullish"
            : "bearish";

        if (crossed && rule.lastStateKey !== direction) {
          historyEntry = createHistoryEntry(
            rule,
            buildAlertMessage(rule, `${direction} MA crossover goruldu.`),
            {
              shortWindow,
              longWindow,
              latestShort,
              latestLong,
            },
          );
        }

        nextStateKey = currentState;
      }
    }

    if (rule.type === "rank_score_above" || rule.type === "enters_top_ranked_list") {
      const ranking = await getRanking(rule.strategy ?? "rank-score");
      const rankedItem = ranking.rankedItems.find(
        (item) => item.snapshot.symbol === rule.symbol,
      );

      if (rule.type === "rank_score_above") {
        const matched = (rankedItem?.evaluation.score ?? -Infinity) >= (rule.threshold ?? 0);

        if (matched && rule.lastStateKey !== "matched") {
          historyEntry = createHistoryEntry(
            rule,
            buildAlertMessage(
              rule,
              `strategy skoru ${rankedItem?.evaluation.score ?? "--"} ile esigi asti.`,
            ),
            {
              score: rankedItem?.evaluation.score ?? null,
              threshold: rule.threshold ?? null,
              strategy: rule.strategy ?? "rank-score",
            },
          );
        }

        nextStateKey = matched ? "matched" : "waiting";
      }

      if (rule.type === "enters_top_ranked_list") {
        const limit = rule.topListLimit ?? 8;
        const inTopList = ranking.rankedItems
          .slice(0, limit)
          .some((item) => item.snapshot.symbol === rule.symbol);

        if (inTopList && rule.lastStateKey !== "matched") {
          historyEntry = createHistoryEntry(
            rule,
            buildAlertMessage(rule, `ilk ${limit} listeye girdi.`),
            {
              topListLimit: limit,
              strategy: rule.strategy ?? "rank-score",
            },
          );
        }

        nextStateKey = inTopList ? "matched" : "waiting";
      }
    }

    if (historyEntry) {
      store.history = [historyEntry, ...store.history].slice(0, MAX_ALERT_HISTORY);
      triggeredNow.push(historyEntry);
      storeChanged = true;
    }

    if (rule.lastStateKey !== nextStateKey) {
      rule.lastStateKey = nextStateKey;
      rule.updatedAt = new Date().toISOString();
      storeChanged = true;
    }
  }

  if (storeChanged) {
    store.updatedAt = new Date().toISOString();
    await writeAlertStore(store);
  }

  return {
    generatedAt: new Date().toISOString(),
    rules: store.rules,
    history: store.history,
    triggeredNow,
  };
}
