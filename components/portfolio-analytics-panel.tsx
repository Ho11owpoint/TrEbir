"use client";

import {
  formatCurrency,
  formatDateLabel,
  formatDateTime,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import type {
  PortfolioAllocationItem,
  PortfolioAnalyticsResponse,
  PortfolioPositionInsight,
} from "@/lib/types";

import { PortfolioHistoryChart } from "./portfolio-history-chart";
import styles from "./market-lab.module.css";

interface PortfolioAnalyticsPanelProps {
  analytics: PortfolioAnalyticsResponse | null;
  loading: boolean;
  error: string | null;
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

function renderAllocationList(
  items: PortfolioAllocationItem[],
  currency: string,
  emptyText: string,
) {
  if (items.length === 0) {
    return <div className={styles.emptyState}>{emptyText}</div>;
  }

  const maxValue = Math.max(...items.map((item) => item.value), 1);

  return (
    <div className={styles.analyticsBarList}>
      {items.slice(0, 6).map((item) => (
        <div key={item.key} className={styles.analyticsBarItem}>
          <div className={styles.analyticsBarHeader}>
            <div>
              <strong>{item.label}</strong>
              <div className={styles.metaSubtle}>{formatPercent(item.weightPercent)}</div>
            </div>
            <div className={styles.analyticsBarValue}>
              {formatCurrency(item.value, currency)}
            </div>
          </div>
          <div className={styles.analyticsBarTrack}>
            <div
              className={styles.analyticsBarFill}
              style={{
                width: `${Math.max((item.value / maxValue) * 100, 6)}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function renderPositionList(
  items: PortfolioPositionInsight[],
  currency: string,
  emptyText: string,
) {
  if (items.length === 0) {
    return <div className={styles.emptyState}>{emptyText}</div>;
  }

  return (
    <div className={styles.analyticsPositionList}>
      {items.map((item) => (
        <div key={item.symbol} className={styles.analyticsPositionItem}>
          <div>
            <strong>{item.displaySymbol}</strong>
            <div className={styles.metaSubtle}>{item.companyName}</div>
          </div>
          <div className={styles.analyticsPositionMeta}>
            <strong className={toneClass(item.unrealizedPnl)}>
              {formatCurrency(item.unrealizedPnl, currency)}
            </strong>
            <span className={toneClass(item.unrealizedPnlPercent)}>
              {formatPercent(item.unrealizedPnlPercent)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatOptionalPercent(value: number | null) {
  return value === null ? "--" : formatPercent(value);
}

export function PortfolioAnalyticsPanel({
  analytics,
  loading,
  error,
}: PortfolioAnalyticsPanelProps) {
  if (loading) {
    return (
      <section className={styles.analyticsPanel}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.metaLabel}>Portfolio analytics</p>
            <h2 className={styles.sectionTitle}>Portfoy davranisi ve dagilim</h2>
          </div>
        </div>
        <div className={styles.emptyState}>Analytics verisi yukleniyor.</div>
      </section>
    );
  }

  if (error) {
    return (
      <section className={styles.analyticsPanel}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.metaLabel}>Portfolio analytics</p>
            <h2 className={styles.sectionTitle}>Portfoy davranisi ve dagilim</h2>
          </div>
        </div>
        <div className={styles.errorBanner}>{error}</div>
      </section>
    );
  }

  if (!analytics) {
    return (
      <section className={styles.analyticsPanel}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.metaLabel}>Portfolio analytics</p>
            <h2 className={styles.sectionTitle}>Portfoy davranisi ve dagilim</h2>
          </div>
        </div>
        <div className={styles.emptyState}>Analytics verisi henuz hazir degil.</div>
      </section>
    );
  }

  return (
    <section className={styles.analyticsPanel}>
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.metaLabel}>Portfolio analytics</p>
          <h2 className={styles.sectionTitle}>Portfoy davranisi ve dagilim</h2>
        </div>
        <span className={styles.sectionNote}>
          Son guncelleme: {formatDateTime(analytics.updatedAt)}
        </span>
      </div>

      <div className={styles.analyticsMetricGrid}>
        <div className={styles.analyticsMetricCard}>
          <span>Toplam getiri</span>
          <strong className={toneClass(analytics.performance.totalReturnPercent)}>
            {formatPercent(analytics.performance.totalReturnPercent)}
          </strong>
        </div>
        <div className={styles.analyticsMetricCard}>
          <span>Max drawdown</span>
          <strong className={toneClass(analytics.performance.maxDrawdownPercent)}>
            {formatPercent(analytics.performance.maxDrawdownPercent)}
          </strong>
        </div>
        <div className={styles.analyticsMetricCard}>
          <span>En iyi gun</span>
          <strong className={toneClass(analytics.performance.bestDayReturnPercent ?? 0)}>
            {formatOptionalPercent(analytics.performance.bestDayReturnPercent)}
          </strong>
        </div>
        <div className={styles.analyticsMetricCard}>
          <span>En zayif gun</span>
          <strong className={toneClass(analytics.performance.worstDayReturnPercent ?? 0)}>
            {formatOptionalPercent(analytics.performance.worstDayReturnPercent)}
          </strong>
        </div>
        <div className={styles.analyticsMetricCard}>
          <span>Takip gunu</span>
          <strong>{formatNumber(analytics.performance.trackedDays, 0)}</strong>
        </div>
        <div className={styles.analyticsMetricCard}>
          <span>Nakit orani</span>
          <strong>{formatPercent(analytics.performance.cashRatio)}</strong>
        </div>
        <div className={styles.analyticsMetricCard}>
          <span>Ilk 3 yogunluk</span>
          <strong>{formatPercent(analytics.performance.topThreeWeight)}</strong>
        </div>
      </div>

      <div className={styles.analyticsChartGrid}>
        <PortfolioHistoryChart
          title="Equity curve"
          subtitle="Portfoy ozkaynak serisi"
          points={analytics.equityCurve.map((point) => ({
            date: point.date,
            value: point.equity,
          }))}
          valuePrefix=""
          valueSuffix={` ${analytics.baseCurrency}`}
          tone="equity"
        />
        <PortfolioHistoryChart
          title="Drawdown"
          subtitle="Portfoy gerileme serisi"
          points={analytics.drawdownSeries.map((point) => ({
            date: point.date,
            value: point.drawdownPercent,
          }))}
          valueSuffix="%"
          tone="drawdown"
        />
      </div>

      <div className={styles.analyticsInsightGrid}>
        <article className={styles.analyticsCard}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.metaLabel}>P/L dagilimi</p>
              <h3 className={styles.sectionTitle}>Gerceklesen vs acik pozisyon</h3>
            </div>
          </div>
          <div className={styles.analyticsPnlSummary}>
            {analytics.pnlBreakdown.segments.map((segment) => {
              const maxAbsoluteValue = Math.max(
                ...analytics.pnlBreakdown.segments.map((item) => Math.abs(item.value)),
                1,
              );

              return (
                <div key={segment.key} className={styles.analyticsPnlItem}>
                  <div className={styles.analyticsBarHeader}>
                    <span>{segment.label}</span>
                    <strong className={toneClass(segment.value)}>
                      {formatCurrency(segment.value, analytics.baseCurrency)}
                    </strong>
                  </div>
                  <div className={styles.analyticsBarTrack}>
                    <div
                      className={
                        segment.value >= 0
                          ? styles.analyticsPnlFillPositive
                          : styles.analyticsPnlFillNegative
                      }
                      style={{
                        width: `${Math.max((Math.abs(segment.value) / maxAbsoluteValue) * 100, 6)}%`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </article>

        <article className={styles.analyticsCard}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.metaLabel}>Sembol dagilimi</p>
              <h3 className={styles.sectionTitle}>Acik pozisyon agirliklari</h3>
            </div>
          </div>
          {renderAllocationList(
            analytics.allocationBySymbol,
            analytics.baseCurrency,
            "Acik pozisyon olmadigi icin allocation hesabi yok.",
          )}
        </article>

        <article className={styles.analyticsCard}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.metaLabel}>Sektor dagilimi</p>
              <h3 className={styles.sectionTitle}>Metadata varsa sektor agirliklari</h3>
            </div>
          </div>
          {renderAllocationList(
            analytics.allocationBySector,
            analytics.baseCurrency,
            "Sektor bazli dagilim icin yeterli metadata yok.",
          )}
        </article>
      </div>

      <div className={styles.analyticsTableGrid}>
        <article className={styles.analyticsCard}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.metaLabel}>En iyi pozisyonlar</p>
              <h3 className={styles.sectionTitle}>Acik kazananlar</h3>
            </div>
          </div>
          {renderPositionList(
            analytics.bestPositions,
            analytics.baseCurrency,
            "Acik pozisyon olmadigi icin karsilastirma yapilamiyor.",
          )}
        </article>

        <article className={styles.analyticsCard}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.metaLabel}>En zayif pozisyonlar</p>
              <h3 className={styles.sectionTitle}>Acik kaybettirenler</h3>
            </div>
          </div>
          {renderPositionList(
            analytics.worstPositions,
            analytics.baseCurrency,
            "Acik pozisyon olmadigi icin karsilastirma yapilamiyor.",
          )}
        </article>
      </div>

      <div className={styles.analyticsTableGrid}>
        <article className={styles.analyticsCard}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.metaLabel}>Gunluk snapshotlar</p>
              <h3 className={styles.sectionTitle}>Son portfoy kayitlari</h3>
            </div>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Tarih</th>
                  <th>Equity</th>
                  <th>Getiri</th>
                  <th>Exposure</th>
                </tr>
              </thead>
              <tbody>
                {analytics.recentSnapshots.length > 0 ? (
                  analytics.recentSnapshots.map((snapshot) => (
                    <tr key={snapshot.date}>
                      <td>{formatDateLabel(snapshot.date)}</td>
                      <td>{formatCurrency(snapshot.equity, analytics.baseCurrency)}</td>
                      <td className={toneClass(snapshot.returnPercent)}>
                        {formatPercent(snapshot.returnPercent)}
                      </td>
                      <td>{formatPercent(snapshot.openExposure)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className={styles.emptyState}>
                      Henuz snapshot birikmedi.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className={styles.analyticsCard}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.metaLabel}>Benchmark</p>
              <h3 className={styles.sectionTitle}>Karsilastirma mimarisi</h3>
            </div>
          </div>
          <div className={styles.analyticsBenchmarkBox}>
            <strong>
              {analytics.benchmarkComparison.benchmarkLabel} (
              {analytics.benchmarkComparison.benchmarkSymbol})
            </strong>
            <p className={styles.metaSubtle}>{analytics.benchmarkComparison.note}</p>
            <div className={styles.metaSubtle}>
              Seri noktasi: {formatNumber(analytics.benchmarkComparison.series.length, 0)}
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
