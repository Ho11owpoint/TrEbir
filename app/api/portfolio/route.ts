import { NextResponse } from "next/server";

import { getPortfolio } from "@/lib/portfolio";

export async function GET() {
  try {
    const portfolio = await getPortfolio();
    return NextResponse.json(portfolio);
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Portfoy verisi okunamadi.",
      },
      { status: 500 },
    );
  }
}
