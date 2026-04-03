import "server-only";

import { round } from "./analysis";
import { kapBatchNewsProvider } from "./event-providers/kap-batch-news";
import { getBistUniverse } from "./universe";
import type {
  CompanyEventProvider,
  CompanyEventProviderInput,
  CompanyEventProviderStatus,
  EventRiskLevel,
  NormalizedCompanyEvent,
  RecommendationCandidate,
  StockEventIntelligence,
  UniverseCompany,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const EVENT_CACHE_TTL_MS = 30 * 60 * 1000;
const UPCOMING_WINDOW_DAYS = 60;
const RECENT_WINDOW_DAYS = 30;
const EVENT_ENRICHMENT_CONCURRENCY = 4;

const providers: CompanyEventProvider[] = [kapBatchNewsProvider];

const eventCache = new Map<
  string,
  {
    expiresAt: number;
    promise: Promise<StockEventIntelligence>;
  }
>();

function compareRisk(left: EventRiskLevel, right: EventRiskLevel) {
  const score = {
    low: 1,
    medium: 2,
    high: 3,
  } satisfies Record<EventRiskLevel, number>;

  return score[left] - score[right];
}

function maxRisk(left: EventRiskLevel, right: EventRiskLevel): EventRiskLevel {
  return compareRisk(left, right) >= 0 ? left : right;
}

export function createEmptyEventIntelligence(
  input: Pick<CompanyEventProviderInput, "symbol" | "displaySymbol" | "companyName">,
  providerStatuses: CompanyEventProviderStatus[] = [],
): StockEventIntelligence {
  return {
    symbol: input.symbol,
    displaySymbol: input.displaySymbol,
    companyName: input.companyName,
    recentEvents: [],
    upcomingEvents: [],
    eventRiskLevel: "low",
    eventPenalty: 0,
    summary: "Yakin donemde dikkat ceken sirket olayi bulunmuyor.",
    warningCodes: [],
    warningList: [],
    providerStatuses,
  };
}

function buildProviderInput(
  input: CompanyEventProviderInput | UniverseCompany | RecommendationCandidate,
): CompanyEventProviderInput {
  return {
    symbol: input.symbol,
    displaySymbol: input.displaySymbol,
    companyName: input.companyName,
    kapMemberOid: "kapMemberOid" in input ? input.kapMemberOid : undefined,
  };
}

function buildSummary(
  recentEvents: NormalizedCompanyEvent[],
  upcomingEvents: NormalizedCompanyEvent[],
) {
  const nextEvent = upcomingEvents[0];
  const latestRecent = recentEvents[0];

  if (nextEvent) {
    const riskLead =
      nextEvent.riskLevel === "high"
        ? "Yakin tarihte yuksek riskli bir olay var"
        : nextEvent.riskLevel === "medium"
          ? "Yakin tarihte izlenmesi gereken bir sirket olayi var"
          : "Takvimde dusuk riskli ama takip edilmesi faydali bir olay var";
    const eventDate = nextEvent.eventDate?.slice(0, 10) ?? "yakinda";

    return `${riskLead}: ${nextEvent.title} (${eventDate}). ${nextEvent.summary}`;
  }

  if (latestRecent) {
    return `Son donemde one cikan olay: ${latestRecent.title}. ${latestRecent.summary}`;
  }

  return "Yakin donemde dikkat ceken sirket olayi bulunmuyor.";
}

function buildWarningCodes(
  recentEvents: NormalizedCompanyEvent[],
  upcomingEvents: NormalizedCompanyEvent[],
) {
  return [...upcomingEvents, ...recentEvents]
    .filter((event) => event.riskLevel !== "low")
    .slice(0, 4)
    .map((event) => `${event.timing}_${event.type}_${event.riskLevel}`);
}

function buildWarningList(
  recentEvents: NormalizedCompanyEvent[],
  upcomingEvents: NormalizedCompanyEvent[],
) {
  return [...upcomingEvents, ...recentEvents]
    .filter((event) => event.riskLevel !== "low")
    .slice(0, 3)
    .map((event) => {
      if (event.timing === "upcoming" && event.eventDate) {
        return `${event.displaySymbol}: ${event.title} (${event.eventDate.slice(0, 10)}) yaklasiyor.`;
      }

      return `${event.displaySymbol}: ${event.title} son donemde risk sinyali uretti.`;
    });
}

function buildEventPenalty(
  recentEvents: NormalizedCompanyEvent[],
  upcomingEvents: NormalizedCompanyEvent[],
) {
  let penalty = 0;
  const now = Date.now();

  upcomingEvents.forEach((event) => {
    const eventDateMs = event.eventDate ? Date.parse(event.eventDate) : NaN;

    if (!Number.isFinite(eventDateMs)) {
      return;
    }

    const daysUntilEvent = Math.floor((eventDateMs - now) / DAY_MS);

    if (event.riskLevel === "high" && daysUntilEvent <= 3) {
      penalty -= 8;
      return;
    }

    if (event.riskLevel === "high" && daysUntilEvent <= 7) {
      penalty -= 6;
      return;
    }

    if (event.riskLevel === "medium" && daysUntilEvent <= 5) {
      penalty -= 3;
      return;
    }

    if (event.riskLevel === "low" && daysUntilEvent <= 5) {
      penalty -= 1;
    }
  });

  recentEvents.forEach((event) => {
    const referenceDate = Date.parse(event.eventDate ?? event.publishedAt);
    const daysFromNow = Math.abs(Math.floor((now - referenceDate) / DAY_MS));

    if (event.riskLevel === "high" && daysFromNow <= 2) {
      penalty -= 4;
      return;
    }

    if (event.riskLevel === "medium" && daysFromNow <= 3) {
      penalty -= 1.5;
    }
  });

  return round(Math.max(penalty, -12), 2);
}

function selectUpcomingEvents(events: NormalizedCompanyEvent[]) {
  const now = Date.now();
  const windowEnd = now + UPCOMING_WINDOW_DAYS * DAY_MS;

  return events
    .filter((event) => {
      if (!event.eventDate) {
        return false;
      }

      const eventDateMs = Date.parse(event.eventDate);
      return eventDateMs >= now - DAY_MS && eventDateMs <= windowEnd;
    })
    .sort((left, right) => {
      const leftTime = Date.parse(left.eventDate ?? left.publishedAt);
      const rightTime = Date.parse(right.eventDate ?? right.publishedAt);
      return leftTime - rightTime;
    })
    .slice(0, 6);
}

function selectRecentEvents(events: NormalizedCompanyEvent[]) {
  const now = Date.now();
  const windowStart = now - RECENT_WINDOW_DAYS * DAY_MS;

  return events
    .filter((event) => {
      const referenceTime = Date.parse(event.eventDate ?? event.publishedAt);
      return referenceTime <= now && referenceTime >= windowStart;
    })
    .sort((left, right) => {
      const leftTime = Date.parse(left.eventDate ?? left.publishedAt);
      const rightTime = Date.parse(right.eventDate ?? right.publishedAt);
      return rightTime - leftTime;
    })
    .slice(0, 6);
}

function dedupeEvents(events: NormalizedCompanyEvent[]) {
  const map = new Map<string, NormalizedCompanyEvent>();

  for (const event of events) {
    map.set(`${event.provider}:${event.title}:${event.publishedAt}`, event);
  }

  return [...map.values()];
}

async function loadEventIntelligence(input: CompanyEventProviderInput) {
  const providerStatuses: CompanyEventProviderStatus[] = [];
  const collectedEvents: NormalizedCompanyEvent[] = [];

  if (!input.kapMemberOid) {
    providerStatuses.push({
      provider: "kap_batch_news",
      success: false,
      message: "KAP sirket kimligi bulunamadi.",
      fetchedAt: new Date().toISOString(),
    });
    return createEmptyEventIntelligence(input, providerStatuses);
  }

  for (const provider of providers) {
    try {
      const events = await provider.getEvents(input);
      collectedEvents.push(...events);
      providerStatuses.push({
        provider: provider.name,
        success: true,
        message: events.length > 0 ? `${events.length} olay normalize edildi.` : "Eslesen olay bulunamadi.",
        fetchedAt: new Date().toISOString(),
      });
    } catch (error) {
      providerStatuses.push({
        provider: provider.name,
        success: false,
        message: error instanceof Error ? error.message : "Provider hatasi olustu.",
        fetchedAt: new Date().toISOString(),
      });
    }
  }

  const uniqueEvents = dedupeEvents(collectedEvents);
  const upcomingEvents = selectUpcomingEvents(uniqueEvents);
  const recentEvents = selectRecentEvents(uniqueEvents);
  const eventRiskLevel = [...upcomingEvents, ...recentEvents].reduce<EventRiskLevel>(
    (current, event) => maxRisk(current, event.riskLevel),
    "low",
  );
  const warningCodes = buildWarningCodes(recentEvents, upcomingEvents);
  const warningList = buildWarningList(recentEvents, upcomingEvents);
  const eventPenalty = buildEventPenalty(recentEvents, upcomingEvents);

  return {
    symbol: input.symbol,
    displaySymbol: input.displaySymbol,
    companyName: input.companyName,
    recentEvents,
    upcomingEvents,
    eventRiskLevel,
    eventPenalty,
    summary: buildSummary(recentEvents, upcomingEvents),
    warningCodes,
    warningList,
    providerStatuses,
  } satisfies StockEventIntelligence;
}

async function mapWithConcurrency<TItem, TResult>(
  items: TItem[],
  concurrency: number,
  task: (item: TItem, index: number) => Promise<TResult>,
) {
  const settledResults: PromiseSettledResult<TResult>[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      try {
        settledResults[currentIndex] = {
          status: "fulfilled",
          value: await task(items[currentIndex] as TItem, currentIndex),
        };
      } catch (error) {
        settledResults[currentIndex] = {
          status: "rejected",
          reason: error,
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );

  return settledResults;
}

export async function getStockEventIntelligence(
  input: CompanyEventProviderInput | UniverseCompany | RecommendationCandidate,
) {
  const resolvedInput = buildProviderInput(input);
  const cacheKey = resolvedInput.symbol;
  const now = Date.now();
  const cached = eventCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = loadEventIntelligence(resolvedInput).catch((error) => {
    eventCache.delete(cacheKey);
    throw error;
  });

  eventCache.set(cacheKey, {
    expiresAt: now + EVENT_CACHE_TTL_MS,
    promise,
  });

  return promise;
}

export async function getStockEventIntelligenceBySymbol(symbolInput: string) {
  const symbol = symbolInput.trim().toUpperCase();
  const normalizedSymbol = symbol.endsWith(".IS") ? symbol : `${symbol}.IS`;
  const universe = await getBistUniverse();
  const company =
    universe.find((item) => item.symbol === normalizedSymbol) ??
    universe.find((item) => item.displaySymbol === symbol.replace(".IS", ""));

  if (!company) {
    return createEmptyEventIntelligence({
      symbol: normalizedSymbol,
      displaySymbol: normalizedSymbol.replace(".IS", ""),
      companyName: normalizedSymbol.replace(".IS", ""),
    });
  }

  return getStockEventIntelligence(company);
}

export async function enrichRecommendationsWithEvents(
  recommendations: RecommendationCandidate[],
) {
  const settledResults = await mapWithConcurrency(
    recommendations,
    EVENT_ENRICHMENT_CONCURRENCY,
    async (recommendation) => {
      const eventIntelligence = await getStockEventIntelligence(recommendation);

      return {
        ...recommendation,
        eventIntelligence,
        eventAdjustedRankScore: round(
          recommendation.rankScore + eventIntelligence.eventPenalty,
          2,
        ),
      } satisfies RecommendationCandidate;
    },
  );

  return settledResults.map((result, index) => {
    const baseRecommendation = recommendations[index] as RecommendationCandidate;

    if (result.status === "fulfilled") {
      return result.value;
    }

    return {
      ...baseRecommendation,
      eventAdjustedRankScore: baseRecommendation.rankScore,
      eventIntelligence: createEmptyEventIntelligence(baseRecommendation, [
        {
          provider: "kap_batch_news",
          success: false,
          message:
            result.reason instanceof Error
              ? result.reason.message
              : "Event verisi olusturulamadi.",
          fetchedAt: new Date().toISOString(),
        },
      ]),
    } satisfies RecommendationCandidate;
  });
}

export function createFallbackEventIntelligence(
  recommendation: RecommendationCandidate,
) {
  return {
    ...recommendation,
    eventAdjustedRankScore: recommendation.rankScore,
    eventIntelligence: createEmptyEventIntelligence(recommendation),
  } satisfies RecommendationCandidate;
}
