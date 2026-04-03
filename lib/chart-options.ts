import type { EChartsOption } from "echarts";

import { formatCurrency, formatNumber, formatPercent } from "./format";
import type {
  ChartRangeKey,
  MarketContext,
  StockChartResponse,
} from "./types";

interface TradingChartOptionState {
  showAtr: boolean;
  showRsi: boolean;
  showSma20: boolean;
  showSma50: boolean;
}

function formatRangeLabel(isoLabel: string, range: ChartRangeKey) {
  const date = new Date(isoLabel);

  if (range === "1d" || range === "5d") {
    return new Intl.DateTimeFormat("tr-TR", {
      day: range === "5d" ? "2-digit" : undefined,
      month: range === "5d" ? "short" : undefined,
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  if (range === "1y" || range === "max") {
    return new Intl.DateTimeFormat("tr-TR", {
      month: "short",
      year: "2-digit",
    }).format(date);
  }

  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "short",
  }).format(date);
}

function formatTooltipDate(isoLabel: string, range: ChartRangeKey) {
  const date = new Date(isoLabel);

  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: range === "1d" || range === "5d" ? "short" : undefined,
  }).format(date);
}

function buildForecastArrays(chartData: StockChartResponse, categoryCount: number) {
  const base = new Array<number | string>(categoryCount).fill("-");
  const bull = new Array<number | string>(categoryCount).fill("-");
  const bear = new Array<number | string>(categoryCount).fill("-");
  const lowerBand = new Array<number | string>(categoryCount).fill("-");
  const bandRange = new Array<number | string>(categoryCount).fill("-");

  if (!chartData.forecast || chartData.forecast.points.length === 0) {
    return {
      bandRange,
      base,
      bear,
      bull,
      lowerBand,
    };
  }

  const anchorIndex = chartData.series.length - 1;
  base[anchorIndex] = chartData.forecast.anchorPrice;
  bull[anchorIndex] = chartData.forecast.anchorPrice;
  bear[anchorIndex] = chartData.forecast.anchorPrice;
  lowerBand[anchorIndex] = chartData.forecast.anchorPrice;
  bandRange[anchorIndex] = 0;

  chartData.forecast.points.forEach((point, index) => {
    const targetIndex = chartData.series.length + index;
    base[targetIndex] = point.basePrice;
    bull[targetIndex] = point.bullPrice;
    bear[targetIndex] = point.bearPrice;
    lowerBand[targetIndex] = point.lowerBand ?? point.bearPrice;
    bandRange[targetIndex] =
      point.upperBand !== null && point.lowerBand !== null
        ? Math.max(point.upperBand - point.lowerBand, 0)
        : 0;
  });

  return {
    bandRange,
    base,
    bear,
    bull,
    lowerBand,
  };
}

function regimeColor(trend: MarketContext["trend"] | null | undefined) {
  if (trend === "risk-on") {
    return "#37c08d";
  }

  if (trend === "risk-off") {
    return "#ff6b6b";
  }

  return "#9fb0c4";
}

