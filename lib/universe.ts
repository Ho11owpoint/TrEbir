import "server-only";

import type { UniverseCompany } from "./types";

const KAP_BIST_COMPANIES_URL = "https://www.kap.org.tr/tr/bist-sirketler";
const UNIVERSE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let cachedUniverse:
  | {
      expiresAt: number;
      data: UniverseCompany[];
    }
  | undefined;

function decodeEscapedValue(value: string) {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, code: string) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    )
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

export async function getBistUniverse() {
  const now = Date.now();

  if (cachedUniverse && cachedUniverse.expiresAt > now) {
    return cachedUniverse.data;
  }

  const response = await fetch(KAP_BIST_COMPANIES_URL, {
    cache: "no-store",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`BIST hisse evreni alinamadi (${response.status}).`);
  }

  const html = await response.text();
  const pattern =
    /\\\"mkkMemberOid\\\":\\\"([^\\"]+)\\\".*?\\\"kapMemberTitle\\\":\\\"([^\\"]+)\\\".*?\\\"stockCode\\\":\\\"([^\\"]+)\\\".*?\\\"cityName\\\":\\\"([^\\"]*)\\\".*?\\\"kapMemberType\\\":\\\"IGS\\\"/g;
  const map = new Map<string, UniverseCompany>();
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    const rawSymbol = match[3]?.trim().toUpperCase();

    if (!rawSymbol) {
      continue;
    }

    map.set(rawSymbol, {
      symbol: `${rawSymbol}.IS`,
      displaySymbol: rawSymbol,
      companyName: decodeEscapedValue(match[2] ?? rawSymbol),
      city: decodeEscapedValue(match[4] ?? ""),
      exchange: "BIST",
      kapMemberOid: decodeEscapedValue(match[1] ?? ""),
      sector: null,
    });
  }

  const data = [...map.values()].sort((left, right) =>
    left.displaySymbol.localeCompare(right.displaySymbol, "tr"),
  );

  if (data.length === 0) {
    throw new Error("BIST hisse evreni ayristrilamadi.");
  }

  cachedUniverse = {
    expiresAt: now + UNIVERSE_CACHE_TTL_MS,
    data,
  };

  return data;
}
