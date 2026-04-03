"use client";

import { useEffect, useState } from "react";

import {
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import type {
  BacktestRequest,
  BacktestResponse,
  BacktestStrategyProfile,
  PositionSizingMode,
} from "@/lib/types";

import { BacktestEquityCurve } from "./backtest-equity-curve";
import styles from "./market-lab.module.css";

interface SymbolOption {
  companyName: string;
  displaySymbol: string;
  symbol: string;
}

interface BacktestPanelProps {
  preferredSymbol: string;
  symbolOptions: SymbolOption[];
}

const STRATEGY_OPTIONS: Array<{
  description: string;
  label: string;
  value: BacktestStrategyProfile;
}> = [
  {
    value: "rank-score",
    label: "Rank Score",
    description: "Mevcut sinyal ve benchmark rejimi mantigini kullanir.",
  },
  {
    value: "momentum",
    label: "Momentum",
    description: "Trend ve ivme devamini test eder.",
  },
  {
    value: "breakout",
    label: "Breakout",
    description: "20 gunluk yukari kirilimlari takip eder.",
  },
  {
    value: "mean-reversion",
    label: "Mean Reversion",
    description: "Asiri satimdan ortalamaya donusu arar.",
  },
];

const POSITION_SIZING_OPTIONS: Array<{
  hint: string;
  label: string;
  value: PositionSizingMode;
}> = [
  {
    value: "percent_of_equity",
    label: "Equity %",
    hint: "Her islemde ozkaynak yuzdesi kullanir.",
  },
  {
    value: "fixed_amount",
    label: "Sabit tutar",
    hint: "Her giriste sabit nominal tutar kullanir.",
  },
  {
    value: "risk_based",
    label: "Risk bazli",
    hint: "Stop mesafesine gore risk butcesi hesaplar.",
  },
];

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function createInitialForm(preferredSymbol: string): BacktestRequest {
  const today = new Date();
  const oneYearAgo = new Date(today);
  oneYearAgo.setDate(today.getDate() - 365);

  return {
    symbol: preferredSymbol,
    dateFrom: toDateInputValue(oneYearAgo),
    dateTo: toDateInputValue(today),
    strategy: "rank-score",
    initialCapital: 100_000,
    maxOpenPositions: 1,
    commissionPercent: 0.15,
    slippagePercent: 0.1,
    stopLossPercent: 8,
    takeProfitPercent: 16,
    trailingStopPercent: 6,
    positionSizing: {
      mode: "percent_of_equity",
      value: 20,
    },
  };
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, {
    cache: "no-store",
    ...init,
  });
  const data = (await response.json()) as T & { message?: string };

  if (!response.ok) {
    throw new Error(data.message ?? "Beklenmeyen bir hata olustu.");
  }

  return data;
}

function exitReasonLabel(reason: BacktestResponse["trades"][number]["exitReason"]) {
  switch (reason) {
    case "signal_exit":
      return "Sinyal cikis";
    case "stop_loss":
      return "Stop-loss";
    case "take_profit":
      return "Take-profit";
    case "trailing_stop":
      return "Trailing stop";
    case "end_of_test":
      return "Donem sonu";
    default:
      return reason;
  }
}

