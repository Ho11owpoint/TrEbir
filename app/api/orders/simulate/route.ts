import { NextRequest, NextResponse } from "next/server";

import { simulateOrders } from "@/lib/portfolio";
import type { OrderSimulationPayload } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as OrderSimulationPayload;
    const result = await simulateOrders(body);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Bekleyen emirler simule edilemedi.",
      },
      { status: 400 },
    );
  }
}
