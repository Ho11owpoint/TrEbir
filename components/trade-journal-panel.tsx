"use client";

import { useEffect, useState } from "react";

import { formatDateTime, formatPercent } from "@/lib/format";
import type {
  TradeJournalCreatePayload,
  TradeJournalOutcome,
  TradeJournalRecord,
  TradeJournalResponse,
  TradeJournalScope,
} from "@/lib/types";

import styles from "./market-lab.module.css";

interface SymbolOption {
  symbol: string;
  displaySymbol: string;
  companyName: string;
}

interface TradeJournalPanelProps {
  defaultSymbol: string;
  reloadKey: number;
  symbolOptions: SymbolOption[];
  onJournalChange: () => void;
}

interface JournalComposerState {
  symbol: string;
  scope: TradeJournalScope;
  strategyTag: string;
  thesis: string;
  riskPlan: string;
  target: string;
  stop: string;
  confidence: string;
  tags: string;
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, {
    cache: "no-store",
    ...init,
  });
  const data = (await response.json()) as T & { message?: string };

  if (!response.ok) {
    throw new Error(data.message ?? "Beklenmeyen bir hata olustu.");
  }

  return data;
}

function createInitialComposer(symbol = ""): JournalComposerState {
  return {
    symbol,
    scope: "trade",
    strategyTag: "",
    thesis: "",
    riskPlan: "",
    target: "",
    stop: "",
    confidence: "60",
    tags: "",
  };
}

function toneClass(value: number | null) {
  if (value === null) {
    return styles.neutral;
  }

  if (value > 0) {
    return styles.positive;
  }

  if (value < 0) {
    return styles.negative;
  }

  return styles.neutral;
}

function journalStatusLabel(entry: TradeJournalRecord) {
  if (entry.status === "planned") {
    return "Plan";
  }

  if (entry.status === "cancelled") {
    return "Iptal";
  }

  if (entry.status === "open") {
    return "Acik";
  }

  if (entry.outcome === "win") {
    return "Kazanc";
  }

  if (entry.outcome === "loss") {
    return "Zarar";
  }

  return "Kapandi";
}

function journalStatusClass(entry: TradeJournalRecord) {
  if (entry.status === "planned") {
    return styles.statusPending;
  }

  if (entry.status === "cancelled") {
    return styles.statusCancelled;
  }

  if (entry.status === "open") {
    return styles.statusPartial;
  }

  if (entry.outcome === "loss") {
    return styles.statusRejected;
  }

  if (entry.outcome === "flat") {
    return styles.statusCancelled;
  }

  return styles.statusFilled;
}

function returnValue(entry: TradeJournalRecord) {
  return entry.status === "closed" ? entry.realizedReturnPercent : entry.currentReturnPercent;
}