export function buildTradingChartOption(
  chartData: StockChartResponse,
  range: ChartRangeKey,
  state: TradingChartOptionState,
  benchmark: MarketContext | null,
): EChartsOption {
  const historyCategories = chartData.series.map((candle) => candle.label);
  const futureCategories = chartData.forecast?.points.map((point) => point.label) ?? [];
  const categories = [...historyCategories, ...futureCategories];
  const candleData = [
    ...chartData.series.map((candle) => [candle.open, candle.close, candle.low, candle.high]),
    ...futureCategories.map(() => [Number.NaN, Number.NaN, Number.NaN, Number.NaN]),
  ];
  const volumeData = [
    ...chartData.series.map((candle) => candle.volume),
    ...futureCategories.map(() => "-"),
  ];
  const sma20Data = [
    ...chartData.overlays.sma20.map((point) => point.value ?? "-"),
    ...futureCategories.map(() => "-"),
  ];
  const sma50Data = [
    ...chartData.overlays.sma50.map((point) => point.value ?? "-"),
    ...futureCategories.map(() => "-"),
  ];
  const atrData = [
    ...chartData.overlays.atr14.map((point) => point.value ?? "-"),
    ...futureCategories.map(() => "-"),
  ];
  const rsiData = [
    ...chartData.overlays.rsi14.map((point) => point.value ?? "-"),
    ...futureCategories.map(() => "-"),
  ];
  const forecastArrays = buildForecastArrays(chartData, categories.length);
  const showRsi = state.showRsi;
  const xAxisIndices = showRsi ? [0, 1, 2] : [0, 1];
  const volumeGridTop = showRsi ? "69%" : "77%";
  const volumeGridHeight = showRsi ? "10%" : "12%";
  const formatAxisValue = (value: string | number) => formatRangeLabel(String(value), range);

  return {
    animation: false,
    backgroundColor: "transparent",
    grid: [
      {
        left: 18,
        right: 68,
        top: 54,
        height: showRsi ? "54%" : "64%",
      },
      {
        left: 18,
        right: 68,
        top: volumeGridTop,
        height: volumeGridHeight,
      },
      ...(showRsi
        ? [
            {
              left: 18,
              right: 68,
              top: "83%",
              height: "11%",
            },
          ]
        : []),
    ],
    axisPointer: {
      link: [
        {
          xAxisIndex: xAxisIndices,
        },
      ],
      label: {
        backgroundColor: "#101722",
      },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "cross",
      },
      backgroundColor: "rgba(7, 12, 19, 0.96)",
      borderColor: "rgba(125, 145, 171, 0.28)",
      borderWidth: 1,
      textStyle: {
        color: "#e7edf5",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
      },
      extraCssText:
        "backdrop-filter: blur(14px); border-radius: 14px; box-shadow: 0 18px 40px rgba(0,0,0,0.35);",
      formatter: (params) => {
        const entries = Array.isArray(params) ? params : [params];
        const dataIndex = Number(entries[0]?.dataIndex ?? 0);

        if (dataIndex < chartData.series.length) {
          const candle = chartData.series[dataIndex];
          const sma20 = chartData.overlays.sma20[dataIndex]?.value;
          const sma50 = chartData.overlays.sma50[dataIndex]?.value;
          const atr14 = chartData.overlays.atr14[dataIndex]?.value;
          const rsi14 = chartData.overlays.rsi14[dataIndex]?.value;
          const changePercent =
            candle.open === 0 ? 0 : ((candle.close / candle.open) - 1) * 100;

          return [
            `<div style="display:grid;gap:8px;min-width:230px;">`,
            `<strong style="font-size:13px;color:#f4f7fb;">${formatTooltipDate(candle.label, range)}</strong>`,
            `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;">`,
            `<span style="color:#8ea1b8;">Open</span><strong>${formatCurrency(candle.open, chartData.currency)}</strong>`,
            `<span style="color:#8ea1b8;">High</span><strong>${formatCurrency(candle.high, chartData.currency)}</strong>`,
            `<span style="color:#8ea1b8;">Low</span><strong>${formatCurrency(candle.low, chartData.currency)}</strong>`,
            `<span style="color:#8ea1b8;">Close</span><strong>${formatCurrency(candle.close, chartData.currency)}</strong>`,
            `<span style="color:#8ea1b8;">Day</span><strong style="color:${changePercent >= 0 ? "#48d597" : "#ff7c7c"};">${formatPercent(changePercent)}</strong>`,
            `<span style="color:#8ea1b8;">Volume</span><strong>${formatNumber(candle.volume, 0)}</strong>`,
            `</div>`,
            `<div style="display:flex;flex-wrap:wrap;gap:6px;">`,
            sma20 !== null
              ? `<span style="padding:4px 8px;border-radius:999px;background:rgba(88,162,255,0.14);color:#91beff;">SMA20 ${formatNumber(sma20)}</span>`
              : "",
            sma50 !== null
              ? `<span style="padding:4px 8px;border-radius:999px;background:rgba(243,186,90,0.14);color:#f3ba5a;">SMA50 ${formatNumber(sma50)}</span>`
              : "",
            atr14 !== null
              ? `<span style="padding:4px 8px;border-radius:999px;background:rgba(182,154,255,0.14);color:#c7b1ff;">ATR ${formatNumber(atr14)}</span>`
              : "",
            rsi14 !== null
              ? `<span style="padding:4px 8px;border-radius:999px;background:rgba(92,228,214,0.14);color:#6de8d7;">RSI ${formatNumber(rsi14)}</span>`
              : "",
            `</div>`,
            `</div>`,
          ].join("");
        }

        const forecastPoint = chartData.forecast?.points[dataIndex - chartData.series.length];

        if (!forecastPoint || !chartData.forecast) {
          return "";
        }

        return [
          `<div style="display:grid;gap:8px;min-width:230px;">`,
          `<strong style="font-size:13px;color:#f4f7fb;">${formatTooltipDate(forecastPoint.label, range)}</strong>`,
          `<div style="color:#8ea1b8;">Valid horizon bar ${forecastPoint.horizonIndex}/${chartData.forecast.validHorizonBars}</div>`,
          `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;">`,
          `<span style="color:#8ea1b8;">Base</span><strong>${formatCurrency(forecastPoint.basePrice, chartData.currency)}</strong>`,
          `<span style="color:#8ea1b8;">Bull</span><strong style="color:#57d39b;">${formatCurrency(forecastPoint.bullPrice, chartData.currency)}</strong>`,
          `<span style="color:#8ea1b8;">Bear</span><strong style="color:#ff7c7c;">${formatCurrency(forecastPoint.bearPrice, chartData.currency)}</strong>`,
          `<span style="color:#8ea1b8;">Band</span><strong>${formatCurrency(forecastPoint.lowerBand ?? forecastPoint.bearPrice, chartData.currency)} - ${formatCurrency(forecastPoint.upperBand ?? forecastPoint.bullPrice, chartData.currency)}</strong>`,
          `</div>`,
          `</div>`,
        ].join("");
      },
    },
    dataZoom: [
      {
        type: "inside",
        xAxisIndex: xAxisIndices,
        zoomOnMouseWheel: true,
        moveOnMouseMove: true,
        moveOnMouseWheel: true,
      },
      {
        type: "slider",
        xAxisIndex: xAxisIndices,
        height: 18,
        bottom: 6,
        borderColor: "rgba(255,255,255,0.06)",
        backgroundColor: "rgba(255,255,255,0.03)",
        fillerColor: "rgba(79, 139, 255, 0.15)",
        dataBackground: {
          areaStyle: {
            color: "rgba(90, 108, 132, 0.18)",
          },
          lineStyle: {
            color: "rgba(90, 108, 132, 0.45)",
          },
        },
        handleStyle: {
          color: "#98a8bc",
        },
        textStyle: {
          color: "#7e8da0",
        },
      },
    ],
    xAxis: [
      {
        type: "category" as const,
        data: categories,
        boundaryGap: true,
        axisLine: {
          lineStyle: {
            color: "rgba(255,255,255,0.08)",
          },
        },
        axisTick: {
          show: false,
        },
        splitLine: {
          show: false,
        },
        min: "dataMin",
        max: "dataMax",
        axisLabel: {
          show: false,
        },
      },
      {
        type: "category" as const,
        gridIndex: 1,
        data: categories,
        boundaryGap: true,
        axisLine: {
          lineStyle: {
            color: "rgba(255,255,255,0.08)",
          },
        },
        axisTick: {
          show: false,
        },
        splitLine: {
          show: false,
        },
        axisLabel: {
          show: !showRsi,
          color: "#8092a8",
          fontSize: 11,
          hideOverlap: true,
          margin: 10,
          formatter: formatAxisValue,
        },
      },
      ...(showRsi
        ? [
            {
              type: "category" as const,
              gridIndex: 2,
              data: categories,
              boundaryGap: true,
              axisLine: {
                lineStyle: {
                  color: "rgba(255,255,255,0.08)",
                },
              },
              axisTick: {
                show: false,
              },
              splitLine: {
                show: false,
              },
              axisLabel: {
                show: true,
                color: "#8092a8",
                fontSize: 11,
                hideOverlap: true,
                margin: 10,
                formatter: formatAxisValue,
              },
            },
          ]
        : []),
    ] as NonNullable<EChartsOption["xAxis"]>,
    yAxis: [
      {
        scale: true,
        position: "right",
        splitNumber: 6,
        axisLine: {
          show: false,
        },
        splitLine: {
          lineStyle: {
            color: "rgba(255,255,255,0.07)",
          },
        },
        axisLabel: {
          color: "#9aacbf",
          formatter: (value: number) => formatNumber(value, 2),
        },
      },
      {
        scale: true,
        position: "left",
        min: "dataMin",
        max: "dataMax",
        axisLine: {
          show: false,
        },
        splitLine: {
          show: false,
        },
        axisLabel: {
          show: state.showAtr,
          color: "#8d86ff",
          formatter: (value: number) => formatNumber(value, 2),
        },
      },
      {
        scale: true,
        gridIndex: 1,
        splitNumber: 2,
        axisLine: {
          show: false,
        },
        splitLine: {
          show: false,
        },
        axisLabel: {
          color: "#8092a8",
          formatter: (value: number) => formatNumber(value, 0),
        },
      },
      ...(showRsi
        ? [
            {
              scale: true,
              min: 0,
              max: 100,
              gridIndex: 2,
              splitNumber: 3,
              axisLine: {
                show: false,
              },
              splitLine: {
                lineStyle: {
                  color: "rgba(255,255,255,0.06)",
                },
              },
              axisLabel: {
                color: "#8092a8",
                formatter: (value: number) => formatNumber(value, 0),
              },
            },
          ]
        : []),
    ] as NonNullable<EChartsOption["yAxis"]>,
    series: [
      {
        name: "Price",
        type: "candlestick",
        data: candleData,
        itemStyle: {
          color: "#2ec27e",
          color0: "#eb5757",
          borderColor: "#5ce6a5",
          borderColor0: "#ff8e8e",
        },
        emphasis: {
          itemStyle: {
            borderWidth: 1.2,
          },
        },
      },
      ...(state.showSma20
        ? [
            {
              name: "SMA 20",
              type: "line",
              data: sma20Data,
              yAxisIndex: 0,
              symbol: "none",
              smooth: false,
              lineStyle: {
                color: "#58a2ff",
                width: 1.6,
              },
            },
          ]
        : []),
      ...(state.showSma50
        ? [
            {
              name: "SMA 50",
              type: "line",
              data: sma50Data,
              yAxisIndex: 0,
              symbol: "none",
              smooth: false,
              lineStyle: {
                color: "#f3ba5a",
                width: 1.6,
              },
            },
          ]
        : []),
      ...(state.showAtr
        ? [
            {
              name: "ATR 14",
              type: "line",
              data: atrData,
              yAxisIndex: 1,
              symbol: "none",
              smooth: false,
              lineStyle: {
                color: "#8d86ff",
                width: 1.4,
                opacity: 0.92,
              },
              areaStyle: {
                color: "rgba(141, 134, 255, 0.08)",
              },
            },
          ]
        : []),
      {
        name: "Forecast Lower",
        type: "line",
        data: forecastArrays.lowerBand,
        yAxisIndex: 0,
        symbol: "none",
        lineStyle: {
          opacity: 0,
        },
        stack: "forecast-band",
        tooltip: {
          show: false,
        },
      },
      {
        name: "Forecast Band",
        type: "line",
        data: forecastArrays.bandRange,
        yAxisIndex: 0,
        symbol: "none",
        lineStyle: {
          opacity: 0,
        },
        areaStyle: {
          color: "rgba(104, 175, 255, 0.12)",
        },
        stack: "forecast-band",
        tooltip: {
          show: false,
        },
      },
      {
        name: "Base Case",
        type: "line",
        data: forecastArrays.base,
        yAxisIndex: 0,
        symbol: "none",
        lineStyle: {
          color: "#d5e4ff",
          width: 2.1,
          type: "dashed",
        },
        markLine:
          chartData.forecast && chartData.forecast.points.length > 0
            ? {
                symbol: "none",
                label: {
                  show: true,
                  color: "#93a4ba",
                  formatter: "Forecast window",
                },
                lineStyle: {
                  color: "rgba(147, 164, 186, 0.22)",
                  type: "dashed",
                },
                data: [
                  {
                    xAxis: chartData.series.length - 1,
                  },
                  {
                    xAxis: categories.length - 1,
                  },
                ],
              }
            : undefined,
      },
      {
        name: "Bull Case",
        type: "line",
        data: forecastArrays.bull,
        yAxisIndex: 0,
        symbol: "none",
        lineStyle: {
          color: "#57d39b",
          width: 1.8,
          type: "dashed",
        },
      },
      {
        name: "Bear Case",
        type: "line",
        data: forecastArrays.bear,
        yAxisIndex: 0,
        symbol: "none",
        lineStyle: {
          color: "#ff7c7c",
          width: 1.8,
          type: "dashed",
        },
      },
      {
        name: "Volume",
        type: "bar",
        xAxisIndex: 1,
        yAxisIndex: 2,
        data: volumeData,
        barMaxWidth: 8,
        itemStyle: {
          color: (params: { dataIndex: number }) => {
            const candle = chartData.series[params.dataIndex];

            if (!candle) {
              return "rgba(128, 145, 166, 0.16)";
            }

            return candle.close >= candle.open
              ? "rgba(46, 194, 126, 0.48)"
              : "rgba(235, 87, 87, 0.48)";
          },
        },
      },
      ...(showRsi
        ? [
            {
              name: "RSI 14",
              type: "line",
              xAxisIndex: 2,
              yAxisIndex: 3,
              data: rsiData,
              symbol: "none",
              smooth: false,
              lineStyle: {
                color: "#5ce4d6",
                width: 1.6,
              },
              markLine: {
                symbol: "none",
                lineStyle: {
                  color: "rgba(255,255,255,0.16)",
                  type: "dashed",
                },
                label: {
                  show: false,
                },
                data: [
                  { yAxis: 30 },
                  { yAxis: 70 },
                ],
              },
              areaStyle: {
                color: "rgba(92, 228, 214, 0.07)",
              },
            },
          ]
        : []),
    ] as NonNullable<EChartsOption["series"]>,
    visualMap: {
      show: false,
    },
    toolbox: {
      show: false,
    },
    textStyle: {
      color: "#dce5f0",
    },
    title: {
      show: false,
    },
    graphic: benchmark
      ? [
          {
            type: "text",
            right: 16,
            top: 16,
            style: {
              text: benchmark.label,
              fill: regimeColor(benchmark.trend),
              font: "600 12px var(--font-mono)",
            },
          },
        ]
      : undefined,
  };
}
