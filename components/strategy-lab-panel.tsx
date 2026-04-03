"use client";

import { formatNumber } from "@/lib/format";
import type {
  RecommendationCandidate,
  ScannerResponse,
  StrategyProfileId,
} from "@/lib/types";

import styles from "./market-lab.module.css";

interface StrategyLabPanelProps {
  scanner: ScannerResponse | null;
  recommendations: RecommendationCandidate[];
  selectedStrategy: StrategyProfileId;
  onStrategyChange: (strategy: StrategyProfileId) => void;
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

export function StrategyLabPanel({
  scanner,
  recommendations,
  selectedStrategy,
  onStrategyChange,
}: StrategyLabPanelProps) {
  return (
    <section className={styles.strategyPanel}>
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.metaLabel}>Strategy lab</p>
          <h2 className={styles.sectionTitle}>Strateji profilleri ve kalite gorunumu</h2>
        </div>
        <label className={styles.strategySelectWrap}>
          <span>Aktif strateji</span>
          <select
            className={styles.formInput}
            value={selectedStrategy}
            onChange={(event) =>
              onStrategyChange(event.target.value as StrategyProfileId)
            }
          >
            {scanner?.strategy.availableStrategies.map((strategy) => (
              <option key={strategy.id} value={strategy.id}>
                {strategy.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.analyticsMetricGrid}>
        <div className={styles.analyticsMetricCard}>
          <span>Aktif profil</span>
          <strong>{scanner?.strategy.activeLabel ?? "--"}</strong>
          <div className={styles.metaSubtle}>{scanner?.strategy.activeDescription ?? ""}</div>
        </div>
        <div className={styles.analyticsMetricCard}>
          <span>Provider</span>
          <strong>{scanner?.providerSummary[0]?.label ?? "Bekleniyor"}</strong>
          <div className={styles.metaSubtle}>
            Stale: {scanner?.providerSummary[0]?.staleCount ?? 0}, warning:{" "}
            {scanner?.providerSummary[0]?.warningCount ?? 0}
          </div>
        </div>
        <div className={styles.analyticsMetricCard}>
          <span>Failure ozet</span>
          <strong>{scanner ? formatNumber(scanner.failedCount, 0) : "--"}</strong>
          <div className={styles.metaSubtle}>
            {scanner?.failureSummary
              .slice(0, 2)
              .map((item) => `${item.type}: ${item.count}`)
              .join(" | ") || "Veri hazirlaninca gorunecek."}
          </div>
        </div>
      </div>

      <div className={styles.analyticsTableGrid}>
        <article className={styles.analyticsCard}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.metaLabel}>Profil karsilastirma</p>
              <h3 className={styles.sectionTitle}>Her stratejinin ilk sembolleri</h3>
            </div>
          </div>

          <div className={styles.strategyCompareGrid}>
            {scanner?.strategy.comparisons.map((comparison) => (
              <div key={comparison.strategy} className={styles.strategyCompareCard}>
                <strong>{comparison.label}</strong>
                <div className={styles.strategySymbolRow}>
                  {comparison.topSymbols.length > 0 ? (
                    comparison.topSymbols.map((symbol) => (
                      <span key={symbol} className={styles.journalTag}>
                        {symbol}
                      </span>
                    ))
                  ) : (
                    <span className={styles.metaSubtle}>Hazir degil</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className={styles.analyticsCard}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.metaLabel}>Aktif liste farklari</p>
              <h3 className={styles.sectionTitle}>Varsayilan profile gore delta</h3>
            </div>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Sembol</th>
                  <th>Aktif skor</th>
                  <th>Varsayilan</th>
                  <th>Delta</th>
                </tr>
              </thead>
              <tbody>
                {recommendations.length > 0 ? (
                  recommendations.slice(0, 6).map((item) => (
                    <tr key={item.symbol}>
                      <td>{item.displaySymbol}</td>
                      <td>{formatNumber(item.rankScore)}</td>
                      <td>{formatNumber(item.baselineRankScore)}</td>
                      <td className={toneClass(item.strategyDeltaFromDefault)}>
                        {formatNumber(item.strategyDeltaFromDefault)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className={styles.emptyState}>
                      Karsilastirma icin strateji sonucu bekleniyor.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      </div>
    </section>
  );
}
