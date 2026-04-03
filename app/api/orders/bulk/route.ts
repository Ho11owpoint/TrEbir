import { NextRequest, NextResponse } from "next/server";

import { placeBulkBuy } from "@/lib/portfolio";
import type { BulkOrderPayload } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as BulkOrderPayload;

    if (!Array.isArray(body.items)) {
      return NextResponse.json(
        { message: "Sepet verisi gecersiz." },
        { status: 400 },
      );
    }

    const result = await placeBulkBuy(body);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Sepet satin alinamadi.",
      },
      { status: 400 },
    );
  }
}
