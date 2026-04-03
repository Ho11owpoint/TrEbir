import { type NextRequest, NextResponse } from "next/server";

import { createAlertRule, getAlertCenter } from "@/lib/alerts";
import type { AlertCreatePayload } from "@/lib/types";

export async function GET() {
  try {
    const response = await getAlertCenter();
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Alarm listesi olusturulamadi.",
      },
      { status: 400 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as AlertCreatePayload;
    const rule = await createAlertRule(payload);
    return NextResponse.json(rule);
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Alarm kurali olusturulamadi.",
      },
      { status: 400 },
    );
  }
}
