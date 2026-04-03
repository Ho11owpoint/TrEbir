import { NextRequest, NextResponse } from "next/server";

import { getPortfolioHistory } from "@/lib/portfolio";

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
    const history = await getPortfolioHistory(days);

    return NextResponse.json(history);
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Portfoy history verisi okunamadi.",
      },
      { status: 400 },
    );
  }
}
