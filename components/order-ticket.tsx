"use client";

import { useEffect, useState } from "react";

import { formatCurrency, formatNumber } from "@/lib/format";
import type {
  OrderPayload,
  OrderResult,
  OrderSimulationResult,
  PortfolioResponse,
  RecommendationCandidate,
  TradeJournalScope,
} from "@/lib/types";

import styles from "./market-lab.module.css";

type SizeMode = "shares" | "dollars";

interface OrderTicketProps {
  portfolio: PortfolioResponse | null;
  recommendation: RecommendationCandidate | null;
  onError: (message: string | null) => void;
  onFeedback: (message: string | null) => void;
  onJournalChange: () => void;
  onPortfolioChange: (portfolio: PortfolioResponse) => void;
}

interface OrderTicketFormState {
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit" | "stop" | "stop_limit";
  sizeMode: SizeMode;
  quantity: string;
  limitPrice: string;
  stopPrice: string;
  stopLoss: string;
  takeProfit: string;
}

interface JournalFormState {
  enabled: boolean;
  scope: TradeJournalScope;
  strategyTag: string;
  thesis: string;
  riskPlan: string;
  target: string;
  stop: string;
  confidence: string;
  tags: string;
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

function toFixedInput(value: number, digits = 2) {
  return value > 0 ? value.toFixed(digits) : "";
}

function createInitialForm(symbol = ""): OrderTicketFormState {
  return {
    symbol,
    side: "buy",
    type: "market",
    sizeMode: "shares",
    quantity: "",
    limitPrice: "",
    stopPrice: "",
    stopLoss: "",
    takeProfit: "",
  };
}

function createInitialJournalForm(): JournalFormState {
  return {
    enabled: false,
    scope: "trade",
    strategyTag: "",
    thesis: "",
    riskPlan: "",
    target: "",
    stop: "",
    confidence: "60",
    tags: "",
  };
}

export function OrderTicket({
  portfolio,
  recommendation,
  onError,
  onFeedback,
  onJournalChange,
  onPortfolioChange,
}: OrderTicketProps) {
  const [form, setForm] = useState<OrderTicketFormState>(() =>
    createInitialForm(recommendation?.symbol ?? ""),
  );
  const [journal, setJournal] = useState<JournalFormState>(() => createInitialJournalForm());
  const [placingOrder, setPlacingOrder] = useState(false);
  const [simulating, setSimulating] = useState(false);

  useEffect(() => {
    if (!recommendation) {
      return;
    }

    setForm((current) => ({
      ...current,
      symbol: recommendation.symbol,
      quantity:
        current.symbol !== recommendation.symbol
          ? String(Math.max(Math.floor(recommendation.suggestedShares), 1))
          : current.quantity,
      stopLoss:
        current.symbol !== recommendation.symbol
          ? toFixedInput(recommendation.stopLoss)
          : current.stopLoss,
      takeProfit:
        current.symbol !== recommendation.symbol
          ? toFixedInput(recommendation.price * 1.1)
          : current.takeProfit,
      limitPrice:
        current.symbol !== recommendation.symbol ? toFixedInput(recommendation.price) : current.limitPrice,
      stopPrice:
        current.symbol !== recommendation.symbol ? toFixedInput(recommendation.price) : current.stopPrice,
    }));

    setJournal((current) =>
      current.strategyTag || current.thesis || current.riskPlan || current.enabled
        ? current
        : {
            ...current,
            strategyTag: "rank-score",
            thesis: recommendation.thesis[0] ?? "",
            riskPlan: `Risk butcesi ${formatCurrency(
              recommendation.riskBudget,
              recommendation.currency,
            )}, stop ${toFixedInput(recommendation.stopLoss)}.`,
            target: toFixedInput(recommendation.price * 1.1),
            stop: toFixedInput(recommendation.stopLoss),
            tags: "scanner",
          },
    );
  }, [recommendation]);

  const symbol = form.symbol.trim().toUpperCase();
  const position = portfolio?.positions.find((item) => item.symbol === symbol) ?? null;

  function updateField<K extends keyof OrderTicketFormState>(
    key: K,
    value: OrderTicketFormState[K],
  ) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function updateJournalField<K extends keyof JournalFormState>(
    key: K,
    value: JournalFormState[K],
  ) {
    setJournal((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function handlePlaceOrder() {
    if (!symbol) {
      onError("Islem icin sembol secilmedi.");
      return;
    }

    const quantity = Number(form.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      onError("Gecerli lot veya tutar girilmeli.");
      return;
    }

    const payload: OrderPayload = {
      symbol,
      side: form.side,
      type: form.type,
      note: "Order ticket",
    };

    if (form.sizeMode === "shares") {
      payload.shares = quantity;
    } else {
      payload.dollars = quantity;
    }

    if (form.type === "limit" || form.type === "stop_limit") {
      payload.limitPrice = Number(form.limitPrice);
    }

    if (form.type === "stop" || form.type === "stop_limit") {
      payload.stopPrice = Number(form.stopPrice);
    }

    if (form.side === "buy") {
      const stopLoss = Number(form.stopLoss);
      const takeProfit = Number(form.takeProfit);

      if ((Number.isFinite(stopLoss) && stopLoss > 0) || (Number.isFinite(takeProfit) && takeProfit > 0)) {
        payload.bracket = {};

        if (Number.isFinite(stopLoss) && stopLoss > 0) {
          payload.bracket.stopLoss = stopLoss;
        }

        if (Number.isFinite(takeProfit) && takeProfit > 0) {
          payload.bracket.takeProfit = takeProfit;
        }
      }
    }

    if (journal.enabled) {
      payload.journal = {
        scope: journal.scope,
        strategyTag: journal.strategyTag,
        thesis: journal.thesis,
        riskPlan: journal.riskPlan,
        target: Number(journal.target) || undefined,
        stop: Number(journal.stop) || undefined,
        confidence: Number(journal.confidence) || undefined,
        tags: journal.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      };
    }

    setPlacingOrder(true);
    onError(null);
    onFeedback(null);

    try {
      const result = await fetchJson<OrderResult>("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      onPortfolioChange(result.portfolio);
      if (result.journal) {
        onJournalChange();
      }

      if (result.order.status === "rejected") {
        onError(result.message);
      } else {
        onFeedback(result.journal ? `${result.message} Journal kaydi olusturuldu.` : result.message);
      }
    } catch (caughtError) {
      onError(
        caughtError instanceof Error ? caughtError.message : "Emir gonderilemedi.",
      );
    } finally {
      setPlacingOrder(false);
    }
  }

  async function handleSimulate() {
    setSimulating(true);
    onError(null);
    onFeedback(null);

    try {
      const result = await fetchJson<OrderSimulationResult>("/api/orders/simulate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(symbol ? { symbol } : {}),
      });

      onPortfolioChange(result.portfolio);
      onFeedback(result.message);
    } catch (caughtError) {
      onError(
        caughtError instanceof Error
          ? caughtError.message
          : "Bekleyen emirler simule edilemedi.",
      );
    } finally {
      setSimulating(false);
    }
  }

  return (
    <div className={styles.ticketPanel}>
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.metaLabel}>Order ticket</p>
          <h3 className={styles.sectionTitle}>
            {recommendation ? `${recommendation.displaySymbol} icin emir` : "Manuel emir gir"}
          </h3>
        </div>
        <span className={styles.sectionNote}>
          Market, limit, stop ve stop-limit desteklenir.
        </span>
      </div>

      <div className={styles.formGrid}>
        <label className={styles.formField}>
          <span>Sembol</span>
          <input
            className={styles.formInput}
            value={form.symbol}
            onChange={(event) => updateField("symbol", event.target.value.toUpperCase())}
            placeholder="THYAO.IS"
          />
        </label>

        <label className={styles.formField}>
          <span>Taraf</span>
          <select
            className={styles.formInput}
            value={form.side}
            onChange={(event) => updateField("side", event.target.value as "buy" | "sell")}
          >
            <option value="buy">AL</option>
            <option value="sell">SAT</option>
          </select>
        </label>

        <label className={styles.formField}>
          <span>Emir tipi</span>
          <select
            className={styles.formInput}
            value={form.type}
            onChange={(event) =>
              updateField(
                "type",
                event.target.value as "market" | "limit" | "stop" | "stop_limit",
              )
            }
          >
            <option value="market">Market</option>
            <option value="limit">Limit</option>
            <option value="stop">Stop</option>
            <option value="stop_limit">Stop-limit</option>
          </select>
        </label>

        <label className={styles.formField}>
          <span>Boyut modu</span>
          <select
            className={styles.formInput}
            value={form.sizeMode}
            onChange={(event) => updateField("sizeMode", event.target.value as SizeMode)}
          >
            <option value="shares">Lot</option>
            <option value="dollars">Tutar</option>
          </select>
        </label>

        <label className={styles.formField}>
          <span>{form.sizeMode === "shares" ? "Lot" : "Tutar"}</span>
          <input
            className={styles.formInput}
            type="number"
            min="0.01"
            step="0.01"
            value={form.quantity}
            onChange={(event) => updateField("quantity", event.target.value)}
          />
        </label>

        {(form.type === "limit" || form.type === "stop_limit") && (
          <label className={styles.formField}>
            <span>Limit fiyat</span>
            <input
              className={styles.formInput}
              type="number"
              min="0.01"
              step="0.01"
              value={form.limitPrice}
              onChange={(event) => updateField("limitPrice", event.target.value)}
            />
          </label>
        )}

        {(form.type === "stop" || form.type === "stop_limit") && (
          <label className={styles.formField}>
            <span>Stop fiyat</span>
            <input
              className={styles.formInput}
              type="number"
              min="0.01"
              step="0.01"
              value={form.stopPrice}
              onChange={(event) => updateField("stopPrice", event.target.value)}
            />
          </label>
        )}

        {form.side === "buy" && (
          <>
            <label className={styles.formField}>
              <span>Bracket stop-loss</span>
              <input
                className={styles.formInput}
                type="number"
                min="0.01"
                step="0.01"
                value={form.stopLoss}
                onChange={(event) => updateField("stopLoss", event.target.value)}
                placeholder="Opsiyonel"
              />
            </label>

            <label className={styles.formField}>
              <span>Bracket take-profit</span>
              <input
                className={styles.formInput}
                type="number"
                min="0.01"
                step="0.01"
                value={form.takeProfit}
                onChange={(event) => updateField("takeProfit", event.target.value)}
                placeholder="Opsiyonel"
              />
            </label>
          </>
        )}
      </div>

      <div className={styles.metricStrip}>
        <div className={styles.metricStripItem}>
          <span>Secili fiyat</span>
          <strong>
            {recommendation
              ? formatCurrency(recommendation.price, recommendation.currency)
              : "--"}
          </strong>
        </div>
        <div className={styles.metricStripItem}>
          <span>Nakit</span>
          <strong>
            {portfolio ? formatCurrency(portfolio.cash, portfolio.baseCurrency) : "--"}
          </strong>
        </div>
        <div className={styles.metricStripItem}>
          <span>Kullanilabilir lot</span>
          <strong>{position ? formatNumber(position.availableShares, 4) : "--"}</strong>
        </div>
      </div>

      <div className={styles.journalComposer}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.metaLabel}>Trade journal</p>
            <h3 className={styles.sectionTitle}>Giris planini kaydet</h3>
          </div>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => updateJournalField("enabled", !journal.enabled)}
          >
            {journal.enabled ? "Journal kapat" : "Journal ekle"}
          </button>
        </div>

        {journal.enabled ? (
          <div className={styles.formGrid}>
            <label className={styles.formField}>
              <span>Kapsam</span>
              <select
                className={styles.formInput}
                value={journal.scope}
                onChange={(event) =>
                  updateJournalField("scope", event.target.value as TradeJournalScope)
                }
              >
                <option value="trade">Trade</option>
                <option value="position">Position</option>
              </select>
            </label>

            <label className={styles.formField}>
              <span>Strategy etiketi</span>
              <input
                className={styles.formInput}
                value={journal.strategyTag}
                onChange={(event) => updateJournalField("strategyTag", event.target.value)}
                placeholder="rank-score"
              />
            </label>

            <label className={`${styles.formField} ${styles.formFieldWide}`}>
              <span>Thesis</span>
              <textarea
                className={`${styles.formInput} ${styles.formTextarea}`}
                value={journal.thesis}
                onChange={(event) => updateJournalField("thesis", event.target.value)}
                placeholder="Neden bu islemi aciyorum?"
              />
            </label>

            <label className={`${styles.formField} ${styles.formFieldWide}`}>
              <span>Risk plani</span>
              <textarea
                className={`${styles.formInput} ${styles.formTextarea}`}
                value={journal.riskPlan}
                onChange={(event) => updateJournalField("riskPlan", event.target.value)}
                placeholder="Stop, pozisyon boyutu, iptal kosulu"
              />
            </label>

            <label className={styles.formField}>
              <span>Target</span>
              <input
                className={styles.formInput}
                type="number"
                min="0.01"
                step="0.01"
                value={journal.target}
                onChange={(event) => updateJournalField("target", event.target.value)}
              />
            </label>

            <label className={styles.formField}>
              <span>Stop</span>
              <input
                className={styles.formInput}
                type="number"
                min="0.01"
                step="0.01"
                value={journal.stop}
                onChange={(event) => updateJournalField("stop", event.target.value)}
              />
            </label>

            <label className={styles.formField}>
              <span>Confidence</span>
              <input
                className={styles.formInput}
                type="number"
                min="0"
                max="100"
                step="1"
                value={journal.confidence}
                onChange={(event) => updateJournalField("confidence", event.target.value)}
              />
            </label>

            <label className={styles.formField}>
              <span>Tags</span>
              <input
                className={styles.formInput}
                value={journal.tags}
                onChange={(event) => updateJournalField("tags", event.target.value)}
                placeholder="scanner, breakout"
              />
            </label>
          </div>
        ) : (
          <div className={styles.metaSubtle}>
            Dilersen bu emre strategy etiketi, thesis ve risk plan ekleyip sonraki incelemelerde
            trade kalitesini olcebilecegin bir journal kaydi olusturabilirsin.
          </div>
        )}
      </div>

      <div className={styles.actionRow}>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => void handlePlaceOrder()}
          disabled={placingOrder}
        >
          {placingOrder ? "Emir gonderiliyor" : "Emir gonder"}
        </button>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => void handleSimulate()}
          disabled={simulating}
        >
          {simulating ? "Simulasyon calisiyor" : "Bekleyenleri simule et"}
        </button>
      </div>
    </div>
  );
}
