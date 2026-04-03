import { NextRequest, NextResponse } from "next/server";

import { deleteAlertRule } from "@/lib/alerts";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    await deleteAlertRule(id);

    return NextResponse.json({
      ok: true,
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Alarm kurali silinemedi.",
      },
      { status: 400 },
    );
  }
}
