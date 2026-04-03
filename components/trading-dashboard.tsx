"use client";

import {
  type FormEvent,
  startTransition,
  useDeferredValue,
  useEffect,
  useState,
} from "react";

import { DEFAULT_SYMBOLS } from "@/lib/defaults";
import {
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import { suggestPositionPlan } from "@/lib/risk";
import type {
  DashboardResponse,
  MarketSnapshot,
  OrderResult,
  PortfolioResponse,
} from "@/lib/types";

import { PriceChart } from "./price-chart";
import styles from "./trading-dashboard.module.css";

const STORAGE_KEY = "atlas-paper-trader.watchlist";

function sanitizeSymbol(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function parseAmount(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return Number.NaN;
  }

  if (trimmed.includes(",")) {
    return Number(trimmed.replace(/\./g, "").replace(",", "."));
  }

  return Number(trimmed);
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, { cache: "no-store", ...init });
  const data = (await response.json()) as T & { message?: string };

  if (!response.ok) {
    throw new Error(data.message ?? "Beklenmeyen bir hata olustu.");
  }

  return data;
}

function toneClass(value: number) {
  if (value > 0) return styles.positive;
  if (value < 0) return styles.negative;
  return styles.neutral;
}

function signalClass(snapshot: MarketSnapshot) {
  if (snapshot.signal.action === "buy") return `${styles.signalPill} ${styles.signalBuy}`;
  if (snapshot.signal.action === "reduce") return `${styles.signalPill} ${styles.signalReduce}`;
  return `${styles.signalPill} ${styles.signalHold}`;
}

