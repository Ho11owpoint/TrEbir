"use client";

import { formatDateLabel, formatDateTime } from "@/lib/format";
import type {
  EventRiskLevel,
  NormalizedCompanyEvent,
  StockEventIntelligence,
} from "@/lib/types";

import styles from "./market-lab.module.css";

interface StockEventPanelProps {
  intelligence: StockEventIntelligence | null;
  loading: boolean;
  error: string | null;
}

function riskLabel(riskLevel: EventRiskLevel) {
  switch (riskLevel) {
    case "high":
      return "Yuksek risk";
    case "medium":
      return "Orta risk";
    case "low":
    default:
      return "Dusuk risk";
  }
}

function riskClass(riskLevel: EventRiskLevel) {
  if (riskLevel === "high") {
    return styles.eventRiskHigh;
  }

  if (riskLevel === "medium") {
    return styles.eventRiskMedium;
  }

  return styles.eventRiskLow;
}

function eventTypeLabel(type: NormalizedCompanyEvent["type"]) {
  switch (type) {
    case "earnings":
      return "Finansal rapor";
    case "dividend":
      return "Temettu";
    case "bonus_issue":
      return "Bedelsiz";
    case "rights_issue":
      return "Ruchan";
    case "buyback":
      return "Geri alim";
    case "general_assembly":
      return "Genel kurul";
    case "trading_halt":
      return "Islem kisitlamasi";
    case "market_notice":
      return "Piyasa duyurusu";
    case "important_disclosure":
    default:
      return "Onemli aciklama";
  }
}

function renderEventList(events: NormalizedCompanyEvent[], emptyText: string) {
  if (events.length === 0) {
    return <div className={styles.metaSubtle}>{emptyText}</div>;
  }

  return (
    <div className={styles.eventList}>
      {events.map((event) => (
        <article key={event.id} className={styles.eventItem}>
          <div className={styles.eventItemTop}>
            <div>
              <div className={styles.eventItemTitle}>{event.title}</div>
              <div className={styles.eventItemMeta}>
                <span>{eventTypeLabel(event.type)}</span>
                <span>{formatDateLabel(event.eventDate ?? event.publishedAt)}</span>
              </div>
            </div>
            <span className={`${styles.eventRiskPill} ${riskClass(event.riskLevel)}`}>
              {riskLabel(event.riskLevel)}
            </span>
          </div>

          <p className={styles.eventItemSummary}>{event.summary}</p>

          <div className={styles.eventItemLinks}>
            <span className={styles.metaSubtle}>
              Bildirim: {formatDateTime(event.publishedAt)}
            </span>
            <a
              className={styles.eventLink}
              href={event.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              {event.sourceLabel}
            </a>
          </div>
        </article>
      ))}
    </div>
  );
}

export function StockEventPanel({
  intelligence,
  loading,
  error,
}: StockEventPanelProps) {
  return (
    <section className={styles.eventPanel}>
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.metaLabel}>Event intelligence</p>
          <h3 className={styles.sectionTitle}>Sirket olaylari ve takvim riski</h3>
        </div>
        {intelligence ? (
          <span
            className={`${styles.eventRiskPill} ${riskClass(intelligence.eventRiskLevel)}`}
          >
            {riskLabel(intelligence.eventRiskLevel)}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className={styles.emptyState}>Event verisi yukleniyor.</div>
      ) : error ? (
        <div className={styles.errorBanner}>{error}</div>
      ) : intelligence ? (
        <>
          <div className={styles.eventSummaryCard}>
            <div className={styles.eventSummaryHeader}>
              <strong>Ozet</strong>
              {intelligence.eventPenalty < 0 ? (
                <span className={styles.metaSubtle}>
                  Scanner cezasi: {intelligence.eventPenalty}
                </span>
              ) : (
                <span className={styles.metaSubtle}>Event cezasi yok</span>
              )}
            </div>
            <p className={styles.eventSummaryText}>{intelligence.summary}</p>
          </div>

          <div className={styles.eventColumns}>
            <div className={styles.eventColumn}>
              <p className={styles.metaLabel}>Yaklasan olaylar</p>
              {renderEventList(
                intelligence.upcomingEvents,
                "Takvimde yakin bir olay bulunmuyor.",
              )}
            </div>

            <div className={styles.eventColumn}>
              <p className={styles.metaLabel}>Son olaylar</p>
              {renderEventList(
                intelligence.recentEvents,
                "Son donemde filtreye giren olay bulunmuyor.",
              )}
            </div>
          </div>
        </>
      ) : (
        <div className={styles.emptyState}>
          Event bilgisi gelince sirket takvimi burada gorunecek.
        </div>
      )}
    </section>
  );
}
