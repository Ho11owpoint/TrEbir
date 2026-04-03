import "server-only";

import { inflateRawSync } from "node:zlib";

import type {
  CompanyEventProvider,
  CompanyEventProviderInput,
  CompanyEventType,
  EventRiskLevel,
  NormalizedCompanyEvent,
} from "../types";

const KAP_BATCH_NEWS_BASE_URL = "https://www.kap.org.tr/tr/api/batch-news/file-by-year";
const DAY_MS = 24 * 60 * 60 * 1000;
const PROVIDER_CACHE_TTL_MS = 45 * 60 * 1000;
const MAX_FORWARD_EVENT_WINDOW_DAYS = 120;
const DEFAULT_SOURCE_LABEL = "KAP";

interface DisclosureBlock {
  title: string;
  publishedAt: string;
  disclosureClass: string | null;
  html: string;
  summary: string;
  sourceUrl: string;
  rawDateValues: string[];
}

const providerCache = new Map<
  string,
  {
    expiresAt: number;
    promise: Promise<string>;
  }
>();

const RELEVANT_DISCLOSURE_KEYWORDS = [
  "basvuru",
  "izin",
  "onay",
  "yatirim",
  "ortaklik",
  "sozlesme",
  "dava",
  "sorusturma",
  "kredi",
  "birlesme",
  "bolunme",
  "alis",
  "satis",
  "faaliyet",
  "ihrac",
  "ihale",
];

const HIGH_RISK_KEYWORDS = [
  "tedbir",
  "islem yasagi",
  "seans durdurma",
  "islem sirasi kapatma",
  "temerrut",
  "iflas",
  "konkordato",
  "sorusturma",
  "dava",
  "olagan disi",
  "sermaye azaltimi",
];

const MEDIUM_RISK_KEYWORDS = [
  "genel kurul",
  "finansal rapor",
  "kar payi",
  "temettu",
  "geri alim",
  "pazar degisikligi",
  "hak kullanimi",
  "sermaye artirimi",
];

const DATE_LABELS: Partial<Record<CompanyEventType, string[]>> = {
  dividend: [
    "nakit odeme tarihi",
    "kar payi dagitim tarihi",
    "kar payi dagitim tarihi 1",
    "kullanim tarihi",
  ],
  general_assembly: ["genel kurul tarihi", "genel kurul tarihi ve saati"],
  rights_issue: [
    "ruchan hakki kullanim baslangic tarihi",
    "ruchan hakki kupon pazari tarihi",
    "yeni pay alma hakki kullanim baslangic tarihi",
  ],
  bonus_issue: [
    "bedelsiz pay alma hakki kullanim baslangic tarihi",
    "kullanim baslangic tarihi",
  ],
  market_notice: ["hak kullanimi tarihi", "islem gormeye baslama tarihi"],
};

function normalizeForMatch(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[ıİ]/g, "i")
    .replace(/[öÖ]/g, "o")
    .replace(/[şŞ]/g, "s")
    .replace(/[üÜ]/g, "u");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    )
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function repairMojibake(value: string) {
  if (!/[ÃÅÄ][^<>\s]?/.test(value)) {
    return value;
  }

  return Buffer.from(value, "latin1").toString("utf8");
}

function stripHtml(value: string) {
  return repairMojibake(
    decodeHtmlEntities(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<\/td>/gi, " ")
      .replace(/<[^>]+>/g, " "),
    )
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{2,}/g, "\n")
      .trim(),
  );
}

function parseTurkishDate(rawValue: string) {
  const match = rawValue.match(
    /(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/,
  );

  if (!match) {
    return null;
  }

  const [, day, month, year, hour, minute, second] = match;
  const hours = Number(hour ?? "12");
  const minutes = Number(minute ?? "0");
  const seconds = Number(second ?? "0");
  const timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    hours,
    minutes,
    seconds,
  );

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trim()}...`;
}

function extractSummary(title: string, html: string) {
  const text = stripHtml(html);
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        line !== title &&
        !line.startsWith("Gonderim Tarihi") &&
        !line.startsWith("Bildirim Tipi") &&
        !line.startsWith("Yil") &&
        !line.startsWith("Periyot"),
    );

  const firstMeaningfulLine =
    lines.find((line) => line.length >= 36 && !/^https?:\/\//i.test(line)) ??
    lines.find((line) => line.length >= 18) ??
    title;

  return truncate(firstMeaningfulLine, 220);
}

function buildCompanyUrl(kapMemberOid: string) {
  return `https://www.kap.org.tr/tr/sirket-bilgileri/ozet/${kapMemberOid}`;
}

