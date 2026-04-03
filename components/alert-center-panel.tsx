"use client";

import { useEffect, useMemo, useState } from "react";

import { formatDateTime, formatNumber } from "@/lib/format";
import type {
  AlertCreatePayload,
  AlertHistoryEntry,
  AlertListResponse,
  AlertRule,
  AlertRuleType,
  StrategyProfileId,
} from "@/lib/types";

import styles from "./market-lab.module.css";

interface SymbolOption {
  symbol: string;
  displaySymbol: string;
  companyName: string;
}

interface AlertCenterPanelProps {
  alerts: AlertListResponse | null;
  loading: boolean;
  error: string | null;
  selectedStrategy: StrategyProfileId;
  defaultSymbol: string;
  symbolOptions: SymbolOption[];
  onAlertsChange: () => void;
  onFeedback: (message: string | null) => void;
  onError: (message: string | null) => void;
}

const ALERT_TYPE_LABELS: Record<AlertRuleType, string> = {
  price_above: "Fiyat ustu",
  price_below: "Fiyat alti",
  rank_score_above: "Skor esigi",
  regime_change: "Rejim degisimi",
  rsi_overbought: "RSI asiri alim",
  rsi_oversold: "RSI asiri satim",
  ma_crossover: "MA crossover",
  enters_top_ranked_list: "Top liste girisi",
};

function requiresSymbol(type: AlertRuleType) {
  return type !== "regime_change";
}

function usesThreshold(type: AlertRuleType) {
  return (
    type === "price_above" ||
    type === "price_below" ||
    type === "rank_score_above" ||
    type === "rsi_overbought" ||
    type === "rsi_oversold"
  );
}

function usesTopList(type: AlertRuleType) {
  return type === "enters_top_ranked_list";
}

function usesCrossover(type: AlertRuleType) {
  return type === "ma_crossover";
}

function normalizeSymbol(value: string) {
  const trimmed = value.trim().toUpperCase();

  if (!trimmed) {
    return "";
  }

  return trimmed.endsWith(".IS") ? trimmed : `${trimmed}.IS`;
}

function buildDefaultAlertName(type: AlertRuleType, symbol: string) {
  const normalized = normalizeSymbol(symbol);
  const label = ALERT_TYPE_LABELS[type];
  return normalized ? `${normalized} ${label}` : label;
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, {
    cache: "no-store",
    ...init,
  });
  const data = (await response.json()) as T & { message?: string };

  if (!response.ok) {
    throw new Error(data.message ?? "Alarm istegi tamamlanamadi.");
  }

  return data;
}

function describeRule(rule: AlertRule) {
  switch (rule.type) {
    case "price_above":
      return `Fiyat ${formatNumber(rule.threshold ?? 0)} uzerine ciktiginda tetiklenir.`;
    case "price_below":
      return `Fiyat ${formatNumber(rule.threshold ?? 0)} altina indiginde tetiklenir.`;
    case "rank_score_above":
      return `${rule.strategy ?? "rank-score"} stratejisinde skor esigini izler.`;
    case "regime_change":
      return `${rule.strategy ?? "rank-score"} rejim degisimini izler.`;
    case "rsi_overbought":
      return `RSI ${formatNumber(rule.threshold ?? 70)} uzerine cikinca tetiklenir.`;
    case "rsi_oversold":
      return `RSI ${formatNumber(rule.threshold ?? 30)} altina inince tetiklenir.`;
    case "ma_crossover":
      return `${rule.shortWindow ?? 20}/${rule.longWindow ?? 50} MA ${rule.crossoverDirection ?? "bullish"} crossover izlenir.`;
    case "enters_top_ranked_list":
      return `${rule.strategy ?? "rank-score"} icin ilk ${rule.topListLimit ?? 8} listesine girisi izler.`;
    default:
      return "Alarm ayrintisi bulunamadi.";
  }
}

function renderContext(entry: AlertHistoryEntry) {
  const pairs = Object.entries(entry.context).filter(([, value]) => value !== null);

  if (pairs.length === 0) {
    return null;
  }

  return (
    <div className={styles.alertContextList}>
      {pairs.slice(0, 4).map(([key, value]) => (
        <span key={`${entry.id}-${key}`} className={styles.journalTag}>
          {key}: {typeof value === "number" ? formatNumber(value) : String(value)}
        </span>
      ))}
    </div>
  );
}

