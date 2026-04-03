"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

import { buildTradingChartOption } from "@/lib/chart-options";
import { formatCurrency, formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import type {
  ChartRangeKey,
  MarketContext,
  RecommendationCandidate,
  StockChartResponse,
} from "@/lib/types";

import styles from "./market-lab.module.css";

const ReactECharts = dynamic(() => import("echarts-for-react"), {
  ssr: false,
});

const RANGE_OPTIONS: Array<{
  key: ChartRangeKey;
  label: string;
}> = [
  { key: "1d", label: "1D" },
  { key: "5d", label: "5D" },
  { key: "1mo", label: "1M" },
  { key: "3mo", label: "3M" },
  { key: "6mo", label: "6M" },
  { key: "1y", label: "1Y" },
  { key: "max", label: "MAX" },
];

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, {
    cache: "no-store",
    ...init,
  });
  const data = (await response.json()) as T & { message?: string };

  if (!response.ok) {
    throw new Error(data.message ?? "Grafik verisi yuklenemedi.");
  }

  return data;
}

function regimeBadgeClass(trend: MarketContext["trend"] | undefined | null) {
  if (trend === "risk-on") {
    return styles.chartRegimeGood;
  }

  if (trend === "risk-off") {
    return styles.chartRegimeRisk;
  }

  return styles.chartRegimeNeutral;
}

interface MarketPriceChartProps {
  benchmark: MarketContext | null;
  recommendation: RecommendationCandidate;
}