function extractSourceUrl(html: string, kapMemberOid: string) {
  return (
    html.match(/https:\/\/www\.kap\.org\.tr\/tr\/Bildirim\/\d+/i)?.[0] ??
    buildCompanyUrl(kapMemberOid)
  );
}

function findEndOfCentralDirectory(buffer: Buffer) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }

  throw new Error("KAP zip sonlandirma kaydi bulunamadi.");
}

function extractFirstZipEntry(buffer: Buffer) {
  const endOfCentralDirectoryOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(endOfCentralDirectoryOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(endOfCentralDirectoryOffset + 16);

  for (let entryIndex = 0, offset = centralDirectoryOffset; entryIndex < entryCount; entryIndex += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      break;
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer
      .subarray(offset + 46, offset + 46 + fileNameLength)
      .toString("utf8");

    const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const compressedContent = buffer.subarray(dataStart, dataStart + compressedSize);

    let content: Buffer;
    if (compressionMethod === 0) {
      content = compressedContent;
    } else if (compressionMethod === 8) {
      content = inflateRawSync(compressedContent);
    } else {
      throw new Error(`KAP zip sikistirma tipi desteklenmiyor (${compressionMethod}).`);
    }

    if (fileName.toLocaleLowerCase("tr-TR").endsWith(".doc")) {
      return repairMojibake(content.toString("utf8"));
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  throw new Error("KAP zip icinde parse edilebilir belge bulunamadi.");
}

async function fetchYearlyNewsDocument(kapMemberOid: string, year: number) {
  const cacheKey = `${kapMemberOid}:${year}`;
  const now = Date.now();
  const cached = providerCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = (async () => {
    const response = await fetch(`${KAP_BATCH_NEWS_BASE_URL}/${kapMemberOid}/${year}`, {
      cache: "no-store",
      headers: {
        Accept: "application/octet-stream,*/*",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      throw new Error(`KAP batch news alinamadi (${response.status}).`);
    }

    const zipBuffer = Buffer.from(await response.arrayBuffer());
    return extractFirstZipEntry(zipBuffer);
  })().catch((error) => {
    providerCache.delete(cacheKey);
    throw error;
  });

  providerCache.set(cacheKey, {
    expiresAt: now + PROVIDER_CACHE_TTL_MS,
    promise,
  });

  return promise;
}

function parseDisclosureBlocks(html: string, kapMemberOid: string) {
  const blocks: DisclosureBlock[] = [];
  const pattern = /<h1[^>]*>([\s\S]*?)<\/h1>([\s\S]*?)(?=<h1[^>]*>|<\/body>)/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    const title = stripHtml(match[1] ?? "");
    const bodyHtml = match[2] ?? "";
    const publishedAtRaw =
      bodyHtml.match(/G(?:ö|o)nderim Tarihi:\s*([0-9]{2}\.[0-9]{2}\.[0-9]{4}\s+[0-9]{2}:[0-9]{2}:[0-9]{2})/i)?.[1] ??
      null;

    if (!title || !publishedAtRaw) {
      continue;
    }

    const publishedAt = parseTurkishDate(publishedAtRaw);

    if (!publishedAt) {
      continue;
    }

    const rawDateValues = [...new Set(bodyHtml.match(/\b\d{2}\.\d{2}\.\d{4}(?:\s+\d{2}:\d{2}:\d{2})?\b/g) ?? [])];
    const disclosureClass =
      bodyHtml.match(/Bildirim Tipi:\s*([A-ZÇĞİÖŞÜ]+)/i)?.[1]?.trim() ?? null;

    blocks.push({
      title,
      publishedAt,
      disclosureClass,
      html: bodyHtml,
      summary: extractSummary(title, bodyHtml),
      sourceUrl: extractSourceUrl(bodyHtml, kapMemberOid),
      rawDateValues,
    });
  }

  return blocks;
}

function classifyEventType(title: string, summary: string): CompanyEventType {
  const value = normalizeForMatch(`${title} ${summary}`);

  if (
    value.includes("islem sirasi kapatma") ||
    value.includes("seans durdurma") ||
    value.includes("islem yasagi") ||
    value.includes("tedbir karari") ||
    value.includes("temerrut")
  ) {
    return "trading_halt";
  }

  if (value.includes("geri alim")) {
    return "buyback";
  }

  if (value.includes("genel kurul")) {
    return "general_assembly";
  }

  if (value.includes("kar payi") || value.includes("temettu") || value.includes("nakit odeme")) {
    return "dividend";
  }

  if (value.includes("bedelsiz") || value.includes("ic kaynaklardan")) {
    return "bonus_issue";
  }

  if (
    value.includes("ruchan") ||
    value.includes("bedelli") ||
    value.includes("yeni pay alma") ||
    value.includes("sermaye artirimi")
  ) {
    return "rights_issue";
  }

  if (
    value.includes("finansal rapor") ||
    value.includes("finansal sonuc") ||
    value.includes("sorumluluk beyani")
  ) {
    return "earnings";
  }

  if (
    value.includes("bistech") ||
    value.includes("borsa duyurusu") ||
    value.includes("pazar degisikligi") ||
    value.includes("hak kullanimi") ||
    value.includes("islem gormeye baslamasi")
  ) {
    return "market_notice";
  }

  return "important_disclosure";
}

function isRelevantDisclosure(type: CompanyEventType, title: string, summary: string) {
  if (type !== "important_disclosure") {
    return true;
  }

  const value = normalizeForMatch(`${title} ${summary}`);
  return RELEVANT_DISCLOSURE_KEYWORDS.some((keyword) => value.includes(keyword));
}

function extractLabeledDate(type: CompanyEventType, html: string) {
  const labels = DATE_LABELS[type] ?? [];

  for (const label of labels) {
    const pattern = new RegExp(
      `${escapeRegExp(label)}[\\s\\S]{0,220}?(\\d{2}\\.\\d{2}\\.\\d{4}(?:\\s+\\d{2}:\\d{2}:\\d{2})?)`,
      "i",
    );
    const match = html.match(pattern)?.[1];

    if (match) {
      const parsed = parseTurkishDate(match);

      if (parsed) {
        return parsed;
      }
    }
  }

  return null;
}

function extractEventDate(
  type: CompanyEventType,
  block: DisclosureBlock,
) {
  const labeledDate = extractLabeledDate(type, block.html);

  if (labeledDate) {
    return labeledDate;
  }

  const publishedAtMs = Date.parse(block.publishedAt);
  const upperBoundMs = publishedAtMs + MAX_FORWARD_EVENT_WINDOW_DAYS * DAY_MS;
  const candidateDates = block.rawDateValues
    .map(parseTurkishDate)
    .filter((value): value is string => value !== null)
    .map((value) => Date.parse(value))
    .filter(
      (value) =>
        Number.isFinite(value) && value > publishedAtMs + 60 * 60 * 1000 && value <= upperBoundMs,
    )
    .sort((left, right) => left - right);

  if (candidateDates.length === 0) {
    return null;
  }

  return new Date(candidateDates[0] as number).toISOString();
}

function escalateRisk(risk: EventRiskLevel) {
  if (risk === "low") {
    return "medium";
  }

  return "high";
}

function determineRiskLevel(
  type: CompanyEventType,
  title: string,
  summary: string,
  publishedAt: string,
  eventDate: string | null,
) {
  let risk: EventRiskLevel =
    type === "trading_halt" || type === "rights_issue"
      ? "high"
      : type === "earnings" ||
          type === "bonus_issue" ||
          type === "general_assembly" ||
          type === "market_notice" ||
          type === "important_disclosure"
        ? "medium"
        : "low";

  const combined = normalizeForMatch(`${title} ${summary}`);

  if (HIGH_RISK_KEYWORDS.some((keyword) => combined.includes(keyword))) {
    risk = "high";
  } else if (MEDIUM_RISK_KEYWORDS.some((keyword) => combined.includes(keyword)) && risk === "low") {
    risk = "medium";
  }

  const referenceDate = eventDate ?? publishedAt;
  const daysFromNow = Math.floor((Date.parse(referenceDate) - Date.now()) / DAY_MS);

  if (eventDate && daysFromNow >= 0 && daysFromNow <= 3 && risk !== "high") {
    risk = escalateRisk(risk);
  }

  if (!eventDate && daysFromNow >= -2 && risk === "medium") {
    risk = "high";
  }

  return risk;
}

function buildTiming(eventDate: string | null) {
  if (!eventDate) {
    return "recent";
  }

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  return Date.parse(eventDate) >= todayStart.getTime() ? "upcoming" : "recent";
}

function toNormalizedEvent(
  input: CompanyEventProviderInput,
  block: DisclosureBlock,
) {
  const type = classifyEventType(block.title, block.summary);

  if (!isRelevantDisclosure(type, block.title, block.summary)) {
    return null;
  }

  const eventDate = extractEventDate(type, block);
  const riskLevel = determineRiskLevel(
    type,
    block.title,
    block.summary,
    block.publishedAt,
    eventDate,
  );
  const timing = buildTiming(eventDate);

  return {
    id: `${input.symbol}:${block.publishedAt}:${normalizeForMatch(block.title).replace(/\s+/g, "-")}`,
    symbol: input.symbol,
    displaySymbol: input.displaySymbol,
    companyName: input.companyName,
    provider: "kap_batch_news",
    type,
    riskLevel,
    timing,
    title: block.title,
    summary: block.summary,
    publishedAt: block.publishedAt,
    eventDate,
    disclosureClass: block.disclosureClass,
    sourceUrl: block.sourceUrl,
    sourceLabel: DEFAULT_SOURCE_LABEL,
    tags: [...new Set([type, riskLevel, timing])],
    rawDateValues: block.rawDateValues,
  } satisfies NormalizedCompanyEvent;
}

async function getYearlyEvents(input: CompanyEventProviderInput, year: number) {
  if (!input.kapMemberOid) {
    return [];
  }

  try {
    const documentHtml = await fetchYearlyNewsDocument(input.kapMemberOid, year);
    return parseDisclosureBlocks(documentHtml, input.kapMemberOid)
      .map((block) => toNormalizedEvent(input, block))
      .filter((event): event is NonNullable<typeof event> => event !== null);
  } catch {
    return [];
  }
}

function dedupeEvents(events: NormalizedCompanyEvent[]) {
  const map = new Map<string, NormalizedCompanyEvent>();

  for (const event of events) {
    map.set(`${event.title}:${event.publishedAt}`, event);
  }

  return [...map.values()];
}

export const kapBatchNewsProvider: CompanyEventProvider = {
  name: "kap_batch_news",
  async getEvents(input) {
    if (!input.kapMemberOid) {
      return [];
    }

    const currentYear = new Date().getUTCFullYear();
    const currentYearEvents = await getYearlyEvents(input, currentYear);
    const shouldLoadPreviousYear =
      currentYearEvents.length === 0 || new Date().getUTCMonth() <= 1;
    const previousYearEvents = shouldLoadPreviousYear
      ? await getYearlyEvents(input, currentYear - 1)
      : [];

    return dedupeEvents([...currentYearEvents, ...previousYearEvents]).sort((left, right) => {
      const leftTime = Date.parse(left.eventDate ?? left.publishedAt);
      const rightTime = Date.parse(right.eventDate ?? right.publishedAt);
      return rightTime - leftTime;
    });
  },
};