export function AlertCenterPanel({
  alerts,
  loading,
  error,
  selectedStrategy,
  defaultSymbol,
  symbolOptions,
  onAlertsChange,
  onFeedback,
  onError,
}: AlertCenterPanelProps) {
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<AlertRuleType>("price_above");
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [strategy, setStrategy] = useState<StrategyProfileId>(selectedStrategy);
  const [threshold, setThreshold] = useState("0");
  const [topListLimit, setTopListLimit] = useState("8");
  const [crossoverDirection, setCrossoverDirection] = useState<"bullish" | "bearish">(
    "bullish",
  );
  const [shortWindow, setShortWindow] = useState("20");
  const [longWindow, setLongWindow] = useState("50");

  useEffect(() => {
    setStrategy(selectedStrategy);
  }, [selectedStrategy]);

  useEffect(() => {
    if (!symbol && defaultSymbol) {
      setSymbol(defaultSymbol);
    }
  }, [defaultSymbol, symbol]);

  const dedupedOptions = useMemo(
    () =>
      [...new Map(symbolOptions.map((option) => [option.symbol, option])).values()].sort((left, right) =>
        left.displaySymbol.localeCompare(right.displaySymbol, "tr"),
      ),
    [symbolOptions],
  );

  async function handleCreateRule() {
    try {
      setSubmitting(true);
      onError(null);
      const payload: AlertCreatePayload = {
        name: name.trim() || buildDefaultAlertName(type, symbol),
        type,
        symbol: requiresSymbol(type) ? normalizeSymbol(symbol) : undefined,
        strategy,
        threshold: usesThreshold(type) ? Number(threshold) : undefined,
        topListLimit: usesTopList(type) ? Number(topListLimit) : undefined,
        crossoverDirection: usesCrossover(type) ? crossoverDirection : undefined,
        shortWindow: usesCrossover(type) ? Number(shortWindow) : undefined,
        longWindow: usesCrossover(type) ? Number(longWindow) : undefined,
      };

      await requestJson<AlertRule>("/api/alerts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      setName("");
      onFeedback("Alarm kurali kaydedildi.");
      onAlertsChange();
    } catch (caughtError) {
      onError(
        caughtError instanceof Error
          ? caughtError.message
          : "Alarm kurali kaydedilemedi.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteRule(id: string) {
    try {
      setDeletingId(id);
      onError(null);
      await requestJson<{ ok: true }>(`/api/alerts/${id}`, {
        method: "DELETE",
      });
      onFeedback("Alarm kurali silindi.");
      onAlertsChange();
    } catch (caughtError) {
      onError(
        caughtError instanceof Error
          ? caughtError.message
          : "Alarm kurali silinemedi.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className={styles.alertPanel}>
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.metaLabel}>Alert center</p>
          <h2 className={styles.sectionTitle}>In-app alarm kurallari</h2>
        </div>
        <span className={styles.sectionNote}>
          Alarm degerlendirmesi uygulama acildiginda ve bu panel yenilendiginde calisir.
        </span>
      </div>

      <div className={styles.alertLayout}>
        <article className={styles.alertCreateCard}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.metaLabel}>Yeni alarm</p>
              <h3 className={styles.sectionTitle}>Hafif ama izlenebilir kurallar</h3>
            </div>
          </div>

          <div className={styles.formGrid}>
            <label className={styles.formField}>
              Alarm tipi
              <select
                className={styles.formInput}
                value={type}
                onChange={(event) => setType(event.target.value as AlertRuleType)}
              >
                {Object.entries(ALERT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.formField}>
              Isim
              <input
                className={styles.formInput}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={buildDefaultAlertName(type, symbol)}
              />
            </label>

            {requiresSymbol(type) ? (
              <label className={styles.formField}>
                Sembol
                <input
                  list="alert-symbol-options"
                  className={styles.formInput}
                  value={symbol}
                  onChange={(event) => setSymbol(event.target.value)}
                  placeholder="THYAO.IS"
                />
                <datalist id="alert-symbol-options">
                  {dedupedOptions.map((option) => (
                    <option key={option.symbol} value={option.symbol}>
                      {option.displaySymbol} - {option.companyName}
                    </option>
                  ))}
                </datalist>
              </label>
            ) : null}

            <label className={styles.formField}>
              Strateji
              <select
                className={styles.formInput}
                value={strategy}
                onChange={(event) =>
                  setStrategy(event.target.value as StrategyProfileId)
                }
              >
                <option value="rank-score">Rank Score</option>
                <option value="momentum">Momentum</option>
                <option value="breakout">Breakout</option>
                <option value="mean-reversion">Mean Reversion</option>
              </select>
            </label>

            {usesThreshold(type) ? (
              <label className={styles.formField}>
                Esik
                <input
                  className={styles.formInput}
                  type="number"
                  step="0.01"
                  min="0"
                  value={threshold}
                  onChange={(event) => setThreshold(event.target.value)}
                />
              </label>
            ) : null}

            {usesTopList(type) ? (
              <label className={styles.formField}>
                Top liste limiti
                <input
                  className={styles.formInput}
                  type="number"
                  step="1"
                  min="1"
                  value={topListLimit}
                  onChange={(event) => setTopListLimit(event.target.value)}
                />
              </label>
            ) : null}

            {usesCrossover(type) ? (
              <>
                <label className={styles.formField}>
                  Yon
                  <select
                    className={styles.formInput}
                    value={crossoverDirection}
                    onChange={(event) =>
                      setCrossoverDirection(
                        event.target.value as "bullish" | "bearish",
                      )
                    }
                  >
                    <option value="bullish">Bullish</option>
                    <option value="bearish">Bearish</option>
                  </select>
                </label>
                <label className={styles.formField}>
                  Kisa pencere
                  <input
                    className={styles.formInput}
                    type="number"
                    step="1"
                    min="2"
                    value={shortWindow}
                    onChange={(event) => setShortWindow(event.target.value)}
                  />
                </label>
                <label className={styles.formField}>
                  Uzun pencere
                  <input
                    className={styles.formInput}
                    type="number"
                    step="1"
                    min="3"
                    value={longWindow}
                    onChange={(event) => setLongWindow(event.target.value)}
                  />
                </label>
              </>
            ) : null}
          </div>

          <div className={styles.formFooter}>
            <div className={styles.formHints}>
              <span className={styles.metaSubtle}>
                Ilk surum icin yalnizca uygulama ici bildirim tutulur.
              </span>
              <span className={styles.metaSubtle}>
                Kurallar uygulama yenilendiginde server tarafinda tekrar degerlendirilir.
              </span>
            </div>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => void handleCreateRule()}
              disabled={submitting}
            >
              {submitting ? "Kaydediliyor" : "Alarm ekle"}
            </button>
          </div>
        </article>

        <div className={styles.alertStack}>
          <article className={styles.analyticsCard}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.metaLabel}>Anlik tetiklenenler</p>
                <h3 className={styles.sectionTitle}>Bu yenilemede yakalanan sinyaller</h3>
              </div>
            </div>

            {loading ? (
              <div className={styles.emptyState}>Alarm degerlendirmesi calisiyor.</div>
            ) : error ? (
              <div className={styles.emptyState}>{error}</div>
            ) : alerts?.triggeredNow.length ? (
              <div className={styles.alertHistoryList}>
                {alerts.triggeredNow.map((entry) => (
                  <div key={entry.id} className={styles.alertHistoryItem}>
                    <div className={styles.alertHeadline}>
                      <strong>{entry.ruleName}</strong>
                      <span className={styles.statusPill + " " + styles.statusFilled}>
                        Yeni
                      </span>
                    </div>
                    <div className={styles.journalText}>{entry.message}</div>
                    {renderContext(entry)}
                    <div className={styles.metaSubtle}>{formatDateTime(entry.triggeredAt)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.emptyState}>
                Bu oturumda yeni alarm tetiklenmedi.
              </div>
            )}
          </article>

          <article className={styles.analyticsCard}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.metaLabel}>Aktif kurallar</p>
                <h3 className={styles.sectionTitle}>Kayitli alarm listesi</h3>
              </div>
            </div>

            {alerts?.rules.length ? (
              <div className={styles.alertRuleList}>
                {alerts.rules.map((rule) => (
                  <div key={rule.id} className={styles.alertRuleCard}>
                    <div className={styles.alertHeadline}>
                      <div>
                        <strong>{rule.name}</strong>
                        <div className={styles.metaSubtle}>{describeRule(rule)}</div>
                      </div>
                      <button
                        type="button"
                        className={styles.iconButton}
                        onClick={() => void handleDeleteRule(rule.id)}
                        disabled={deletingId === rule.id}
                      >
                        {deletingId === rule.id ? "Siliniyor" : "Sil"}
                      </button>
                    </div>
                    <div className={styles.alertContextList}>
                      <span className={styles.journalTag}>{ALERT_TYPE_LABELS[rule.type]}</span>
                      {rule.symbol ? (
                        <span className={styles.journalTag}>{rule.symbol}</span>
                      ) : null}
                      <span className={styles.journalTag}>
                        {rule.strategy ?? "rank-score"}
                      </span>
                    </div>
                    <div className={styles.metaSubtle}>
                      Son durum anahtari: {rule.lastStateKey ?? "Ilk degerlendirme bekliyor"}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.emptyState}>
                Henuz kayitli alarm kurali yok.
              </div>
            )}
          </article>

          <article className={styles.analyticsCard}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.metaLabel}>Alarm gecmisi</p>
                <h3 className={styles.sectionTitle}>Son tetiklenen kayitlar</h3>
              </div>
            </div>

            {alerts?.history.length ? (
              <div className={styles.alertHistoryList}>
                {alerts.history.slice(0, 10).map((entry) => (
                  <div key={entry.id} className={styles.alertHistoryItem}>
                    <div className={styles.alertHeadline}>
                      <strong>{entry.ruleName}</strong>
                      <span className={styles.metaSubtle}>
                        {formatDateTime(entry.triggeredAt)}
                      </span>
                    </div>
                    <div className={styles.journalText}>{entry.message}</div>
                    {renderContext(entry)}
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.emptyState}>
                Tetiklenen alarm gecmisi henuz bos.
              </div>
            )}
          </article>
        </div>
      </div>
    </section>
  );
}
