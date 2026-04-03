"use client";

import { useState } from "react";

import { formatCurrency, formatDateLabel, formatPercent } from "@/lib/format";
import type { Candle } from "@/lib/types";

import styles from "./trading-dashboard.module.css";

const WINDOW_OPTIONS = [
  { label: "1A", bars: 21 },
  { label: "3A", bars: 63 },
  { label: "6A", bars: 126 },
] as const;

type WindowLabel = (typeof WINDOW_OPTIONS)[number]["label"];

interface PriceChartProps {
  series: Candle[];
  currency: string;
  currentPrice: number;
}

interface ChartPoint {
  x: number;
  y: number;
}

function average(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function buildMovingAverage(series: Candle[], period: number) {
  return series.map((_, index) => {
    if (index + 1 < period) {
      return null;
    }

    return average(series.slice(index + 1 - period, index + 1).map((bar) => bar.close));
  });
}

function buildCoordinates(
  values: Array<number | null>,
  min: number,
  max: number,
  width: number,
  height: number,
  padding: number,
) {
  return values.map<ChartPoint | null>((value, index) => {
    if (value === null) {
      return null;
    }

    const usableWidth = width - padding * 2;
    const usableHeight = height - padding * 2;
    const x =
      padding + (usableWidth * index) / Math.max(values.length - 1, 1);
    const y = padding + ((max - value) / Math.max(max - min, 1)) * usableHeight;

    return { x, y };
  });
}

function toPolyline(points: Array<ChartPoint | null>) {
  return points
    .filter((point): point is ChartPoint => point !== null)
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
}

function toArea(points: Array<ChartPoint | null>, height: number, padding: number) {
  const visiblePoints = points.filter((point): point is ChartPoint => point !== null);

  if (visiblePoints.length === 0) {
    return "";
  }

  const start = visiblePoints[0];
  const finish = visiblePoints[visiblePoints.length - 1];

  return [
    `M ${start.x} ${height - padding}`,
    ...visiblePoints.map((point) => `L ${point.x} ${point.y}`),
    `L ${finish.x} ${height - padding}`,
    "Z",
  ].join(" ");
}

export function PriceChart({ series, currency, currentPrice }: PriceChartProps) {
  const [windowLabel, setWindowLabel] = useState<WindowLabel>("3A");
  const option = WINDOW_OPTIONS.find((item) => item.label === windowLabel) ?? WINDOW_OPTIONS[1];
  const visibleSeries = series.slice(-Math.min(option.bars, series.length));

  if (visibleSeries.length < 2) {
    return <div className={styles.emptyState}>Grafik icin yeterli veri yok.</div>;
  }

  const width = 860;
  const height = 340;
  const padding = 28;
  const ma20 = buildMovingAverage(visibleSeries, 20);
  const ma50 = buildMovingAverage(visibleSeries, 50);
  const numericValues: number[] = [];

  visibleSeries.forEach((bar, index) => {
    numericValues.push(bar.high, bar.low);

    if (ma20[index] !== null) {
      numericValues.push(ma20[index]);
    }

    if (ma50[index] !== null) {
      numericValues.push(ma50[index]);
    }
  });

  const minValue = Math.min(...numericValues);
  const maxValue = Math.max(...numericValues);
  const chartPadding = Math.max((maxValue - minValue) * 0.12, currentPrice * 0.015, 1);
  const chartMin = minValue - chartPadding;
  const chartMax = maxValue + chartPadding;

  const closePoints = buildCoordinates(
    visibleSeries.map((bar) => bar.close),
    chartMin,
    chartMax,
    width,
    height,
    padding,
  );
  const ma20Points = buildCoordinates(ma20, chartMin, chartMax, width, height, padding);
  const ma50Points = buildCoordinates(ma50, chartMin, chartMax, width, height, padding);
  const performance =
    visibleSeries[0]?.close === 0
      ? 0
      : ((currentPrice / visibleSeries[0].close) - 1) * 100;
  const xLabels = Array.from(
    new Set([
      visibleSeries[0]?.label,
      visibleSeries[Math.floor(visibleSeries.length / 3)]?.label,
      visibleSeries[Math.floor((visibleSeries.length * 2) / 3)]?.label,
      visibleSeries[visibleSeries.length - 1]?.label,
    ].filter(Boolean)),
  ) as string[];

  return (
    <div className={styles.chartFrame}>
      <div className={styles.chartTopline}>
        <div>
          <p className={styles.sectionTag}>Trend gorunumu</p>
          <div className={styles.chartHeadline}>
            {formatCurrency(currentPrice, currency)}
          </div>
          <p className={styles.chartSubline}>
            Secili pencere performansi:{" "}
            <span className={performance >= 0 ? styles.positive : styles.negative}>
              {formatPercent(performance)}
            </span>
          </p>
        </div>

        <div className={styles.timeframeTabs}>
          {WINDOW_OPTIONS.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`${styles.tabButton} ${
                item.label === windowLabel ? styles.tabButtonActive : ""
              }`}
              onClick={() => setWindowLabel(item.label)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.chartSvgWrap}>
        <svg
          className={styles.chartSvg}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Fiyat grafigi"
        >
          {[0, 1, 2, 3].map((row) => {
            const y =
              padding + ((height - padding * 2) * row) / 3;

            return (
              <line
                key={row}
                x1={padding}
                x2={width - padding}
                y1={y}
                y2={y}
                className={styles.chartGrid}
              />
            );
          })}

          <path d={toArea(closePoints, height, padding)} className={styles.chartArea} />
          <polyline
            points={toPolyline(ma50Points)}
            className={styles.chartLineSecondary}
          />
          <polyline
            points={toPolyline(ma20Points)}
            className={styles.chartLineAccent}
          />
          <polyline points={toPolyline(closePoints)} className={styles.chartLinePrimary} />
        </svg>
      </div>

      <div className={styles.chartLegend}>
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendPrimary}`} />
          Kapanis
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendAccent}`} />
          20 GHO
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendSecondary}`} />
          50 GHO
        </span>
      </div>

      <div className={styles.axisLabels}>
        {xLabels.map((label) => (
          <span key={label}>{formatDateLabel(label)}</span>
        ))}
      </div>
    </div>
  );
}
