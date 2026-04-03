import { NextRequest, NextResponse } from "next/server";

import { resetPortfolio } from "@/lib/portfolio";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      startingCash?: number;
    };
    const startingCash =
      typeof body.startingCash === "number" && body.startingCash > 0
        ? body.startingCash
        : undefined;
    const portfolio = await resetPortfolio(startingCash);

    return NextResponse.json({
      portfolio,
      message: "Demo portfoy sifirlandi.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Demo portfoy sifirlanamadi.",
      },
      { status: 400 },
    );
  }
}
