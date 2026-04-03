"use client";

import { type ChangeEvent, startTransition, useEffect, useState } from "react";

import {
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import type {
  AlertListResponse,
  BulkOrderResult,
  EventRiskLevel,
  OrderRecord,
  PortfolioAnalyticsResponse,
  PortfolioResponse,
  RecommendationCandidate,
  ScannerResponse,
  StockDetailResponse,
  StrategyProfileId,
} from "@/lib/types";

import { AlertCenterPanel } from "./alert-center-panel";
import { BacktestPanel } from "./backtest-panel";
import { MarketPriceChart } from "./market-price-chart";
import { OrderTicket } from "./order-ticket";
import { PortfolioAnalyticsPanel } from "./portfolio-analytics-panel";
import { StockEventPanel } from "./stock-event-panel";
import { StrategyLabPanel } from "./strategy-lab-panel";
import { TradeJournalPanel } from "./trade-journal-panel";
import styles from "./market-lab.module.css";

interface CartLine {
  symbol: string;
  displaySymbol: string;
  companyName: string;
  currency: string;
  price: number;
  shares: number;
  rankScore: number;
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

function toneClass(value: number) {
  if (value > 0) {
    return styles.positive;
  }

  if (value < 0) {
    return styles.negative;
  }

  return styles.neutral;
}

function orderStatusLabel(status: OrderRecord["status"]) {
  switch (status) {
    case "pending":
      return "Bekliyor";
    case "filled":
      return "Doldu";
    case "partially_filled":
      return "Kismi";
    case "cancelled":
      return "Iptal";
    case "rejected":
      return "Red";
    default:
      return status;
  }
}

function orderStatusClass(status: OrderRecord["status"]) {
  if (status === "filled") {
    return styles.statusFilled;
  }

  if (status === "partially_filled") {
    return styles.statusPartial;
  }

  if (status === "cancelled") {
    return styles.statusCancelled;
  }

  if (status === "rejected") {
    return styles.statusRejected;
  }

  return styles.statusPending;
}

function statusLabel(scanner: ScannerResponse | null) {
  if (!scanner) {
    return "Yukleniyor";
  }

  if (scanner.status.state === "running") {
    return scanner.status.stale ? "Taraniyor (son veri gosteriliyor)" : "Taraniyor";
  }

  return "Hazir";
}

function toCartLine(item: RecommendationCandidate): CartLine {
  return {
    symbol: item.symbol,
    displaySymbol: item.displaySymbol,
    companyName: item.companyName,
    currency: item.currency,
    price: item.price,
    shares: item.suggestedShares,
    rankScore: item.eventAdjustedRankScore,
  };
}

function eventRiskLabel(riskLevel: EventRiskLevel) {
  switch (riskLevel) {
    case "high":
      return "Yuksek risk";
    case "medium":
      return "Orta risk";
    case "low":
    default:
      return "Dusuk risk";
  }
}

function eventRiskClass(riskLevel: EventRiskLevel) {
  if (riskLevel === "high") {
    return styles.eventRiskHigh;
  }

  if (riskLevel === "medium") {
    return styles.eventRiskMedium;
  }

  return styles.eventRiskLow;
}

export function MarketLab() {
  const [scanner, setScanner] = useState<ScannerResponse | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [analytics, setAnalytics] = useState<PortfolioAnalyticsResponse | null>(null);
  const [alerts, setAlerts] = useState<AlertListResponse | null>(null);
  const [stockDetail, setStockDetail] = useState<StockDetailResponse | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [selectedStrategy, setSelectedStrategy] =
    useState<StrategyProfileId>("rank-score");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [analyticsReloadKey, setAnalyticsReloadKey] = useState(0);
  const [alertsReloadKey, setAlertsReloadKey] = useState(0);
  const [journalReloadKey, setJournalReloadKey] = useState(0);
  const [forceScannerRefresh, setForceScannerRefresh] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const scannerParams = new URLSearchParams({
          strategy: selectedStrategy,
        });

        if (forceScannerRefresh) {
          scannerParams.set("refresh", "1");
        }

        const [scannerData, portfolioData] = await Promise.all([
          fetchJson<ScannerResponse>(`/api/scanner?${scannerParams.toString()}`),
          fetchJson<PortfolioResponse>("/api/portfolio"),
        ]);

        if (cancelled) {
          return;
        }

        setScanner(scannerData);
        setPortfolio(portfolioData);
        setError(null);
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Tarama verileri yuklenemedi.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setForceScannerRefresh(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [reloadKey, forceScannerRefresh, selectedStrategy]);

  useEffect(() => {
    let cancelled = false;

    async function loadAnalytics() {
      try {
        setAnalyticsLoading(true);

        const analyticsData = await fetchJson<PortfolioAnalyticsResponse>(
          "/api/portfolio/analytics",
        );

        if (cancelled) {
          return;
        }

        setAnalytics(analyticsData);
        setAnalyticsError(null);
      } catch (caughtError) {
        if (!cancelled) {
          setAnalyticsError(
            caughtError instanceof Error
              ? caughtError.message
              : "Portfoy analytics verisi yuklenemedi.",
          );
        }
      } finally {
        if (!cancelled) {
          setAnalyticsLoading(false);
        }
      }
    }

    void loadAnalytics();

    return () => {
      cancelled = true;
    };
  }, [analyticsReloadKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadAlerts() {
      try {
        setAlertsLoading(true);

        const alertData = await fetchJson<AlertListResponse>("/api/alerts");

        if (cancelled) {
          return;
        }

        setAlerts(alertData);
        setAlertsError(null);
      } catch (caughtError) {
        if (!cancelled) {
          setAlertsError(
            caughtError instanceof Error
              ? caughtError.message
              : "Alarm verileri yuklenemedi.",
          );
        }
      } finally {
        if (!cancelled) {
          setAlertsLoading(false);
        }
      }
    }

    void loadAlerts();

    return () => {
      cancelled = true;
    };
  }, [alertsReloadKey]);

  useEffect(() => {
    if (scanner?.status.state !== "running") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setReloadKey((value) => value + 1);
    }, 4_000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [scanner?.status.state, scanner?.status.stale]);

  useEffect(() => {
    const recommendations = scanner?.recommendations ?? [];

    if (recommendations.length === 0) {
      return;
    }

    if (!recommendations.some((item) => item.symbol === selectedSymbol)) {
      setSelectedSymbol(recommendations[0]?.symbol ?? "");
    }
  }, [scanner, selectedSymbol]);

  useEffect(() => {
    const recommendations = scanner?.recommendations ?? [];

    if (recommendations.length === 0) {
      return;
    }

    setCart((current) =>
      current
        .map((item) => {
          const latest = recommendations.find((candidate) => candidate.symbol === item.symbol);

          if (!latest) {
            return item;
          }

          return {
            ...item,
            price: latest.price,
            companyName: latest.companyName,
            displaySymbol: latest.displaySymbol,
            currency: latest.currency,
          };
        })
        .filter((item) => item.shares > 0),
    );
  }, [scanner]);

  const recommendations = scanner?.recommendations ?? [];
  const selectedRecommendation =
    recommendations.find((item) => item.symbol === selectedSymbol) ?? null;
  const selectedDetailSymbol = selectedRecommendation?.symbol ?? "";
  const detailIntelligence =
    stockDetail && stockDetail.snapshot.symbol === selectedRecommendation?.symbol
      ? stockDetail.eventIntelligence
      : (selectedRecommendation?.eventIntelligence ?? null);
  const symbolOptions = recommendations.map((item) => ({
    symbol: item.symbol,
    displaySymbol: item.displaySymbol,
    companyName: item.companyName,
  }));
  const cartTotal = cart.reduce((total, item) => total + item.shares * item.price, 0);
  const cartTotalShares = cart.reduce((total, item) => total + item.shares, 0);

  function handleRefresh(force = false, clearFeedback = true) {
    if (clearFeedback) {
      setFeedback(null);
    }

    if (force) {
      setForceScannerRefresh(true);
    }
    setReloadKey((value) => value + 1);
    setAnalyticsReloadKey((value) => value + 1);
    setAlertsReloadKey((value) => value + 1);
    setJournalReloadKey((value) => value + 1);
  }

  function handlePortfolioChange(nextPortfolio: PortfolioResponse) {
    setPortfolio(nextPortfolio);
    setAnalyticsReloadKey((value) => value + 1);
    setJournalReloadKey((value) => value + 1);
  }

  function handleJournalChange() {
    setJournalReloadKey((value) => value + 1);
  }

  function handleAlertsChange() {
    setAlertsReloadKey((value) => value + 1);
  }

  function handleToggleCart(item: RecommendationCandidate) {
    setCart((current) => {
      const exists = current.some((entry) => entry.symbol === item.symbol);

      if (exists) {
        return current.filter((entry) => entry.symbol !== item.symbol);
      }

      return [...current, toCartLine(item)];
    });
  }

  function handleAddAll() {
    startTransition(() => {
      setCart((current) => {
        const map = new Map(current.map((item) => [item.symbol, item]));

        recommendations.forEach((item) => {
          if (item.suggestedShares > 0) {
            map.set(item.symbol, toCartLine(item));
          }
        });

        return [...map.values()];
      });
    });
  }

  function handleRemoveFromCart(symbol: string) {
    setCart((current) => current.filter((item) => item.symbol !== symbol));
  }

  function handleQuantityChange(symbol: string, event: ChangeEvent<HTMLInputElement>) {
    const nextShares = Math.max(Math.floor(Number(event.target.value || 0)), 0);

    setCart((current) =>
      current
        .map((item) => {
          if (item.symbol !== symbol) {
            return item;
          }

          return {
            ...item,
            shares: nextShares,
          };
        })
        .filter((item) => item.shares > 0),
    );
  }

  async function handleCheckout() {
    if (cart.length === 0) {
      setError("Sepette satin alinacak hisse yok.");
      return;
    }

    setSubmitting(true);

    try {
      const result = await fetchJson<BulkOrderResult>("/api/orders/bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: cart.map((item) => ({
            symbol: item.symbol,
            shares: item.shares,
          })),
        }),
      });

      handlePortfolioChange(result.portfolio);
      setCart([]);
      setFeedback(result.message);
      setError(null);
      handleRefresh(false, false);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Sepet satin alinirken hata olustu.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (!selectedDetailSymbol) {
      setStockDetail(null);
      setDetailError(null);
      return;
    }

    let cancelled = false;

    async function loadDetail() {
      try {
        setDetailLoading(true);
        setStockDetail(null);
        const detail = await fetchJson<StockDetailResponse>(
          `/api/stocks/${encodeURIComponent(selectedDetailSymbol)}`,
        );

        if (cancelled) {
          return;
        }

        setStockDetail(detail);
        setDetailError(null);
      } catch (caughtError) {
        if (!cancelled) {
          setDetailError(
            caughtError instanceof Error
              ? caughtError.message
              : "Event odakli hisse detayi yuklenemedi.",
          );
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    }

    void loadDetail();

    return () => {
      cancelled = true;
    };
  }, [selectedDetailSymbol]);

  const benchmarkTone =
    scanner?.benchmark?.trend === "risk-on"
      ? styles.marketGood
      : scanner?.benchmark?.trend === "risk-off"
        ? styles.marketCareful
        : styles.marketNeutral;

  return (
    <main className={styles.shell}>
      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <p className={styles.kicker}>Atlas Market Lab</p>
          <h1 className={styles.heroTitle}>
            Tum BIST hisselerini tara, en yuksek skorlu firsatlari sepetle.
          </h1>
          <p className={styles.heroText}>
            KAP uzerinden guncel BIST sirket evreni alinir, gercek piyasa verisiyle
            teknik puanlama yapilir ve demo para icin risk ayarli alis onerisi uretilir.
            Bu ekran maksimum kar garantisi vermez; amaci daha disiplinli secim yaptirmaktir.
          </p>

          <div className={styles.heroPulseRow}>
            <span className={styles.heroPulseItem}>
              Strateji: {scanner?.strategy.activeLabel ?? "Rank Score"}
            </span>
            <span className={styles.heroPulseItem}>
              Top liste: {scanner?.topSymbols.slice(0, 3).join(" / ") || "Hazirlaniyor"}
            </span>
            <span className={styles.heroPulseItem}>
              Veri kalitesi: {scanner ? `${scanner.failedCount} fail / ${scanner.analyzedCount} ok` : "Taraniyor"}
            </span>
          </div>

          <div className={styles.heroActions}>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => handleRefresh(true)}
              disabled={loading}
            >
              {loading ? "Tarama calisiyor" : "Tarama yenile"}
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={handleAddAll}
              disabled={recommendations.length === 0}
            >
              Onerilenlerin hepsini sepete ekle
            </button>
          </div>
        </div>

        <div className={`${styles.marketCard} ${benchmarkTone}`}>
          <div className={styles.marketCardTop}>
            <p className={styles.metaLabel}>Piyasa rejimi</p>
            <span className={styles.liveBadge}>{statusLabel(scanner)}</span>
          </div>
          <div className={styles.marketScore}>
            {scanner?.benchmark?.score ?? "--"}
            <span>/100</span>
          </div>
          <h2 className={styles.marketTitle}>
            {scanner?.benchmark?.label ?? "BIST taramasi hazirlaniyor"}
          </h2>
          <p className={styles.marketText}>
            {scanner?.benchmark?.summary ??
              "Tarama bitince genel piyasa tonu ve risk seviyesi burada gorunecek."}
          </p>
        </div>
      </section>

      {feedback ? <div className={styles.successBanner}>{feedback}</div> : null}
      {error ? <div className={styles.errorBanner}>{error}</div> : null}

      <section className={styles.metricsRow}>
        <article className={styles.metricPanel}>
          <p className={styles.metaLabel}>Taranan evren</p>
          <div className={styles.metricValue}>
            {scanner ? formatNumber(scanner.universeCount, 0) : "--"}
          </div>
          <p className={styles.metaSubtle}>KAP BIST sirketleri</p>
        </article>
        <article className={styles.metricPanel}>
          <p className={styles.metaLabel}>Basarili analiz</p>
          <div className={styles.metricValue}>
            {scanner ? formatNumber(scanner.analyzedCount, 0) : "--"}
          </div>
          <p className={styles.metaSubtle}>
            Hata: {scanner ? formatNumber(scanner.failedCount, 0) : "--"}
          </p>
        </article>
        <article className={styles.metricPanel}>
          <p className={styles.metaLabel}>Demo ozkaynak</p>
          <div className={styles.metricValue}>
            {portfolio ? formatCurrency(portfolio.equity, portfolio.baseCurrency) : "--"}
          </div>
          <p className={styles.metaSubtle}>
            Nakit: {portfolio ? formatCurrency(portfolio.cash, portfolio.baseCurrency) : "--"}
          </p>
        </article>
        <article className={styles.metricPanel}>
          <p className={styles.metaLabel}>Son tarama</p>
          <div className={styles.metricValueSmall}>
            {scanner?.generatedAt ? formatDateTime(scanner.generatedAt) : "Bekleniyor"}
          </div>
          <p className={styles.metaSubtle}>{scanner?.universeLabel ?? "BIST Tum Hisseler"}</p>
        </article>
      </section>

      <StrategyLabPanel
        scanner={scanner}
        recommendations={recommendations}
        selectedStrategy={selectedStrategy}
        onStrategyChange={(strategy) => {
          setSelectedStrategy(strategy);
          setFeedback(null);
          setError(null);
        }}
      />

      <section className={styles.recommendationSection}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.metaLabel}>Oneri panosu</p>
            <h2 className={styles.sectionTitle}>En yuksek skorlu alis adaylari</h2>
          </div>
          <span className={styles.sectionNote}>
            {scanner?.status.state === "running"
              ? "Tum evren arka planda tekrar taraniyor."
              : "Risk ayarli tutarlar mevcut nakde gore hesaplandi."}
          </span>
        </div>

        <div className={styles.recommendationLayout}>
          <div className={styles.cardGrid}>
            {recommendations.length > 0 ? (
              recommendations.map((item) => {
                const inCart = cart.some((entry) => entry.symbol === item.symbol);

                return (
                  <article
                    key={item.symbol}
                    className={`${styles.stockCard} ${
                      item.symbol === selectedRecommendation?.symbol
                        ? styles.stockCardActive
                        : ""
                    }`}
                  >
                    <button
                      type="button"
                      className={styles.cardSelect}
                      onClick={() => setSelectedSymbol(item.symbol)}
                    >
                      <div className={styles.cardHeader}>
                        <div>
                          <p className={styles.cardTicker}>{item.displaySymbol}</p>
                          <h3 className={styles.cardCompany}>{item.companyName}</h3>
                        </div>
                        <div className={styles.cardScore}>
                          {formatNumber(item.eventAdjustedRankScore)}
                          <span>rank</span>
                        </div>
                      </div>

                      <div className={styles.cardStats}>
                        <span>{formatCurrency(item.price, item.currency)}</span>
                        <span className={toneClass(item.changePercent)}>
                          {formatPercent(item.changePercent)}
                        </span>
                      </div>

                      <div className={styles.cardRecommendation}>
                        <div>
                          <p className={styles.metaLabel}>Onerilen tutar</p>
                          <strong>
                            {formatCurrency(item.suggestedAmount, item.currency)}
                          </strong>
                        </div>
                        <div>
                          <p className={styles.metaLabel}>Onerilen lot</p>
                          <strong>{formatNumber(item.suggestedShares, 0)}</strong>
                        </div>
                      </div>

                      <div className={styles.cardMetaRow}>
                        <span className={styles.pill}>{item.signal.label}</span>
                        <span className={styles.journalTag}>{item.strategyLabel}</span>
                        <span className={styles.metaSubtle}>
                          Stop: {formatCurrency(item.stopLoss, item.currency)}
                        </span>
                      </div>

                      <div className={styles.eventSummaryCard}>
                        <div className={styles.eventSummaryHeader}>
                          <span
                            className={`${styles.eventRiskPill} ${eventRiskClass(
                              item.eventIntelligence.eventRiskLevel,
                            )}`}
                          >
                            {eventRiskLabel(item.eventIntelligence.eventRiskLevel)}
                          </span>
                          <span className={styles.metaSubtle}>
                            {item.eventIntelligence.eventPenalty < 0
                              ? `Event cezasi: ${formatNumber(
                                  item.eventIntelligence.eventPenalty,
                                )}`
                              : `Teknik skor: ${formatNumber(item.rankScore)}`}
                          </span>
                        </div>
                        <div className={styles.eventSummaryText}>
                          {item.eventIntelligence.summary}
                        </div>
                      </div>

                      <div className={styles.scoreSummary}>
                        {item.scoreBreakdown.summary}
                      </div>

                      <div className={styles.factorGrid}>
                        <div className={styles.factorPanel}>
                          <p className={styles.metaLabel}>Yukari cekenler</p>
                          <div className={styles.factorList}>
                            {item.scoreBreakdown.topPositiveFactors.length > 0 ? (
                              item.scoreBreakdown.topPositiveFactors.slice(0, 2).map((factor) => (
                                <div key={factor.code} className={styles.factorItem}>
                                  <span className={styles.factorLabel}>{factor.label}</span>
                                  <strong className={styles.positive}>
                                    +{formatNumber(factor.contribution)}
                                  </strong>
                                </div>
                              ))
                            ) : (
                              <div className={styles.metaSubtle}>Belirgin pozitif katki yok.</div>
                            )}
                          </div>
                        </div>

                        <div className={styles.factorPanel}>
                          <p className={styles.metaLabel}>Asagi cekenler</p>
                          <div className={styles.factorList}>
                            {item.scoreBreakdown.topNegativeFactors.length > 0 ? (
                              item.scoreBreakdown.topNegativeFactors.slice(0, 2).map((factor) => (
                                <div key={factor.code} className={styles.factorItem}>
                                  <span className={styles.factorLabel}>{factor.label}</span>
                                  <strong className={styles.negative}>
                                    {formatNumber(factor.contribution)}
                                  </strong>
                                </div>
                              ))
                            ) : (
                              <div className={styles.metaSubtle}>Belirgin negatif katki yok.</div>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      className={inCart ? styles.removeCartButton : styles.addCartButton}
                      onClick={() => handleToggleCart(item)}
                    >
                      {inCart ? "Sepetten cikar" : "Sepete ekle"}
                    </button>
                  </article>
                );
              })
            ) : (
              <div className={styles.emptyState}>
                {scanner?.status.state === "running"
                  ? "Tum BIST hisseleri taraniyor. Ilk sonuc geldiginde oneriler burada listelenecek."
                  : "Henuz gosterilecek onerili hisse bulunmuyor."}
              </div>
            )}
          </div>

          <aside className={styles.cartPanel}>
            <div className={styles.cartHeader}>
              <div>
                <p className={styles.metaLabel}>Sepet</p>
                <h2 className={styles.sectionTitle}>Demo satin alma listesi</h2>
              </div>
              <button
                type="button"
                className={styles.textButton}
                onClick={() => setCart([])}
                disabled={cart.length === 0}
              >
                Temizle
              </button>
            </div>

            <div className={styles.cartSummary}>
              <div>
                <span>Kalem</span>
                <strong>{formatNumber(cart.length, 0)}</strong>
              </div>
              <div>
                <span>Toplam lot</span>
                <strong>{formatNumber(cartTotalShares, 0)}</strong>
              </div>
              <div>
                <span>Ara toplam</span>
                <strong>
                  {portfolio
                    ? formatCurrency(cartTotal, portfolio.baseCurrency)
                    : formatNumber(cartTotal)}
                </strong>
              </div>
            </div>

            <div className={styles.cartList}>
              {cart.length > 0 ? (
                cart.map((item) => (
                  <div key={item.symbol} className={styles.cartItem}>
                    <div className={styles.cartItemTop}>
                      <div>
                        <div className={styles.cartSymbol}>{item.displaySymbol}</div>
                        <div className={styles.metaSubtle}>{item.companyName}</div>
                      </div>
                      <button
                        type="button"
                        className={styles.iconButton}
                        onClick={() => handleRemoveFromCart(item.symbol)}
                      >
                        Cikar
                      </button>
                    </div>

                    <div className={styles.cartControls}>
                      <label className={styles.cartField}>
                        Lot
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={item.shares}
                          onChange={(event) => handleQuantityChange(item.symbol, event)}
                        />
                      </label>
                      <div className={styles.cartPrice}>
                        {formatCurrency(item.shares * item.price, item.currency)}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className={styles.emptyState}>
                  Kart gibi dusun: begendiklerini ekle, istemediklerini cikar, sonra tek tusla satin al.
                </div>
              )}
            </div>

            <button
              type="button"
              className={styles.checkoutButton}
              onClick={() => void handleCheckout()}
              disabled={cart.length === 0 || submitting}
            >
              {submitting ? "Sepet isleniyor" : "Tek tusla satin al"}
            </button>
          </aside>
        </div>
      </section>

      <BacktestPanel
        preferredSymbol={selectedRecommendation?.symbol ?? recommendations[0]?.symbol ?? ""}
        symbolOptions={symbolOptions}
      />

      <PortfolioAnalyticsPanel
        analytics={analytics}
        loading={analyticsLoading}
        error={analyticsError}
      />

      <TradeJournalPanel
        defaultSymbol={selectedRecommendation?.symbol ?? ""}
        reloadKey={journalReloadKey}
        symbolOptions={symbolOptions}
        onJournalChange={handleJournalChange}
      />

      <AlertCenterPanel
        alerts={alerts}
        loading={alertsLoading}
        error={alertsError}
        selectedStrategy={selectedStrategy}
        defaultSymbol={selectedRecommendation?.symbol ?? ""}
        symbolOptions={symbolOptions}
        onAlertsChange={handleAlertsChange}
        onFeedback={setFeedback}
        onError={setError}
      />

      <section className={styles.lowerGrid}>
        <article className={styles.focusPanel}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.metaLabel}>Odak ekran</p>
              <h2 className={styles.sectionTitle}>
                {selectedRecommendation
                  ? `${selectedRecommendation.displaySymbol} detay`
                  : "Secili hisse detayi"}
              </h2>
            </div>
          </div>

          {selectedRecommendation ? (
            <>
              <div className={styles.focusHeader}>
                <div>
                  <p className={styles.focusCompany}>{selectedRecommendation.companyName}</p>
                  <p className={styles.metaSubtle}>
                    {selectedRecommendation.exchange} | {selectedRecommendation.city} |{" "}
                    {formatDateTime(selectedRecommendation.marketTime)}
                  </p>
                </div>
                <div className={styles.focusBadge}>
                  {selectedRecommendation.signal.score}
                  <span>puan</span>
                </div>
              </div>

              <MarketPriceChart
                benchmark={scanner?.benchmark ?? null}
                recommendation={selectedRecommendation}
              />

              <OrderTicket
                recommendation={selectedRecommendation}
                portfolio={portfolio}
                onJournalChange={handleJournalChange}
                onPortfolioChange={handlePortfolioChange}
                onFeedback={setFeedback}
                onError={setError}
              />

              <div className={styles.detailMetrics}>
                <div className={styles.detailMetric}>
                  <span>RSI 14</span>
                  <strong>
                    {selectedRecommendation.indicators.rsi14 !== null
                      ? formatNumber(selectedRecommendation.indicators.rsi14)
                      : "--"}
                  </strong>
                </div>
                <div className={styles.detailMetric}>
                  <span>1A momentum</span>
                  <strong className={toneClass(selectedRecommendation.indicators.momentum21 ?? 0)}>
                    {selectedRecommendation.indicators.momentum21 !== null
                      ? formatPercent(selectedRecommendation.indicators.momentum21)
                      : "--"}
                  </strong>
                </div>
                <div className={styles.detailMetric}>
                  <span>Risk butcesi</span>
                  <strong>
                    {formatCurrency(
                      selectedRecommendation.riskBudget,
                      selectedRecommendation.currency,
                    )}
                  </strong>
                </div>
                <div className={styles.detailMetric}>
                  <span>Onerilen sepet payi</span>
                  <strong>
                    {formatCurrency(
                      selectedRecommendation.suggestedAmount,
                      selectedRecommendation.currency,
                    )}
                  </strong>
                </div>
              </div>

              <StockEventPanel
                intelligence={detailIntelligence}
                loading={detailLoading}
                error={detailError}
              />

              <div className={styles.thesisPanel}>
                {selectedRecommendation.thesis.map((reason) => (
                  <div key={reason} className={styles.thesisItem}>
                    {reason}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className={styles.emptyState}>
              Tarama sonucu geldiginde secili hisse detayi burada acilacak.
            </div>
          )}
        </article>

        <div className={styles.rightColumn}>
          <article className={styles.tablePanel}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.metaLabel}>Portfoy</p>
                <h2 className={styles.sectionTitle}>Acik pozisyonlar</h2>
              </div>
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Sembol</th>
                    <th>Lot</th>
                    <th>Rezerv</th>
                    <th>Fiyat</th>
                    <th>P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio?.positions.length ? (
                    portfolio.positions.map((item) => (
                      <tr key={item.symbol}>
                        <td>{item.symbol}</td>
                        <td>{formatNumber(item.shares, 4)}</td>
                        <td>{formatNumber(item.reservedShares, 4)}</td>
                        <td>{formatCurrency(item.marketPrice, item.currency)}</td>
                        <td className={toneClass(item.unrealizedPnl)}>
                          {formatCurrency(item.unrealizedPnl, item.currency)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className={styles.emptyState}>
                        Henuz acik pozisyon yok.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>

          <article className={styles.tablePanel}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.metaLabel}>Order book</p>
                <h2 className={styles.sectionTitle}>Son emirler</h2>
              </div>
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Tarih</th>
                    <th>Emir</th>
                    <th>Boyut</th>
                    <th>Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio?.orders.length ? (
                    portfolio.orders.slice(0, 12).map((order) => (
                      <tr key={order.id}>
                        <td>{formatDateTime(order.updatedAt)}</td>
                        <td>
                          {order.symbol} {order.side === "buy" ? "AL" : "SAT"} {order.type}
                        </td>
                        <td>
                          {formatNumber(order.filledShares, 4)} /{" "}
                          {formatNumber(order.requestedShares, 4)}
                        </td>
                        <td>
                          <span className={`${styles.statusPill} ${orderStatusClass(order.status)}`}>
                            {orderStatusLabel(order.status)}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className={styles.emptyState}>
                        Henuz olusan emir yok.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>

          <article className={styles.tablePanel}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.metaLabel}>Execution log</p>
                <h2 className={styles.sectionTitle}>Gerceklesme kayitlari</h2>
              </div>
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Tarih</th>
                    <th>Sembol</th>
                    <th>Lot</th>
                    <th>Fiyat</th>
                    <th>Komisyon</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio?.executions.length ? (
                    portfolio.executions.slice(0, 12).map((execution) => (
                      <tr key={execution.id}>
                        <td>{formatDateTime(execution.executedAt)}</td>
                        <td>
                          {execution.symbol} {execution.side === "buy" ? "AL" : "SAT"}
                        </td>
                        <td>{formatNumber(execution.shares, 4)}</td>
                        <td>{formatCurrency(execution.price, execution.currency)}</td>
                        <td>{formatCurrency(execution.commissionAmount, execution.currency)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className={styles.emptyState}>
                        Henuz execution olusmadi.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </div>
      </section>
    </main>
  );
}
