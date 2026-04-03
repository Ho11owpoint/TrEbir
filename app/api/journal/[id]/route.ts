import { NextRequest, NextResponse } from "next/server";

import { updateTradeJournalEntry } from "@/lib/portfolio";
import type { TradeJournalUpdatePayload } from "@/lib/types";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const payload = (await request.json()) as TradeJournalUpdatePayload;
    const entry = await updateTradeJournalEntry(id, payload);

    return NextResponse.json(entry);
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Trade journal kaydi guncellenemedi.",
      },
      { status: 400 },
    );
  }
}
