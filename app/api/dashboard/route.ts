import { NextRequest, NextResponse } from "next/server";

import { getDashboard } from "@/lib/market";

export async function GET(request: NextRequest) {
  const rawSymbols = request.nextUrl.searchParams.get("symbols") ?? "";
  const symbols = rawSymbols
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  try {
    const dashboard = await getDashboard(symbols);
    return NextResponse.json(dashboard);
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Panel verisi olusturulamadi.",
      },
      { status: 500 },
    );
  }
}
