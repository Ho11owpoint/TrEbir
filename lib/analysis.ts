import { getLatestIndicatorSet } from "./indicators";
import type { Candle, IndicatorSet, Signal } from "./types";

export function round(value: number, digits = 2) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function analyzeSeries(series: Candle[]): {
  indicators: IndicatorSet;
  signal: Signal;
} {
  const closes = series.map((candle) => candle.close);
  const latestPrice = closes.at(-1) ?? 0;
  const indicators = getLatestIndicatorSet(series);
  const {
    sma20,
    sma50,
    rsi14,
    momentum21,
    volatility21,
  } = indicators;

  let score = 50;
  const reasons: string[] = [];

  if (sma20 !== null) {
    if (latestPrice >= sma20) {
      score += 12;
      reasons.push("Fiyat 20 gunluk ortalamanin ustunde; kisa vade trend destekleyici.");
    } else {
      score -= 12;
      reasons.push("Fiyat 20 gunluk ortalamanin altinda; tempo zayifliyor.");
    }
  }

  if (sma20 !== null && sma50 !== null) {
    if (sma20 >= sma50) {
      score += 10;
      reasons.push("20 gunluk ortalama 50 gunlugun ustunde; orta vade yapi yapici.");
    } else {
      score -= 10;
      reasons.push("20 gunluk ortalama 50 gunlugun altina kaymis; dikkat gerekli.");
    }
  }

  if (momentum21 !== null) {
    if (momentum21 >= 7) {
      score += 12;
      reasons.push("Son bir ayda ivme belirgin sekilde pozitif.");
    } else if (momentum21 >= 3) {
      score += 6;
      reasons.push("Son bir ay fiyat hareketi pozitife donuk.");
    } else if (momentum21 <= -7) {
      score -= 12;
      reasons.push("Son bir ayda ciddi momentum kaybi var.");
    } else if (momentum21 <= -3) {
      score -= 6;
      reasons.push("Son bir ay zayif performans; teyit beklemek mantikli.");
    }
  }

  if (rsi14 !== null) {
    if (rsi14 >= 50 && rsi14 <= 65) {
      score += 8;
      reasons.push("RSI 14 dengeli bir guc bolgesinde.");
    } else if (rsi14 > 70) {
      score -= 6;
      reasons.push("RSI 14 yuksek; kisa vadede yorulma riski var.");
    } else if (rsi14 < 35) {
      score -= 4;
      reasons.push("RSI 14 zayif; toparlanma gorulmeden risk yuksek.");
    }
  }

  if (volatility21 !== null) {
    if (volatility21 <= 25) {
      score += 4;
      reasons.push("Volatilite kontrol edilebilir seviyede.");
    } else if (volatility21 >= 50) {
      score -= 8;
      reasons.push("Volatilite yuksek; pozisyon boyutu kucultulmeli.");
    }
  }

  const recentHigh = series.slice(-20).reduce((high, candle) => Math.max(high, candle.high), 0);
  const recentLow = series
    .slice(-20)
    .reduce((low, candle) => (low === 0 ? candle.low : Math.min(low, candle.low)), 0);

  if (recentHigh > 0 && latestPrice >= recentHigh * 0.98) {
    score += 6;
    reasons.push("Fiyat son 20 gunun ust bandina yakin; momentum korunuyor.");
  }

  if (recentLow > 0 && latestPrice <= recentLow * 1.04) {
    score -= 6;
    reasons.push("Fiyat son 20 gunun alt bandina yakin; savunmaci olunmali.");
  }

  score = clamp(score, 0, 100);

  const action: Signal["action"] = score >= 65 ? "buy" : score <= 40 ? "reduce" : "hold";
  const label =
    score >= 75
      ? "Guclu kurgu"
      : score >= 65
        ? "Yapici gorunum"
        : score >= 45
          ? "Izle / notr"
          : "Savunmaci";

  return {
    indicators,
    signal: {
      score,
      action,
      label,
      reasons: reasons.slice(0, 4),
    },
  };
}