export function BacktestPanel({
  preferredSymbol,
  symbolOptions,
}: BacktestPanelProps) {
  const [form, setForm] = useState<BacktestRequest>(() => createInitialForm(preferredSymbol));
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!preferredSymbol) {
      return;
    }

    setForm((current) =>
      current.symbol
        ? current
        : {
            ...current,
            symbol: preferredSymbol,
          },
    );
  }, [preferredSymbol]);

  function updateField<K extends keyof BacktestRequest>(key: K, value: BacktestRequest[K]) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function handleSubmit() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchJson<BacktestResponse>("/api/backtest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });

      setResult(response);
      setForm(response.input);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Backtest calistirilamadi.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={styles.backtestPanel}>
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.metaLabel}>Backtest lab</p>
          <h2 className={styles.sectionTitle}>Tarihsel strateji simulasyonu</h2>
        </div>
        <span className={styles.sectionNote}>
          Ayni sembolde max open positions limiti, eszamanli tranche sayisi olarak calisir.
        </span>
      </div>

      {error ? <div className={styles.errorBanner}>{error}</div> : null}

      <div className={styles.backtestLayout}>
        <div className={styles.backtestControls}>
          <div className={styles.formGrid}>
            <label className={styles.formField}>
              <span>Sembol</span>
              <input
                className={styles.formInput}
                list="backtest-symbols"
                value={form.symbol}
                onChange={(event) => updateField("symbol", event.target.value.toUpperCase())}
                placeholder="THYAO.IS"
              />
              <datalist id="backtest-symbols">
                {symbolOptions.map((option) => (
                  <option key={option.symbol} value={option.symbol}>
                    {option.displaySymbol} - {option.companyName}
                  </option>
                ))}
              </datalist>
            </label>

            <label className={styles.formField}>
              <span>Baslangic</span>
              <input
                className={styles.formInput}
                type="date"
                value={form.dateFrom}
                onChange={(event) => updateField("dateFrom", event.target.value)}
              />
            </label>

            <label className={styles.formField}>
              <span>Bitis</span>
              <input
                className={styles.formInput}
                type="date"
                value={form.dateTo}
                onChange={(event) => updateField("dateTo", event.target.value)}
              />
            </label>

            <label className={styles.formField}>
              <span>Strateji</span>
              <select
                className={styles.formInput}
                value={form.strategy}
                onChange={(event) =>
                  updateField("strategy", event.target.value as BacktestStrategyProfile)
                }
              >
                {STRATEGY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.formField}>
              <span>Baslangic sermayesi</span>
              <input
                className={styles.formInput}
                type="number"
                min="1"
                step="1000"
                value={form.initialCapital}
                onChange={(event) =>
                  updateField("initialCapital", Number(event.target.value || 0))
                }
              />
            </label>

            <label className={styles.formField}>
              <span>Max open positions</span>
              <input
                className={styles.formInput}
                type="number"
                min="1"
                max="10"
                step="1"
                value={form.maxOpenPositions}
                onChange={(event) =>
                  updateField("maxOpenPositions", Number(event.target.value || 0))
                }
              />
            </label>

            <label className={styles.formField}>
              <span>Pozisyon boyutlama</span>
              <select
                className={styles.formInput}
                value={form.positionSizing.mode}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    positionSizing: {
                      ...current.positionSizing,
                      mode: event.target.value as PositionSizingMode,
                    },
                  }))
                }
              >
                {POSITION_SIZING_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.formField}>
              <span>
                {form.positionSizing.mode === "fixed_amount"
                  ? "Tutar"
                  : form.positionSizing.mode === "risk_based"
                    ? "Risk %"
                    : "Equity %"}
              </span>
              <input
                className={styles.formInput}
                type="number"
                min="0.01"
                step="0.01"
                value={form.positionSizing.value}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    positionSizing: {
                      ...current.positionSizing,
                      value: Number(event.target.value || 0),
                    },
                  }))
                }
              />
            </label>

            <label className={styles.formField}>
              <span>Stop-loss %</span>
              <input
                className={styles.formInput}
                type="number"
                min="0"
                step="0.1"
                value={form.stopLossPercent}
                onChange={(event) =>
                  updateField("stopLossPercent", Number(event.target.value || 0))
                }
              />
            </label>

            <label className={styles.formField}>
              <span>Take-profit %</span>
              <input
                className={styles.formInput}
                type="number"
                min="0"
                step="0.1"
                value={form.takeProfitPercent}
                onChange={(event) =>
                  updateField("takeProfitPercent", Number(event.target.value || 0))
                }
              />
            </label>

            <label className={styles.formField}>
              <span>Trailing stop %</span>
              <input
                className={styles.formInput}
                type="number"
                min="0"
                step="0.1"
                value={form.trailingStopPercent}
                onChange={(event) =>
                  updateField("trailingStopPercent", Number(event.target.value || 0))
                }
              />
            </label>

            <label className={styles.formField}>
              <span>Komisyon %</span>
              <input
                className={styles.formInput}
                type="number"
                min="0"
                step="0.01"
                value={form.commissionPercent}
                onChange={(event) =>
                  updateField("commissionPercent", Number(event.target.value || 0))
                }
              />
            </label>

            <label className={styles.formField}>
              <span>Slippage %</span>
              <input
                className={styles.formInput}
                type="number"
                min="0"
                step="0.01"
                value={form.slippagePercent}
                onChange={(event) =>
                  updateField("slippagePercent", Number(event.target.value || 0))
                }
              />
            </label>
          </div>

          <div className={styles.formFooter}>
            <div className={styles.formHints}>
              <p className={styles.metaSubtle}>
                {STRATEGY_OPTIONS.find((option) => option.value === form.strategy)?.description}
              </p>
              <p className={styles.metaSubtle}>
                {
                  POSITION_SIZING_OPTIONS.find(
                    (option) => option.value === form.positionSizing.mode,
                  )?.hint
                }
              </p>
            </div>

            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => void handleSubmit()}
              disabled={loading}
            >
              {loading ? "Backtest calisiyor" : "Backtest calistir"}
            </button>
          </div>
        </div>

        <div className={styles.backtestResults}>
          {result ? (
            <>
              {result.warnings.length > 0 ? (
                <div className={styles.warningPanel}>
                  {result.warnings.map((warning) => (
                    <div key={warning} className={styles.warningItem}>
                      {warning}
                    </div>
                  ))}
                </div>
              ) : null}

              <div className={styles.backtestMetrics}>
                <article className={styles.metricPanel}>
                  <p className={styles.metaLabel}>Toplam getiri</p>
                  <div
                    className={`${styles.metricValue} ${
                      result.metrics.totalReturn >= 0 ? styles.positive : styles.negative
                    }`}
                  >
                    {formatPercent(result.metrics.totalReturn)}
                  </div>
                  <p className={styles.metaSubtle}>
                    Bitis equity:{" "}
                    {formatCurrency(result.metrics.endingEquity, result.currency)}
                  </p>
                </article>

                <article className={styles.metricPanel}>
                  <p className={styles.metaLabel}>CAGR / Win rate</p>
                  <div className={styles.metricValueSmall}>
                    {result.metrics.cagr !== null
                      ? formatPercent(result.metrics.cagr)
                      : "N/A"}
                  </div>
                  <p className={styles.metaSubtle}>
                    Win rate: {formatPercent(result.metrics.winRate)}
                  </p>
                </article>

                <article className={styles.metricPanel}>
                  <p className={styles.metaLabel}>Profit factor</p>
                  <div className={styles.metricValueSmall}>
                    {result.metrics.profitFactor !== null
                      ? formatNumber(result.metrics.profitFactor)
                      : "--"}
                  </div>
                  <p className={styles.metaSubtle}>
                    Max DD: -{formatPercent(result.metrics.maxDrawdown)}
                  </p>
                </article>

                <article className={styles.metricPanel}>
                  <p className={styles.metaLabel}>Trade / Exposure</p>
                  <div className={styles.metricValueSmall}>
                    {formatNumber(result.metrics.numberOfTrades, 0)}
                  </div>
                  <p className={styles.metaSubtle}>
                    Exposure: {formatPercent(result.metrics.exposure)}
                  </p>
                </article>
              </div>

              <div className={styles.metricStrip}>
                <div className={styles.metricStripItem}>
                  <span>Avg gain</span>
                  <strong className={styles.positive}>
                    {formatPercent(result.metrics.averageGain)}
                  </strong>
                </div>
                <div className={styles.metricStripItem}>
                  <span>Avg loss</span>
                  <strong className={styles.negative}>
                    {formatPercent(result.metrics.averageLoss)}
                  </strong>
                </div>
                <div className={styles.metricStripItem}>
                  <span>Sembol</span>
                  <strong>{result.displaySymbol}</strong>
                </div>
                <div className={styles.metricStripItem}>
                  <span>Donem</span>
                  <strong>
                    {result.dateFrom} / {result.dateTo}
                  </strong>
                </div>
              </div>

              <BacktestEquityCurve
                currency={result.currency}
                series={result.equityCurve}
              />

              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Giris</th>
                      <th>Cikis</th>
                      <th>Lot</th>
                      <th>Net P/L</th>
                      <th>Neden</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.length > 0 ? (
                      result.trades.map((trade) => (
                        <tr key={trade.id}>
                          <td>{formatDateTime(trade.entryDate)}</td>
                          <td>{formatDateTime(trade.exitDate)}</td>
                          <td>{formatNumber(trade.shares, 0)}</td>
                          <td className={trade.netPnl >= 0 ? styles.positive : styles.negative}>
                            {formatCurrency(trade.netPnl, result.currency)}
                          </td>
                          <td>{exitReasonLabel(trade.exitReason)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className={styles.emptyState}>
                          Bu parametrelerle islem olusmadi.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className={styles.emptyState}>
              Sembol ve parametreleri secip backtest calistirdiginda ozet metrikler ve
              equity curve burada gorunecek.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
