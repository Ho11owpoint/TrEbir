export type TradingAction = "buy" | "hold" | "reduce";

export interface Candle {
  timestamp: number;
  label: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorSet {
  sma20: number | null;
  sma50: number | null;
  rsi14: number | null;
  momentum21: number | null;
  volatility21: number | null;
  atr14: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
}

export interface Signal {
  score: number;
  action: TradingAction;
  label: string;
  reasons: string[];
}

export type MarketDataProviderName = "yahoo_finance";
export type DataQualityIssueType =
  | "provider_error"
  | "empty_series"
  | "insufficient_history"
  | "missing_field"
  | "stale_quote"
  | "stale_series"
  | "incomplete_candle";
export type DataQualitySeverity = "info" | "warning" | "error";

export interface DataQualityIssue {
  type: DataQualityIssueType;
  severity: DataQualitySeverity;
  message: string;
  field?: string;
}

export interface DataQualityReport {
  isUsable: boolean;
  isStale: boolean;
  barCount: number;
  staleByDays: number | null;
  missingFields: string[];
  issues: DataQualityIssue[];
}

export interface MarketProviderMetadata {
  provider: MarketDataProviderName;
  label: string;
  fetchedAt: string;
  quality: DataQualityReport;
}

export interface NormalizedMarketQuote {
  price: number;
  previousClose: number;
  marketTime: string;
  currency: string;
  exchange: string;
  timezone: string;
}

export interface NormalizedMarketData {
  symbol: string;
  displaySymbol: string;
  quote: NormalizedMarketQuote;
  provider: MarketProviderMetadata;
  series: Candle[];
}

export interface MarketDataFailure {
  symbol: string;
  message: string;
  type: DataQualityIssueType;
  provider: MarketDataProviderName;
  issues: DataQualityIssue[];
}

export interface MarketProviderSummary {
  provider: MarketDataProviderName;
  label: string;
  analyzedCount: number;
  failedCount: number;
  staleCount: number;
  warningCount: number;
}

export interface MarketSnapshot {
  symbol: string;
  displaySymbol: string;
  currency: string;
  exchange: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  marketTime: string;
  timezone: string;
  provider: MarketProviderMetadata;
  series: Candle[];
  indicators: IndicatorSet;
  signal: Signal;
}

export interface HistoricalSeriesResponse {
  symbol: string;
  displaySymbol: string;
  currency: string;
  exchange: string;
  timezone: string;
  provider: MarketProviderMetadata;
  series: Candle[];
}

export type ChartRangeKey = "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y" | "max";

export interface IndicatorSeriesPoint {
  timestamp: number;
  label: string;
  value: number | null;
}

export interface StockChartOverlaySeries {
  sma20: IndicatorSeriesPoint[];
  sma50: IndicatorSeriesPoint[];
  atr14: IndicatorSeriesPoint[];
  rsi14: IndicatorSeriesPoint[];
}

export type ForecastAdapterId = "volatility_scenarios";

export interface ForecastAdapterDescriptor {
  id: ForecastAdapterId;
  label: string;
  description: string;
}

export interface ForecastScenarioPoint {
  timestamp: number;
  label: string;
  horizonIndex: number;
  basePrice: number;
  bullPrice: number;
  bearPrice: number;
  upperBand: number | null;
  lowerBand: number | null;
}

export interface ForecastResponse {
  adapter: ForecastAdapterDescriptor;
  anchorPrice: number;
  anchorTimestamp: number;
  validHorizonBars: number;
  validUntil: string;
  annualizedDrift: number;
  annualizedVolatility: number;
  confidenceLevel: number;
  points: ForecastScenarioPoint[];
  warnings: string[];
}

export interface StockChartResponse {
  symbol: string;
  displaySymbol: string;
  currency: string;
  exchange: string;
  timezone: string;
  range: ChartRangeKey;
  interval: string;
  provider: MarketProviderMetadata;
  lastPrice: number;
  previousClose: number;
  change: number;
  changePercent: number;
  series: Candle[];
  overlays: StockChartOverlaySeries;
  forecast: ForecastResponse | null;
  warnings: string[];
}

export interface MarketContext {
  benchmark: string;
  label: string;
  score: number;
  trend: "risk-on" | "neutral" | "risk-off";
  summary: string;
}

export interface DashboardError {
  symbol: string;
  message: string;
  type?: DataQualityIssueType;
  provider?: MarketDataProviderName;
}

export interface DashboardResponse {
  generatedAt: string;
  benchmark: MarketContext;
  symbols: MarketSnapshot[];
  errors: DashboardError[];
}

export interface UniverseCompany {
  symbol: string;
  displaySymbol: string;
  companyName: string;
  city: string;
  exchange: string;
  kapMemberOid: string;
  sector?: string | null;
}

export type CompanyEventType =
  | "earnings"
  | "dividend"
  | "bonus_issue"
  | "rights_issue"
  | "buyback"
  | "general_assembly"
  | "important_disclosure"
  | "trading_halt"
  | "market_notice";

export type EventRiskLevel = "low" | "medium" | "high";
export type EventProviderName = "kap_batch_news" | "kap_expected_disclosures";
export type EventTiming = "recent" | "upcoming";

export interface NormalizedCompanyEvent {
  id: string;
  symbol: string;
  displaySymbol: string;
  companyName: string;
  provider: EventProviderName;
  type: CompanyEventType;
  riskLevel: EventRiskLevel;
  timing: EventTiming;
  title: string;
  summary: string;
  publishedAt: string;
  eventDate: string | null;
  disclosureClass: string | null;
  sourceUrl: string;
  sourceLabel: string;
  tags: string[];
  rawDateValues: string[];
}

export interface CompanyEventProviderInput {
  symbol: string;
  displaySymbol: string;
  companyName: string;
  kapMemberOid?: string;
}

export interface CompanyEventProviderStatus {
  provider: EventProviderName;
  success: boolean;
  message: string | null;
  fetchedAt: string;
}

export interface CompanyEventProvider {
  name: EventProviderName;
  getEvents(input: CompanyEventProviderInput): Promise<NormalizedCompanyEvent[]>;
}

export interface StockEventIntelligence {
  symbol: string;
  displaySymbol: string;
  companyName: string;
  recentEvents: NormalizedCompanyEvent[];
  upcomingEvents: NormalizedCompanyEvent[];
  eventRiskLevel: EventRiskLevel;
  eventPenalty: number;
  summary: string;
  warningCodes: string[];
  warningList: string[];
  providerStatuses: CompanyEventProviderStatus[];
}

export type StrategyProfileId =
  | "rank-score"
  | "momentum"
  | "breakout"
  | "mean-reversion";

export interface StrategyInputDescriptor {
  key: string;
  label: string;
  type: "number" | "integer" | "boolean";
  defaultValue: number | boolean;
  description: string;
}

export interface StrategyProfileDescriptor {
  id: StrategyProfileId;
  label: string;
  description: string;
  inputs: StrategyInputDescriptor[];
}

export type StrategyScoreFactorKey =
  | "base_signal"
  | "trend"
  | "momentum"
  | "volatility"
  | "rsi"
  | "proximity_to_high"
  | "market_regime"
  | "liquidity"
  | "risk"
  | "breakout_distance"
  | "volume_confirmation"
  | "ma_crossover"
  | "mean_reversion"
  | "oversold_signal"
  | "pullback_zone"
  | "filter";

export type RankScoreFactorKey = StrategyScoreFactorKey;

export interface RankScoreContributionMap {
  baseSignalContribution: number;
  trendContribution: number;
  momentumContribution: number;
  volatilityPenalty: number;
  rsiPenalty: number;
  proximityToHighContribution: number;
  marketRegimeAdjustment: number;
  liquidityPenalty: number;
  riskPenalty: number;
}

export interface StrategyScoreFactor {
  key: StrategyScoreFactorKey;
  label: string;
  contribution: number;
  impact: "positive" | "negative" | "neutral";
  code: string;
  summary: string;
}

export type RankScoreFactor = StrategyScoreFactor;

export interface StrategyScoreBreakdown<
  TContributions = unknown,
> {
  score: number;
  rawScore: number;
  contributions: TContributions;
  factors: StrategyScoreFactor[];
  topPositiveFactors: StrategyScoreFactor[];
  topNegativeFactors: StrategyScoreFactor[];
  filterWarnings: string[];
  explanationCodes: string[];
  summary: string;
}

export type RankScoreBreakdown = StrategyScoreBreakdown<RankScoreContributionMap>;

export interface StrategyEvaluationResult {
  strategy: StrategyProfileId;
  strategyLabel: string;
  score: number;
  passesFilters: boolean;
  filterWarnings: string[];
  breakdown: StrategyScoreBreakdown;
}

export interface StrategyComparisonItem {
  strategy: StrategyProfileId;
  label: string;
  topSymbols: string[];
}

export interface StrategyLabSummary {
  activeStrategy: StrategyProfileId;
  activeLabel: string;
  activeDescription: string;
  availableStrategies: StrategyProfileDescriptor[];
  comparisons: StrategyComparisonItem[];
}

export interface RecommendationCandidate extends MarketSnapshot {
  companyName: string;
  city: string;
  strategy: StrategyProfileId;
  strategyLabel: string;
  rankScore: number;
  baselineRankScore: number;
  strategyDeltaFromDefault: number;
  strategyScores: Partial<Record<StrategyProfileId, number>>;
  eventAdjustedRankScore: number;
  scoreBreakdown: StrategyScoreBreakdown;
  eventIntelligence: StockEventIntelligence;
  suggestedAmount: number;
  suggestedShares: number;
  stopLoss: number;
  riskBudget: number;
  thesis: string[];
}

export interface ScannerStatus {
  state: "idle" | "running" | "ready";
  stale: boolean;
}

export interface ScannerResponse {
  status: ScannerStatus;
  generatedAt: string | null;
  startedAt: string | null;
  strategy: StrategyLabSummary;
  benchmark: MarketContext | null;
  universeLabel: string;
  universeCount: number;
  analyzedCount: number;
  failedCount: number;
  providerSummary: MarketProviderSummary[];
  failureSummary: Array<{
    type: DataQualityIssueType;
    count: number;
  }>;
  scanFailures: MarketDataFailure[];
  recommendations: RecommendationCandidate[];
  topSymbols: string[];
  warnings: string[];
}

export interface StockDetailResponse {
  snapshot: MarketSnapshot;
  company: UniverseCompany | null;
  eventIntelligence: StockEventIntelligence;
}

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop" | "stop_limit";
export type OrderStatus =
  | "pending"
  | "filled"
  | "partially_filled"
  | "cancelled"
  | "rejected";
export type OrderTriggerStatus = "inactive" | "armed" | "triggered";
export type OrderSource = "manual" | "basket" | "bracket";
export type ExecutionReason =
  | "market_fill"
  | "limit_fill"
  | "stop_fill"
  | "stop_limit_fill"
  | "take_profit_fill"
  | "stop_loss_fill";

export interface OrderBracket {
  stopLoss?: number;
  takeProfit?: number;
}

export interface PositionRecord {
  symbol: string;
  currency: string;
  shares: number;
  averageCost: number;
  openedAt: string;
}

export interface TradeRecord {
  id: string;
  orderId?: string;
  executionId?: string;
  symbol: string;
  currency: string;
  side: OrderSide;
  orderType?: OrderType;
  shares: number;
  price: number;
  amount: number;
  commission?: number;
  slippage?: number;
  executedAt: string;
  realizedPnl: number;
  note?: string;
}

export interface ExecutionRecord {
  id: string;
  orderId: string;
  symbol: string;
  currency: string;
  side: OrderSide;
  orderType: OrderType;
  shares: number;
  price: number;
  grossAmount: number;
  commissionAmount: number;
  slippageAmount: number;
  liquidityPercent: number;
  executedAt: string;
  reason: ExecutionReason;
}

export interface OrderRecord {
  id: string;
  symbol: string;
  currency: string;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  triggerStatus: OrderTriggerStatus;
  source: OrderSource;
  requestedShares: number;
  filledShares: number;
  remainingShares: number;
  averageFillPrice: number;
  referencePrice: number;
  limitPrice?: number;
  stopPrice?: number;
  bracket?: OrderBracket;
  submittedAt: string;
  updatedAt: string;
  triggeredAt?: string;
  parentOrderId?: string;
  ocoGroupId?: string;
  executionIds: string[];
  rejectionReason?: string;
  cancellationReason?: string;
  note?: string;
}

export interface PortfolioState {
  baseCurrency: string;
  startingCash: number;
  cash: number;
  realizedPnl: number;
  positions: Record<string, PositionRecord>;
  trades: TradeRecord[];
  orders: OrderRecord[];
  executions: ExecutionRecord[];
  journals: TradeJournalRecord[];
  history: PortfolioSnapshotRecord[];
  updatedAt: string;
}

export interface PositionView extends PositionRecord {
  marketPrice: number;
  marketValue: number;
  costBasis: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  reservedShares: number;
  availableShares: number;
}

export interface PortfolioResponse {
  baseCurrency: string;
  startingCash: number;
  cash: number;
  equity: number;
  marketValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  returnPercent: number;
  openExposure: number;
  positions: PositionView[];
  trades: TradeRecord[];
  orders: OrderRecord[];
  executions: ExecutionRecord[];
  updatedAt: string;
}

export interface PortfolioHoldingSnapshot {
  symbol: string;
  displaySymbol: string;
  currency: string;
  shares: number;
  marketValue: number;
  weightPercent: number;
  unrealizedPnl: number;
}

export interface PortfolioSnapshotRecord {
  date: string;
  capturedAt: string;
  cash: number;
  equity: number;
  marketValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  returnPercent: number;
  openExposure: number;
  holdings: PortfolioHoldingSnapshot[];
}

export interface PortfolioHistoryResponse {
  generatedAt: string;
  snapshots: PortfolioSnapshotRecord[];
  totalSnapshots: number;
}

export interface PortfolioEquityCurvePoint {
  date: string;
  equity: number;
  cash: number;
  marketValue: number;
  returnPercent: number;
}

export interface PortfolioDrawdownPoint {
  date: string;
  equity: number;
  drawdownPercent: number;
  peakEquity: number;
}

export interface PortfolioAllocationItem {
  key: string;
  label: string;
  value: number;
  weightPercent: number;
  unrealizedPnl?: number;
  unrealizedPnlPercent?: number;
  sector?: string | null;
}

export interface PortfolioPnlBreakdownSegment {
  key: "realized" | "unrealized";
  label: string;
  value: number;
}

export interface PortfolioPnlBreakdown {
  realized: number;
  unrealized: number;
  total: number;
  segments: PortfolioPnlBreakdownSegment[];
}

export interface PortfolioPositionInsight {
  symbol: string;
  displaySymbol: string;
  companyName: string;
  sector: string | null;
  marketValue: number;
  weightPercent: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
}

export interface PortfolioPerformanceSummary {
  startingCapital: number;
  endingEquity: number;
  totalReturnPercent: number;
  maxDrawdownPercent: number;
  bestDayReturnPercent: number | null;
  worstDayReturnPercent: number | null;
  positiveDays: number;
  negativeDays: number;
  trackedDays: number;
  cashRatio: number;
  topPositionWeight: number;
  topThreeWeight: number;
}

export interface PortfolioBenchmarkComparison {
  benchmarkSymbol: string;
  benchmarkLabel: string;
  status: "placeholder";
  note: string;
  series: Array<{
    date: string;
    portfolioEquity: number;
    benchmarkValue: number | null;
  }>;
}

export interface PortfolioAnalyticsResponse {
  generatedAt: string;
  updatedAt: string;
  baseCurrency: string;
  performance: PortfolioPerformanceSummary;
  equityCurve: PortfolioEquityCurvePoint[];
  drawdownSeries: PortfolioDrawdownPoint[];
  allocationBySymbol: PortfolioAllocationItem[];
  allocationBySector: PortfolioAllocationItem[];
  pnlBreakdown: PortfolioPnlBreakdown;
  bestPositions: PortfolioPositionInsight[];
  worstPositions: PortfolioPositionInsight[];
  recentSnapshots: PortfolioSnapshotRecord[];
  benchmarkComparison: PortfolioBenchmarkComparison;
}

export type TradeJournalScope = "trade" | "position";
export type TradeJournalStatus = "planned" | "open" | "closed" | "cancelled";
export type TradeJournalOutcome =
  | "planned"
  | "open"
  | "win"
  | "loss"
  | "flat"
  | "cancelled";

export interface TradeJournalDraft {
  scope?: TradeJournalScope;
  strategyTag: string;
  thesis: string;
  riskPlan?: string;
  target?: number;
  stop?: number;
  confidence?: number;
  tags?: string[];
}

export interface TradeJournalCreatePayload extends TradeJournalDraft {
  symbol: string;
  entryDate?: string;
}

export interface TradeJournalUpdatePayload {
  strategyTag?: string;
  thesis?: string;
  riskPlan?: string;
  target?: number | null;
  stop?: number | null;
  confidence?: number | null;
  notesAfterExit?: string;
  tags?: string[];
}

export interface TradeJournalRecord {
  id: string;
  scope: TradeJournalScope;
  symbol: string;
  displaySymbol: string;
  entryDate: string;
  strategyTag: string;
  thesis: string;
  riskPlan: string;
  target: number | null;
  stop: number | null;
  confidence: number | null;
  notesAfterExit: string;
  tags: string[];
  linkedOrderId?: string;
  status: TradeJournalStatus;
  outcome: TradeJournalOutcome;
  createdAt: string;
  updatedAt: string;
  openedAt: string | null;
  closedAt: string | null;
  entryPrice: number | null;
  exitPrice: number | null;
  plannedShares: number | null;
  filledShares: number | null;
  closedShares: number | null;
  currentReturnPercent: number | null;
  realizedReturnPercent: number | null;
}

export interface TradeJournalStrategySummary {
  strategyTag: string;
  journalCount: number;
  closedCount: number;
  winRate: number | null;
  averageReturnPercent: number | null;
}

export interface TradeJournalSummary {
  totalEntries: number;
  filteredEntries: number;
  openEntries: number;
  closedEntries: number;
  mostCommonSetup: string | null;
  averageConfidence: number | null;
  notesCompletenessRate: number | null;
  strategyBreakdown: TradeJournalStrategySummary[];
}

export interface TradeJournalFilters {
  symbol?: string;
  strategy?: string;
  outcome?: TradeJournalOutcome | "all";
}

export interface TradeJournalResponse {
  generatedAt: string;
  filters: TradeJournalFilters;
  entries: TradeJournalRecord[];
  summary: TradeJournalSummary;
  availableSymbols: string[];
  availableStrategies: string[];
}

export type AlertRuleType =
  | "price_above"
  | "price_below"
  | "rank_score_above"
  | "regime_change"
  | "rsi_overbought"
  | "rsi_oversold"
  | "ma_crossover"
  | "enters_top_ranked_list";
export type AlertChannel = "in_app";

export interface AlertRule {
  id: string;
  name: string;
  type: AlertRuleType;
  enabled: boolean;
  symbol?: string;
  strategy?: StrategyProfileId;
  threshold?: number;
  topListLimit?: number;
  crossoverDirection?: "bullish" | "bearish";
  shortWindow?: number;
  longWindow?: number;
  channels: AlertChannel[];
  lastStateKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertCreatePayload {
  name: string;
  type: AlertRuleType;
  symbol?: string;
  strategy?: StrategyProfileId;
  threshold?: number;
  topListLimit?: number;
  crossoverDirection?: "bullish" | "bearish";
  shortWindow?: number;
  longWindow?: number;
}

export interface AlertHistoryEntry {
  id: string;
  ruleId: string;
  ruleName: string;
  type: AlertRuleType;
  symbol: string | null;
  strategy: StrategyProfileId | null;
  message: string;
  triggeredAt: string;
  channel: AlertChannel;
  context: Record<string, string | number | boolean | null>;
}

export interface AlertListResponse {
  generatedAt: string;
  rules: AlertRule[];
  history: AlertHistoryEntry[];
  triggeredNow: AlertHistoryEntry[];
}

export interface OrderPayload {
  symbol: string;
  side: OrderSide;
  type?: OrderType;
  dollars?: number;
  shares?: number;
  limitPrice?: number;
  stopPrice?: number;
  bracket?: OrderBracket;
  journal?: TradeJournalDraft;
  note?: string;
}

export interface OrderResult {
  portfolio: PortfolioResponse;
  order: OrderRecord;
  executions: ExecutionRecord[];
  trades: TradeRecord[];
  journal?: TradeJournalRecord | null;
  message: string;
}

export interface OrderSimulationPayload {
  orderIds?: string[];
  symbol?: string;
}

export interface OrderSimulationResult {
  portfolio: PortfolioResponse;
  orders: OrderRecord[];
  executions: ExecutionRecord[];
  trades: TradeRecord[];
  message: string;
}

export interface BulkOrderItem {
  symbol: string;
  shares: number;
}

export interface BulkOrderPayload {
  items: BulkOrderItem[];
}

export interface BulkOrderResult {
  portfolio: PortfolioResponse;
  orders: OrderRecord[];
  executions: ExecutionRecord[];
  trades: TradeRecord[];
  message: string;
}

export interface PositionPlan {
  stopDistance: number;
  stopLoss: number;
  riskBudget: number;
  capitalCap: number;
  shares: number;
  positionValue: number;
}

export type BacktestStrategyProfile = StrategyProfileId;

export type PositionSizingMode =
  | "percent_of_equity"
  | "fixed_amount"
  | "risk_based";

export interface BacktestPositionSizingConfig {
  mode: PositionSizingMode;
  value: number;
}

export interface BacktestRequest {
  symbol: string;
  dateFrom: string;
  dateTo: string;
  strategy: BacktestStrategyProfile;
  initialCapital: number;
  maxOpenPositions: number;
  commissionPercent: number;
  slippagePercent: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  trailingStopPercent: number;
  positionSizing: BacktestPositionSizingConfig;
}

export interface BacktestTrade {
  id: string;
  symbol: string;
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  shares: number;
  grossPnl: number;
  netPnl: number;
  returnPercent: number;
  barsHeld: number;
  exitReason:
    | "signal_exit"
    | "stop_loss"
    | "take_profit"
    | "trailing_stop"
    | "end_of_test";
}

export interface BacktestEquityPoint {
  date: string;
  equity: number;
  cash: number;
  drawdown: number;
}

export interface BacktestMetrics {
  startingCapital: number;
  endingEquity: number;
  totalReturn: number;
  cagr: number | null;
  winRate: number;
  averageGain: number;
  averageLoss: number;
  profitFactor: number | null;
  maxDrawdown: number;
  numberOfTrades: number;
  exposure: number;
}

export interface BacktestResponse {
  symbol: string;
  displaySymbol: string;
  currency: string;
  strategy: BacktestStrategyProfile;
  strategyLabel: string;
  dateFrom: string;
  dateTo: string;
  metrics: BacktestMetrics;
  equityCurve: BacktestEquityPoint[];
  trades: BacktestTrade[];
  warnings: string[];
  input: BacktestRequest;
}