export function TradingDashboard() {
  const [watchlist, setWatchlist] = useState(DEFAULT_SYMBOLS);
  const [selectedSymbol, setSelectedSymbol] = useState(DEFAULT_SYMBOLS[0]);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [search, setSearch] = useState("");
  const [newSymbol, setNewSymbol] = useState("");
  const [tradeBudget, setTradeBudget] = useState("20000");
  const [resetCash, setResetCash] = useState("250000");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);

    if (!stored) {
      return;
    }

    try {
      const parsed = JSON.parse(stored) as string[];
      const cleaned = parsed.map(sanitizeSymbol).filter(Boolean);
      if (cleaned.length) {
        setWatchlist(cleaned);
        setSelectedSymbol(cleaned[0] ?? DEFAULT_SYMBOLS[0]);
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(watchlist));
  }, [watchlist]);

  useEffect(() => {
    let cancelled = false;

    async function runRefresh() {
      setLoading(true);

      try {
        const [dashboardData, portfolioData] = await Promise.all([
          fetchJson<DashboardResponse>(
            `/api/dashboard?symbols=${encodeURIComponent(watchlist.join(","))}`,
          ),
          fetchJson<PortfolioResponse>("/api/portfolio"),
        ]);

        if (cancelled) {
          return;
        }

        setDashboard(dashboardData);
        setPortfolio(portfolioData);
        setError(null);
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Veriler yuklenemedi.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void runRefresh();
    const intervalId = window.setInterval(() => void runRefresh(), 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [watchlist]);

  useEffect(() => {
    if (dashboard?.symbols.length && !dashboard.symbols.some((item) => item.symbol === selectedSymbol)) {
      setSelectedSymbol(dashboard.symbols[0]?.symbol ?? "");
    }
  }, [dashboard, selectedSymbol]);

  const filteredSymbols =
    dashboard?.symbols.filter((item) => {
      const term = deferredSearch.trim().toUpperCase();
      return !term || item.symbol.includes(term) || item.displaySymbol.includes(term);
    }) ?? [];

  const selectedSnapshot =
    dashboard?.symbols.find((item) => item.symbol === selectedSymbol) ??
    filteredSymbols[0] ??
    null;
  const selectedPosition =
    portfolio?.positions.find((item) => item.symbol === selectedSnapshot?.symbol) ?? null;
  const blocked =
    !portfolio || !selectedSnapshot || selectedSnapshot.currency !== portfolio.baseCurrency;
  const plan =
    portfolio && selectedSnapshot
      ? suggestPositionPlan({
          price: selectedSnapshot.price,
          atr14: selectedSnapshot.indicators.atr14,
          equity: portfolio.equity,
          cash: portfolio.cash,
        })
      : null;

  async function handleAddSymbol(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const symbol = sanitizeSymbol(newSymbol);

    if (!symbol) {
      setError("Eklemek icin bir sembol yaz.");
      return;
    }

    if (watchlist.includes(symbol)) {
      setSelectedSymbol(symbol);
      setNewSymbol("");
      return;
    }

    try {
      const preview = await fetchJson<DashboardResponse>(
        `/api/dashboard?symbols=${encodeURIComponent(symbol)}`,
      );

      if (!preview.symbols.length) {
        throw new Error(preview.errors[0]?.message ?? "Bu sembol bulunamadi.");
      }

      startTransition(() => {
        setWatchlist([symbol, ...watchlist].slice(0, 12));
        setSelectedSymbol(symbol);
        setNewSymbol("");
      });
      setFeedback(`${symbol} izleme listesine eklendi.`);
      setError(null);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Sembol eklenemedi.",
      );
    }
  }

  async function handleOrder(side: "buy" | "sell", sellAll = false) {
    if (!selectedSnapshot) {
      return;
    }

    const amount = parseAmount(tradeBudget);
    const shares = sellAll ? selectedPosition?.shares : undefined;

    if (!sellAll && (!Number.isFinite(amount) || amount <= 0)) {
      setError("Islem tutari gecerli degil.");
      return;
    }

    setSubmitting(true);

    try {
      const result = await fetchJson<OrderResult>("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: selectedSnapshot.symbol,
          side,
          dollars: sellAll ? undefined : amount,
          shares,
        }),
      });

      setPortfolio(result.portfolio);
      setFeedback(result.message);
      setError(null);
      const [dashboardData, portfolioData] = await Promise.all([
        fetchJson<DashboardResponse>(
          `/api/dashboard?symbols=${encodeURIComponent(watchlist.join(","))}`,
        ),
        fetchJson<PortfolioResponse>("/api/portfolio"),
      ]);
      setDashboard(dashboardData);
      setPortfolio(portfolioData);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Emir gonderilemedi.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReset() {
    const amount = parseAmount(resetCash);

    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Baslangic bakiyesi gecerli degil.");
      return;
    }

    setSubmitting(true);

    try {
      const result = await fetchJson<{ portfolio: PortfolioResponse; message: string }>(
        "/api/portfolio/reset",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startingCash: amount }),
        },
      );

      setPortfolio(result.portfolio);
      setFeedback(result.message);
      setError(null);
      const [dashboardData, portfolioData] = await Promise.all([
        fetchJson<DashboardResponse>(
          `/api/dashboard?symbols=${encodeURIComponent(watchlist.join(","))}`,
        ),
        fetchJson<PortfolioResponse>("/api/portfolio"),
      ]);
      setDashboard(dashboardData);
      setPortfolio(portfolioData);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Portfoy sifirlanamadi.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const benchmarkClass =
    dashboard?.benchmark.trend === "risk-on"
      ? styles.benchmarkPositive
      : dashboard?.benchmark.trend === "risk-off"
        ? styles.benchmarkNegative
        : styles.benchmarkNeutral;

  return (
    <main className={styles.shell}>
      <div className={styles.backdrop} />

      <section className={`${styles.panel} ${styles.masthead}`}>
        <div className={styles.mastheadCopy}>
          <p className={styles.eyebrow}>Atlas Paper Trader</p>
          <h1 className={styles.title}>Gercek veriyle analiz et, demo hesapta test et.</h1>
          <p className={styles.subtitle}>
            Bu uygulama kar garantisi vermez. Teknik analiz, risk planlamasi ve
            paper trading disiplinini tek ekranda toplar.
          </p>
          <div className={styles.actionRow}>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={async () => {
                setLoading(true);

                try {
                  const [dashboardData, portfolioData] = await Promise.all([
                    fetchJson<DashboardResponse>(
                      `/api/dashboard?symbols=${encodeURIComponent(watchlist.join(","))}`,
                    ),
                    fetchJson<PortfolioResponse>("/api/portfolio"),
                  ]);

                  setDashboard(dashboardData);
                  setPortfolio(portfolioData);
                  setError(null);
                } catch (caughtError) {
                  setError(
                    caughtError instanceof Error
                      ? caughtError.message
                      : "Veriler yuklenemedi.",
                  );
                } finally {
                  setLoading(false);
                }
              }}
            >
              {loading ? "Yenileniyor" : "Veriyi yenile"}
            </button>
            <span className={styles.status}>
              Son guncelleme: {dashboard ? formatDateTime(dashboard.generatedAt) : "Bekleniyor"}
            </span>
          </div>
        </div>

        <div className={`${styles.mastheadCard} ${benchmarkClass}`}>
          <p className={styles.sectionTag}>Piyasa rejimi</p>
          <div className={styles.contextScore}>
            {dashboard?.benchmark.score ?? "--"}
            <span>/100</span>
          </div>
          <h2 className={styles.contextTitle}>{dashboard?.benchmark.label ?? "Okunuyor"}</h2>
          <p className={styles.contextText}>
            {dashboard?.benchmark.summary ?? "BIST 100 tonu geldikce burada guncellenir."}
          </p>
        </div>
      </section>

      {feedback ? <div className={styles.successBanner}>{feedback}</div> : null}
      {error ? <div className={styles.errorBanner}>{error}</div> : null}

      <section className={styles.statsGrid}>
        <article className={`${styles.panel} ${styles.statCard}`}>
          <p className={styles.statLabel}>Demo ozkaynak</p>
          <div className={styles.statValue}>
            {portfolio ? formatCurrency(portfolio.equity, portfolio.baseCurrency) : "--"}
          </div>
        </article>
        <article className={`${styles.panel} ${styles.statCard}`}>
          <p className={styles.statLabel}>Nakit</p>
          <div className={styles.statValue}>
            {portfolio ? formatCurrency(portfolio.cash, portfolio.baseCurrency) : "--"}
          </div>
        </article>
        <article className={`${styles.panel} ${styles.statCard}`}>
          <p className={styles.statLabel}>Toplam P/L</p>
          <div className={`${styles.statValue} ${portfolio ? toneClass(portfolio.totalPnl) : ""}`}>
            {portfolio ? formatCurrency(portfolio.totalPnl, portfolio.baseCurrency) : "--"}
          </div>
        </article>
        <article className={`${styles.panel} ${styles.statCard}`}>
          <p className={styles.statLabel}>Acik risk</p>
          <div className={styles.statValue}>
            {portfolio ? formatPercent(portfolio.openExposure) : "--"}
          </div>
        </article>
      </section>

      <section className={styles.mainGrid}>
        <aside className={`${styles.panel} ${styles.column}`}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.sectionTag}>Izleme listesi</p>
              <h2 className={styles.panelTitle}>Semboller</h2>
            </div>
            <span className={styles.panelSubtitle}>{dashboard?.symbols.length ?? 0}</span>
          </div>

          <form className={styles.searchForm} onSubmit={handleAddSymbol}>
            <input className={styles.searchInput} value={newSymbol} onChange={(event) => setNewSymbol(event.target.value)} placeholder="THYAO.IS veya AAPL" />
            <button type="submit" className={styles.ghostButton}>Ekle</button>
          </form>

          <input className={styles.searchInput} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Listede ara" />

          <div className={styles.symbolList}>
            {filteredSymbols.map((snapshot) => (
              <button
                type="button"
                key={snapshot.symbol}
                className={`${styles.symbolRow} ${snapshot.symbol === selectedSnapshot?.symbol ? styles.symbolRowActive : ""}`}
                onClick={() => setSelectedSymbol(snapshot.symbol)}
              >
                <div className={styles.symbolRowTop}>
                  <div className={styles.symbolName}>{snapshot.displaySymbol}</div>
                  <span className={signalClass(snapshot)}>{snapshot.signal.label}</span>
                </div>
                <div className={styles.symbolRowBottom}>
                  <strong>{formatCurrency(snapshot.price, snapshot.currency)}</strong>
                  <span className={toneClass(snapshot.changePercent)}>{formatPercent(snapshot.changePercent)}</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className={`${styles.panel} ${styles.columnWide}`}>
          {selectedSnapshot ? (
            <>
              <div className={styles.heroHeader}>
                <div>
                  <p className={styles.sectionTag}>Secili sembol</p>
                  <h2 className={styles.panelTitle}>{selectedSnapshot.displaySymbol}</h2>
                  <p className={styles.panelSubtitle}>
                    {selectedSnapshot.exchange} | {selectedSnapshot.currency} | {formatDateTime(selectedSnapshot.marketTime)}
                  </p>
                </div>
                <div className={styles.scoreBubble}>
                  {selectedSnapshot.signal.score}
                  <span>/100</span>
                </div>
              </div>

              <PriceChart series={selectedSnapshot.series} currentPrice={selectedSnapshot.price} currency={selectedSnapshot.currency} />

              <div className={styles.metricGrid}>
                <article className={styles.metricCard}>
                  <p className={styles.metricLabel}>20 GHO</p>
                  <div className={styles.metricValue}>{selectedSnapshot.indicators.sma20 ? formatCurrency(selectedSnapshot.indicators.sma20, selectedSnapshot.currency) : "--"}</div>
                </article>
                <article className={styles.metricCard}>
                  <p className={styles.metricLabel}>50 GHO</p>
                  <div className={styles.metricValue}>{selectedSnapshot.indicators.sma50 ? formatCurrency(selectedSnapshot.indicators.sma50, selectedSnapshot.currency) : "--"}</div>
                </article>
                <article className={styles.metricCard}>
                  <p className={styles.metricLabel}>RSI 14</p>
                  <div className={styles.metricValue}>{selectedSnapshot.indicators.rsi14 ? formatNumber(selectedSnapshot.indicators.rsi14) : "--"}</div>
                </article>
                <article className={styles.metricCard}>
                  <p className={styles.metricLabel}>1A Momentum</p>
                  <div className={`${styles.metricValue} ${toneClass(selectedSnapshot.indicators.momentum21 ?? 0)}`}>{selectedSnapshot.indicators.momentum21 !== null ? formatPercent(selectedSnapshot.indicators.momentum21) : "--"}</div>
                </article>
              </div>

              <ul className={styles.thesisList}>
                {selectedSnapshot.signal.reasons.map((reason) => (
                  <li key={reason} className={styles.thesisItem}>{reason}</li>
                ))}
              </ul>
            </>
          ) : (
            <div className={styles.emptyState}>Soldan bir sembol sec.</div>
          )}
        </section>

        <aside className={`${styles.panel} ${styles.column}`}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.sectionTag}>Demo emir</p>
              <h2 className={styles.panelTitle}>Paper trading</h2>
            </div>
            <span className={styles.panelSubtitle}>{portfolio?.baseCurrency ?? "TRY"} hesap</span>
          </div>

          {selectedSnapshot ? (
            <>
              <div className={styles.orderHero}>
                <div className={styles.orderTicker}>{selectedSnapshot.symbol}</div>
                <div className={styles.orderPrice}>{formatCurrency(selectedSnapshot.price, selectedSnapshot.currency)}</div>
                <p className={styles.helperText}>
                  Son degisim: <span className={toneClass(selectedSnapshot.changePercent)}>{formatPercent(selectedSnapshot.changePercent)}</span>
                </p>
              </div>

              <label className={styles.inputLabel}>
                Islem tutari
                <input className={styles.orderInput} value={tradeBudget} onChange={(event) => setTradeBudget(event.target.value)} />
              </label>

              <div className={styles.orderButtons}>
                <button type="button" className={styles.primaryButton} disabled={submitting || blocked} onClick={() => void handleOrder("buy")}>Al</button>
                <button type="button" className={styles.ghostButton} disabled={submitting || blocked} onClick={() => void handleOrder("sell")}>Tutar kadar sat</button>
              </div>

              <button type="button" className={styles.fullWidthButton} disabled={submitting || !selectedPosition || blocked} onClick={() => void handleOrder("sell", true)}>Tum pozisyonu kapat</button>

              {blocked ? <p className={styles.disabledNote}>Bu demo hesap yalnizca {portfolio?.baseCurrency ?? "TRY"} bazli enstrumanlarla islem acar.</p> : null}
              {selectedPosition ? <p className={styles.helperText}>Acik pozisyon: {formatNumber(selectedPosition.shares, 4)} lot | Ortalama {formatCurrency(selectedPosition.averageCost, selectedPosition.currency)}</p> : null}

              {plan && portfolio ? (
                <div className={styles.metricStack}>
                  <div className={styles.metricRow}><span>Onerilen stop</span><strong>{formatCurrency(plan.stopLoss, portfolio.baseCurrency)}</strong></div>
                  <div className={styles.metricRow}><span>Risk butcesi</span><strong>{formatCurrency(plan.riskBudget, portfolio.baseCurrency)}</strong></div>
                  <div className={styles.metricRow}><span>Onerilen lot</span><strong>{formatNumber(plan.shares, 4)}</strong></div>
                </div>
              ) : null}

              <label className={styles.inputLabel}>
                Demo hesabi sifirla
                <input className={styles.orderInput} value={resetCash} onChange={(event) => setResetCash(event.target.value)} />
              </label>
              <button type="button" className={styles.fullWidthButton} disabled={submitting} onClick={() => void handleReset()}>Hesabi bastan kur</button>
            </>
          ) : (
            <div className={styles.emptyState}>Emir icin once bir sembol sec.</div>
          )}
        </aside>

        <article className={`${styles.panel} ${styles.columnWide}`}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.sectionTag}>Portfoy</p>
              <h2 className={styles.panelTitle}>Acik pozisyonlar</h2>
            </div>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Sembol</th><th>Lot</th><th>Ortalama</th><th>Fiyat</th><th>P/L</th></tr></thead>
              <tbody>
                {portfolio?.positions.length ? portfolio.positions.map((position) => (
                  <tr key={position.symbol}>
                    <td>{position.symbol}</td>
                    <td>{formatNumber(position.shares, 4)}</td>
                    <td>{formatCurrency(position.averageCost, position.currency)}</td>
                    <td>{formatCurrency(position.marketPrice, position.currency)}</td>
                    <td className={toneClass(position.unrealizedPnl)}>{formatCurrency(position.unrealizedPnl, position.currency)}</td>
                  </tr>
                )) : <tr><td colSpan={5} className={styles.emptyState}>Henuz acik pozisyon yok.</td></tr>}
              </tbody>
            </table>
          </div>
        </article>

        <article className={`${styles.panel} ${styles.column}`}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.sectionTag}>Gunluk</p>
              <h2 className={styles.panelTitle}>Son islemler</h2>
            </div>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Tarih</th><th>Taraf</th><th>Sembol</th><th>Tutar</th></tr></thead>
              <tbody>
                {portfolio?.trades.length ? portfolio.trades.map((trade) => (
                  <tr key={trade.id}>
                    <td>{formatDateTime(trade.executedAt)}</td>
                    <td className={trade.side === "buy" ? styles.tradeSideBuy : styles.tradeSideSell}>{trade.side === "buy" ? "AL" : "SAT"}</td>
                    <td>{trade.symbol}</td>
                    <td>{formatCurrency(trade.amount, trade.currency)}</td>
                  </tr>
                )) : <tr><td colSpan={4} className={styles.emptyState}>Henuz demo emir yok.</td></tr>}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </main>
  );
}