export function MarketPriceChart({
  benchmark,
  recommendation,
}: MarketPriceChartProps) {
  const [selectedRange, setSelectedRange] = useState<ChartRangeKey>("6mo");
  const [showSma20, setShowSma20] = useState(true);
  const [showSma50, setShowSma50] = useState(true);
  const [showAtr, setShowAtr] = useState(false);
  const [showRsi, setShowRsi] = useState(true);
  const [chartData, setChartData] = useState<StockChartResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setChartData(null);
    setError(null);
  }, [recommendation.symbol]);

  useEffect(() => {
    let cancelled = false;

    async function loadChart() {
      try {
        setLoading(true);
        const response = await fetchJson<StockChartResponse>(
          `/api/stocks/${encodeURIComponent(recommendation.symbol)}/chart?range=${selectedRange}`,
        );

        if (cancelled) {
          return;
        }

        setChartData(response);
        setError(null);
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Grafik verisi yuklenemedi.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadChart();

    return () => {
      cancelled = true;
    };
  }, [recommendation.symbol, selectedRange]);

  const activePrice = chartData?.lastPrice ?? recommendation.price;
  const activeCurrency = chartData?.currency ?? recommendation.currency;
  const activeChange = chartData?.change ?? recommendation.change;
  const activeChangePercent = chartData?.changePercent ?? recommendation.changePercent;
  const chartOption = useMemo(
    () =>
      chartData
        ? buildTradingChartOption(
            chartData,
            selectedRange,
            {
              showAtr,
              showRsi,
              showSma20,
              showSma50,
            },
            benchmark,
          )
        : null,
    [benchmark, chartData, selectedRange, showAtr, showRsi, showSma20, showSma50],
  );

  return (
    <section className={styles.chartTerminal}>
      <div className={styles.chartTerminalHeader}>
        <div className={styles.chartIdentity}>
          <div className={styles.chartSymbolRow}>
            <div>
              <p className={styles.metaLabel}>Market terminal</p>
              <h3 className={styles.chartSymbol}>
                {recommendation.displaySymbol}
                <span>{recommendation.companyName}</span>
              </h3>
            </div>
            <span className={`${styles.chartRegimeBadge} ${regimeBadgeClass(benchmark?.trend)}`}>
              {benchmark?.label ?? "Rejim bekleniyor"}
            </span>
          </div>

          <div className={styles.chartPriceRow}>
            <div className={styles.chartLastPrice}>
              {formatCurrency(activePrice, activeCurrency)}
            </div>
            <div className={activeChangePercent >= 0 ? styles.positive : styles.negative}>
              {activeChangePercent >= 0 ? "+" : ""}
              {formatPercent(activeChangePercent)} / {formatCurrency(activeChange, activeCurrency)}
            </div>
          </div>

          <div className={styles.chartMetaRow}>
            <span>{recommendation.exchange}</span>
            <span>Signal {recommendation.signal.score}/100</span>
            <span>{formatDateTime(recommendation.marketTime)}</span>
            <span>{recommendation.strategyLabel}</span>
          </div>
        </div>

        <div className={styles.chartControlStack}>
          <div className={styles.segmentedControl}>
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`${styles.segmentButton} ${
                  option.key === selectedRange ? styles.segmentButtonActive : ""
                }`}
                onClick={() => setSelectedRange(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className={styles.chartToggleRow}>
            <button
              type="button"
              className={`${styles.toggleChip} ${showSma20 ? styles.toggleChipActive : ""}`}
              onClick={() => setShowSma20((value) => !value)}
            >
              SMA 20
            </button>
            <button
              type="button"
              className={`${styles.toggleChip} ${showSma50 ? styles.toggleChipActive : ""}`}
              onClick={() => setShowSma50((value) => !value)}
            >
              SMA 50
            </button>
            <button
              type="button"
              className={`${styles.toggleChip} ${showAtr ? styles.toggleChipActive : ""}`}
              onClick={() => setShowAtr((value) => !value)}
            >
              ATR
            </button>
            <button
              type="button"
              className={`${styles.toggleChip} ${showRsi ? styles.toggleChipActive : ""}`}
              onClick={() => setShowRsi((value) => !value)}
            >
              RSI
            </button>
          </div>
        </div>
      </div>

      <div className={styles.chartSubHeader}>
        <div className={styles.chartMetaGrid}>
          <div className={styles.chartMetaCard}>
            <span>Provider</span>
            <strong>{chartData?.provider.label ?? "Yukleniyor"}</strong>
            <small>
              {chartData
                ? `${chartData.series.length} bar / ${chartData.interval}`
                : "Fiyat serisi yukleniyor"}
            </small>
          </div>
          <div className={styles.chartMetaCard}>
            <span>Forecast</span>
            <strong>
              {chartData?.forecast
                ? `${chartData.forecast.validHorizonBars} bar`
                : "Kapali"}
            </strong>
            <small>
              {chartData?.forecast
                ? `Gecerli ufuk: ${formatDateTime(chartData.forecast.validUntil)}`
                : "Yeterli history yoksa sabit uzatma yapilmaz"}
            </small>
          </div>
          <div className={styles.chartMetaCard}>
            <span>Drift / Vol</span>
            <strong>
              {chartData?.forecast
                ? `${formatPercent(chartData.forecast.annualizedDrift)} / ${formatPercent(
                    chartData.forecast.annualizedVolatility,
                  )}`
                : "--"}
            </strong>
            <small>Yilliklestirilmis senaryo parametreleri</small>
          </div>
          <div className={styles.chartMetaCard}>
            <span>Hover</span>
            <strong>OHLC + senaryo</strong>
            <small>Crosshair ile detay tooltip aktif</small>
          </div>
        </div>
      </div>

      {error ? <div className={styles.errorBanner}>{error}</div> : null}
      {chartData?.warnings.length ? (
        <div className={styles.chartWarningStrip}>
          {chartData.warnings.slice(0, 3).map((warning) => (
            <span key={warning} className={styles.chartWarningChip}>
              {warning}
            </span>
          ))}
        </div>
      ) : null}

      <div className={styles.chartShell}>
        {loading && !chartOption ? (
          <div className={styles.chartLoadingState}>
            <div className={styles.chartSkeletonTop} />
            <div className={styles.chartSkeletonCanvas} />
            <div className={styles.chartSkeletonBottom} />
          </div>
        ) : chartOption ? (
          <ReactECharts
            option={chartOption}
            notMerge
            lazyUpdate
            style={{
              display: "block",
              height: showRsi ? 680 : 612,
              width: "100%",
            }}
            opts={{
              renderer: "svg",
            }}
          />
        ) : (
          <div className={styles.emptyState}>Grafik icin veri hazir degil.</div>
        )}
      </div>

      <div className={styles.chartFooter}>
        <div className={styles.chartFooterItem}>
          <span>52H</span>
          <strong>
            {recommendation.indicators.fiftyTwoWeekHigh !== null
              ? formatCurrency(recommendation.indicators.fiftyTwoWeekHigh, recommendation.currency)
              : "--"}
          </strong>
        </div>
        <div className={styles.chartFooterItem}>
          <span>52L</span>
          <strong>
            {recommendation.indicators.fiftyTwoWeekLow !== null
              ? formatCurrency(recommendation.indicators.fiftyTwoWeekLow, recommendation.currency)
              : "--"}
          </strong>
        </div>
        <div className={styles.chartFooterItem}>
          <span>ATR 14</span>
          <strong>
            {recommendation.indicators.atr14 !== null
              ? formatNumber(recommendation.indicators.atr14)
              : "--"}
          </strong>
        </div>
        <div className={styles.chartFooterItem}>
          <span>RSI 14</span>
          <strong>
            {recommendation.indicators.rsi14 !== null
              ? formatNumber(recommendation.indicators.rsi14)
              : "--"}
          </strong>
        </div>
      </div>
    </section>
  );
}
