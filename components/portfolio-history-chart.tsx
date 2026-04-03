"use client";

import { formatDateLabel, formatNumber } from "@/lib/format";

import styles from "./market-lab.module.css";

interface ChartPoint {
  date: string;
  value: number;
}

interface PortfolioHistoryChartProps {
  title: string;
  subtitle: string;
  points: ChartPoint[];
  valuePrefix?: string;
  valueSuffix?: string;
  tone?: "equity" | "drawdown";
}

function describeValue(
  value: number,
  prefix = "",
  suffix = "",
) {
  return `${prefix}${formatNumber(value)}${suffix}`;
}

export function PortfolioHistoryChart({
  title,
  subtitle,
  points,
  valuePrefix = "",
  valueSuffix = "",
  tone = "equity",
}: PortfolioHistoryChartProps) {
  if (points.length === 0) {
    return (
      <div className={styles.analyticsChartCard}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.metaLabel}>{title}</p>
            <h3 className={styles.sectionTitle}>{subtitle}</h3>
          </div>
        </div>
        <div className={styles.emptyState}>Chart icin yeterli veri yok.</div>
      </div>
    );
  }

  const width = 760;
  const height = 240;
  const paddingX = 18;
  const paddingTop = 18;
  const paddingBottom = 22;
  const values = points.map((point) => point.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const paddingValue =
    maxValue === minValue ? Math.max(Math.abs(maxValue), 1) * 0.12 : (maxValue - minValue) * 0.12;
  const chartMin = minValue - paddingValue;
  const chartMax = maxValue + paddingValue;
  const spread = Math.max(chartMax - chartMin, 1);

  const path = points
    .map((point, index) => {
      const x =
        paddingX +
        (index / Math.max(points.length - 1, 1)) * (width - paddingX * 2);
      const y =
        paddingTop +
        ((chartMax - point.value) / spread) * (height - paddingTop - paddingBottom);

      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  const areaPath = `${path} L ${width - paddingX} ${height - paddingBottom} L ${paddingX} ${height - paddingBottom} Z`;
  const latest = points.at(-1) as ChartPoint;

  return (
    <div className={styles.analyticsChartCard}>
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.metaLabel}>{title}</p>
          <h3 className={styles.sectionTitle}>{subtitle}</h3>
        </div>
        <div className={styles.analyticsChartValue}>
          {describeValue(latest.value, valuePrefix, valueSuffix)}
        </div>
      </div>

      <div className={styles.chartCanvas}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className={styles.chartSvg}
          role="img"
          aria-label={subtitle}
        >
          <line
            x1={paddingX}
            y1={height - paddingBottom}
            x2={width - paddingX}
            y2={height - paddingBottom}
            className={styles.chartGrid}
          />
          <path
            d={areaPath}
            className={
              tone === "drawdown" ? styles.analyticsDrawdownArea : styles.analyticsEquityArea
            }
          />
          <path
            d={path}
            className={
              tone === "drawdown" ? styles.analyticsDrawdownLine : styles.analyticsEquityLine
            }
          />
        </svg>
      </div>

      <div className={styles.axisLabels}>
        <span>{formatDateLabel(points[0]?.date ?? latest.date)}</span>
        <span>{formatDateLabel(latest.date)}</span>
      </div>
    </div>
  );
}
