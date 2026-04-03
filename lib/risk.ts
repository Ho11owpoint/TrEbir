import { round } from "./analysis";
import type { PositionPlan } from "./types";

interface PositionPlanInput {
  price: number;
  atr14: number | null;
  equity: number;
  cash: number;
}

export function suggestPositionPlan({
  price,
  atr14,
  equity,
  cash,
}: PositionPlanInput): PositionPlan {
  if (!Number.isFinite(price) || price <= 0) {
    return {
      stopDistance: 0,
      stopLoss: 0,
      riskBudget: 0,
      capitalCap: 0,
      shares: 0,
      positionValue: 0,
    };
  }

  const atrDistance = atr14 && atr14 > 0 ? atr14 * 1.5 : 0;
  const stopDistance = Math.max(atrDistance, price * 0.03);
  const riskBudget = Math.max(equity * 0.01, 0);
  const capitalCap = Math.max(Math.min(cash, equity * 0.2), 0);
  const sharesByRisk = stopDistance > 0 ? riskBudget / stopDistance : 0;
  const sharesByCapital = capitalCap > 0 ? capitalCap / price : 0;
  const shares = Math.max(Math.min(sharesByRisk, sharesByCapital), 0);
  const positionValue = shares * price;

  return {
    stopDistance: round(stopDistance, 2),
    stopLoss: round(Math.max(price - stopDistance, 0), 2),
    riskBudget: round(riskBudget, 2),
    capitalCap: round(capitalCap, 2),
    shares: round(shares, 4),
    positionValue: round(positionValue, 2),
  };
}