export function TradeJournalPanel({
  defaultSymbol,
  reloadKey,
  symbolOptions,
  onJournalChange,
}: TradeJournalPanelProps) {
  const [data, setData] = useState<TradeJournalResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [symbolFilter, setSymbolFilter] = useState("");
  const [strategyFilter, setStrategyFilter] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<TradeJournalOutcome | "all">("all");
  const [composerOpen, setComposerOpen] = useState(false);
  const [composer, setComposer] = useState<JournalComposerState>(() =>
    createInitialComposer(defaultSymbol),
  );
  const [saving, setSaving] = useState(false);
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!composer.symbol && defaultSymbol) {
      setComposer((current) => ({
        ...current,
        symbol: defaultSymbol,
      }));
    }
  }, [composer.symbol, defaultSymbol]);

  useEffect(() => {
    let cancelled = false;

    async function loadJournal() {
      try {
        setLoading(true);
        const searchParams = new URLSearchParams();

        if (symbolFilter) {
          searchParams.set("symbol", symbolFilter);
        }

        if (strategyFilter) {
          searchParams.set("strategy", strategyFilter);
        }

        if (outcomeFilter !== "all") {
          searchParams.set("outcome", outcomeFilter);
        }

        const response = await fetchJson<TradeJournalResponse>(
          `/api/journal${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`,
        );

        if (cancelled) {
          return;
        }

        setData(response);
        setError(null);
        setNoteDrafts((current) => {
          const nextDrafts = { ...current };

          response.entries.forEach((entry) => {
            nextDrafts[entry.id] = current[entry.id] ?? entry.notesAfterExit;
          });

          return nextDrafts;
        });
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Trade journal verisi yuklenemedi.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadJournal();

    return () => {
      cancelled = true;
    };
  }, [outcomeFilter, reloadKey, strategyFilter, symbolFilter]);

  function updateComposer<K extends keyof JournalComposerState>(
    key: K,
    value: JournalComposerState[K],
  ) {
    setComposer((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function handleCreate() {
    if (!composer.symbol.trim()) {
      setError("Journal olusturmak icin sembol sec.");
      return;
    }

    if (!composer.strategyTag.trim() || !composer.thesis.trim()) {
      setError("Strategy etiketi ve thesis zorunlu.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const payload: TradeJournalCreatePayload = {
        symbol: composer.symbol,
        scope: composer.scope,
        strategyTag: composer.strategyTag,
        thesis: composer.thesis,
        riskPlan: composer.riskPlan,
        target: Number(composer.target) || undefined,
        stop: Number(composer.stop) || undefined,
        confidence: Number(composer.confidence) || undefined,
        tags: composer.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      };

      await fetchJson<TradeJournalRecord>("/api/journal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      setComposer(createInitialComposer(defaultSymbol));
      setComposerOpen(false);
      onJournalChange();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Trade journal kaydi olusturulamadi.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveExitNotes(entryId: string) {
    setSavingNoteId(entryId);
    setError(null);

    try {
      await fetchJson<TradeJournalRecord>(`/api/journal/${entryId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          notesAfterExit: noteDrafts[entryId] ?? "",
        }),
      });

      onJournalChange();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Cikis notu kaydedilemedi.",
      );
    } finally {
      setSavingNoteId(null);
    }
  }

  return (
    <section className={styles.journalPanel}>
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.metaLabel}>Trade journal</p>
          <h2 className={styles.sectionTitle}>Islem kalitesi ve giris tezleri</h2>
        </div>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => setComposerOpen((current) => !current)}
        >
          {composerOpen ? "Formu kapat" : "Yeni journal"}
        </button>
      </div>

      {error ? <div className={styles.errorBanner}>{error}</div> : null}

      <div className={styles.formGrid}>
        <label className={styles.formField}>
          <span>Sembol filtre</span>
          <select
            className={styles.formInput}
            value={symbolFilter}
            onChange={(event) => setSymbolFilter(event.target.value)}
          >
            <option value="">Tum semboller</option>
            {data?.availableSymbols.map((symbol) => (
              <option key={symbol} value={symbol}>
                {symbol}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.formField}>
          <span>Strategy filtre</span>
          <select
            className={styles.formInput}
            value={strategyFilter}
            onChange={(event) => setStrategyFilter(event.target.value)}
          >
            <option value="">Tum stratejiler</option>
            {data?.availableStrategies.map((strategy) => (
              <option key={strategy} value={strategy}>
                {strategy}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.formField}>
          <span>Outcome filtre</span>
          <select
            className={styles.formInput}
            value={outcomeFilter}
            onChange={(event) =>
              setOutcomeFilter(event.target.value as TradeJournalOutcome | "all")
            }
          >
            <option value="all">Tum durumlar</option>
            <option value="planned">Plan</option>
            <option value="open">Acik</option>
            <option value="win">Kazanc</option>
            <option value="loss">Zarar</option>
            <option value="flat">Flat</option>
            <option value="cancelled">Iptal</option>
          </select>
        </label>
      </div>

      {composerOpen ? (
        <div className={styles.journalComposerPanel}>
          <div className={styles.formGrid}>
            <label className={styles.formField}>
              <span>Sembol</span>
              <select
                className={styles.formInput}
                value={composer.symbol}
                onChange={(event) => updateComposer("symbol", event.target.value)}
              >
                <option value="">Sembol sec</option>
                {symbolOptions.map((option) => (
                  <option key={option.symbol} value={option.symbol}>
                    {option.displaySymbol} - {option.companyName}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.formField}>
              <span>Kapsam</span>
              <select
                className={styles.formInput}
                value={composer.scope}
                onChange={(event) =>
                  updateComposer("scope", event.target.value as TradeJournalScope)
                }
              >
                <option value="trade">Trade</option>
                <option value="position">Position</option>
              </select>
            </label>

            <label className={styles.formField}>
              <span>Strategy etiketi</span>
              <input
                className={styles.formInput}
                value={composer.strategyTag}
                onChange={(event) => updateComposer("strategyTag", event.target.value)}
                placeholder="momentum"
              />
            </label>

            <label className={styles.formField}>
              <span>Confidence</span>
              <input
                className={styles.formInput}
                type="number"
                min="0"
                max="100"
                step="1"
                value={composer.confidence}
                onChange={(event) => updateComposer("confidence", event.target.value)}
              />
            </label>

            <label className={`${styles.formField} ${styles.formFieldWide}`}>
              <span>Thesis</span>
              <textarea
                className={`${styles.formInput} ${styles.formTextarea}`}
                value={composer.thesis}
                onChange={(event) => updateComposer("thesis", event.target.value)}
                placeholder="Kurulumu neden begeniyorum?"
              />
            </label>

            <label className={`${styles.formField} ${styles.formFieldWide}`}>
              <span>Risk plani</span>
              <textarea
                className={`${styles.formInput} ${styles.formTextarea}`}
                value={composer.riskPlan}
                onChange={(event) => updateComposer("riskPlan", event.target.value)}
                placeholder="Stop, invalidation, pozisyon boyutu"
              />
            </label>

            <label className={styles.formField}>
              <span>Target</span>
              <input
                className={styles.formInput}
                type="number"
                min="0.01"
                step="0.01"
                value={composer.target}
                onChange={(event) => updateComposer("target", event.target.value)}
              />
            </label>

            <label className={styles.formField}>
              <span>Stop</span>
              <input
                className={styles.formInput}
                type="number"
                min="0.01"
                step="0.01"
                value={composer.stop}
                onChange={(event) => updateComposer("stop", event.target.value)}
              />
            </label>

            <label className={`${styles.formField} ${styles.formFieldWide}`}>
              <span>Tags</span>
              <input
                className={styles.formInput}
                value={composer.tags}
                onChange={(event) => updateComposer("tags", event.target.value)}
                placeholder="scanner, pullback"
              />
            </label>
          </div>

          <div className={styles.actionRow}>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => void handleCreate()}
              disabled={saving}
            >
              {saving ? "Kaydediliyor" : "Journal kaydet"}
            </button>
          </div>
        </div>
      ) : null}

      <div className={styles.analyticsMetricGrid}>
        <div className={styles.analyticsMetricCard}>
          <span>En sik setup</span>
          <strong>{data?.summary.mostCommonSetup ?? "--"}</strong>
        </div>
        <div className={styles.analyticsMetricCard}>
          <span>Acik kayit</span>
          <strong>{data?.summary.openEntries ?? 0}</strong>
        </div>
        <div className={styles.analyticsMetricCard}>
          <span>Kapali kayit</span>
          <strong>{data?.summary.closedEntries ?? 0}</strong>
        </div>
        <div className={styles.analyticsMetricCard}>
          <span>Exit note tamamlama</span>
          <strong>
            {data?.summary.notesCompletenessRate !== null &&
            data?.summary.notesCompletenessRate !== undefined
              ? formatPercent(data.summary.notesCompletenessRate)
              : "--"}
          </strong>
        </div>
      </div>

      <div className={styles.analyticsTableGrid}>
        <article className={styles.analyticsCard}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.metaLabel}>Strategy ozet</p>
              <h3 className={styles.sectionTitle}>Getiri ve kazanma orani</h3>
            </div>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Kayit</th>
                  <th>Win rate</th>
                  <th>Ort. getiri</th>
                </tr>
              </thead>
              <tbody>
                {data?.summary.strategyBreakdown.length ? (
                  data.summary.strategyBreakdown.map((item) => (
                    <tr key={item.strategyTag}>
                      <td>{item.strategyTag}</td>
                      <td>{item.journalCount}</td>
                      <td>{item.winRate === null ? "--" : formatPercent(item.winRate)}</td>
                      <td className={toneClass(item.averageReturnPercent)}>
                        {item.averageReturnPercent === null
                          ? "--"
                          : formatPercent(item.averageReturnPercent)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className={styles.emptyState}>
                      Ozet cikarmak icin journal kaydi birikmeli.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className={styles.analyticsCard}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.metaLabel}>Kayitlar</p>
              <h3 className={styles.sectionTitle}>Filtrelenmis journal listesi</h3>
            </div>
          </div>

          {loading ? (
            <div className={styles.emptyState}>Trade journal yukleniyor.</div>
          ) : data?.entries.length ? (
            <div className={styles.journalEntryList}>
              {data.entries.map((entry) => (
                <article key={entry.id} className={styles.journalEntryCard}>
                  <div className={styles.journalEntryHeader}>
                    <div>
                      <strong>{entry.displaySymbol}</strong>
                      <div className={styles.metaSubtle}>
                        {entry.strategyTag} | {formatDateTime(entry.entryDate)}
                      </div>
                    </div>
                    <span className={`${styles.statusPill} ${journalStatusClass(entry)}`}>
                      {journalStatusLabel(entry)}
                    </span>
                  </div>

                  <div className={styles.journalMetaRow}>
                    <span>{entry.scope === "position" ? "Position journal" : "Trade journal"}</span>
                    <span>Confidence: {entry.confidence ?? "--"}</span>
                    <strong className={toneClass(returnValue(entry))}>
                      {returnValue(entry) === null ? "--" : formatPercent(returnValue(entry) ?? 0)}
                    </strong>
                  </div>

                  <p className={styles.journalText}>{entry.thesis}</p>

                  {entry.riskPlan ? (
                    <div className={styles.journalSubBlock}>
                      <span>Risk plani</span>
                      <p>{entry.riskPlan}</p>
                    </div>
                  ) : null}

                  <div className={styles.journalMetaRow}>
                    <span>Target: {entry.target ?? "--"}</span>
                    <span>Stop: {entry.stop ?? "--"}</span>
                    <span>Entry: {entry.entryPrice ?? "--"}</span>
                  </div>

                  {entry.tags.length > 0 ? (
                    <div className={styles.journalTagRow}>
                      {entry.tags.map((tag) => (
                        <span key={tag} className={styles.journalTag}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {entry.status === "closed" ? (
                    <div className={styles.journalSubBlock}>
                      <span>Cikis notlari</span>
                      <textarea
                        className={`${styles.formInput} ${styles.formTextarea}`}
                        value={noteDrafts[entry.id] ?? ""}
                        onChange={(event) =>
                          setNoteDrafts((current) => ({
                            ...current,
                            [entry.id]: event.target.value,
                          }))
                        }
                        placeholder="Trade sonrasi ne ogrendim?"
                      />
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => void handleSaveExitNotes(entry.id)}
                        disabled={savingNoteId === entry.id}
                      >
                        {savingNoteId === entry.id ? "Kaydediliyor" : "Cikis notunu kaydet"}
                      </button>
                    </div>
                  ) : entry.notesAfterExit ? (
                    <div className={styles.journalSubBlock}>
                      <span>Not</span>
                      <p>{entry.notesAfterExit}</p>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              Filtreye uyan journal kaydi bulunmuyor.
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
