import { formatCurrency, formatDateLabel, formatPercent } from "@/lib/format";
import type { BacktestEquityPoint } from "@/lib/types";

import styles from "./market-lab.module.css";

interface BacktestEquityCurveProps {
  currency: string;
  series: BacktestEquityPoint[];
}

interface ChartPoint {
  x: number;
  y: number;
}

function buildCoordinates(
  values: number[],
  min: number,
  max: number,
  width: number,
  height: number,
  padding: number,
) {
  return values.map<ChartPoint>((value, index) => {
    const usableWidth = width - padding * 2;
    const usableHeight = height - padding * 2;

    return {
      x: padding + (usableWidth * index) / Math.max(values.length - 1, 1),
      y: padding + ((max - value) / Math.max(max - min, 1)) * usableHeight,
    };
  });
}

function toPolyline(points: ChartPoint[]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function toArea(points: ChartPoint[], height: number, padding: number) {
  const start = points[0];
  const finish = points[points.length - 1];

  if (!start || !finish) {
    return "";
  }

  return [
    `M ${start.x} ${height - padding}`,
    ...points.map((point) => `L ${point.x} ${point.y}`),
    `L ${finish.x} ${height - padding}`,
    "Z",
  ].join(" ");
}

export function BacktestEquityCurve({
  currency,
  series,
}: BacktestEquityCurveProps) {
  if (series.length < 2) {
    return <div className={styles.emptyState}>Equity curve icin yeterli veri yok.</div>;
  }

  const width = 920;
  const height = 300;
  const padding = 28;
  const values = series.map((point) => point.equity);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valuePadding = Math.max((maxValue - minValue) * 0.15, maxValue * 0.02, 1);
  const chartMin = minValue - valuePadding;
  const chartMax = maxValue + valuePadding;
  const points = buildCoordinates(values, chartMin, chartMax, width, height, padding);
  const totalReturn =
    series[0]?.equity === 0
      ? 0
      : ((series.at(-1)?.equity ?? 0) / series[0].equity - 1) * 100;
  const xLabels = Array.from(
    new Set([
      series[0]?.date,
      series[Math.floor(series.length / 3)]?.date,
      series[Math.floor((series.length * 2) / 3)]?.date,
      series.at(-1)?.date,
    ].filter(Boolean)),
  ) as string[];

  return (
    <div className={styles.equityCurveFrame}>
      <div className={styles.equityCurveMeta}>
        <div>
          <p className={styles.metaLabel}>Equity curve</p>
          <div className={styles.equityCurveValue}>
            {formatCurrency(series.at(-1)?.equity ?? 0, currency)}
          </div>
        </div>
        <p className={styles.metaSubtle}>
          Donem getirisi:{" "}
          <span className={totalReturn >= 0 ? styles.positive : styles.negative}>
            {formatPercent(totalReturn)}
          </span>
        </p>
      </div>

      <div className={styles.equityCurveCanvas}>
        <svg
          className={styles.equityCurveSvg}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Backtest equity curve"
        >
          {[0, 1, 2, 3].map((row) => {
            const y = padding + ((height - padding * 2) * row) / 3;

            return (
              <line
                key={row}
                x1={padding}
                x2={width - padding}
                y1={y}
                y2={y}
                className={styles.equityCurveGrid}
              />
            );
          })}

          <path d={toArea(points, height, padding)} className={styles.equityCurveArea} />
          <polyline points={toPolyline(points)} className={styles.equityCurveLine} />
        </svg>
      </div>

      <div className={styles.axisLabels}>
        {xLabels.map((label) => (
          <span key={label}>{formatDateLabel(label)}</span>
        ))}
      </div>
    </div>
  );
}
