import { NextRequest, NextResponse } from "next/server";

import { placeOrder } from "@/lib/portfolio";
import type { OrderPayload } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as OrderPayload;

    if (!body.symbol || !body.side || (body.side !== "buy" && body.side !== "sell")) {
      return NextResponse.json(
        { message: "Sembol ve islem tipi zorunlu." },
        { status: 400 },
      );
    }

    const orderResult = await placeOrder(body);
    return NextResponse.json(orderResult);
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Emir olusturulamadi.",
      },
      { status: 400 },
    );
  }
}
