import { NextRequest, NextResponse } from "next/server";

import { buildPortfolioAnalytics } from "@/lib/portfolio-analytics";
import { getPortfolioAnalyticsInput } from "@/lib/portfolio";
import { getBistUniverse } from "@/lib/universe";

function parseDays(value: string | null) {
  if (!value) {
    return 180;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 7 || parsed > 750) {
    throw new Error("days parametresi 7 ile 750 arasinda tam sayi olmali.");
  }

  return parsed;
}

export async function GET(request: NextRequest) {
  try {
    const days = parseDays(request.nextUrl.searchParams.get("days"));
    const [{ portfolio, history }, companies] = await Promise.all([
      getPortfolioAnalyticsInput(days),
      getBistUniverse(),
    ]);
    const analytics = buildPortfolioAnalytics(portfolio, history, companies);

    return NextResponse.json(analytics);
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Portfoy analytics verisi olusturulamadi.",
      },
      { status: 400 },
    );
  }
}
