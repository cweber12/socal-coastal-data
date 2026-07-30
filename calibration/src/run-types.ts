/**
 * The shape of a run, shared by the runner, the report and the JSON writer.
 *
 * Kept apart from run.ts so the report can be rendered from a fixture in a test
 * without the runner's I/O coming along with it.
 */

import type { BackgroundBand } from './join.ts';
import type { CriterionResult } from './refusals.ts';
import type {
  AccuracyProfile,
  CentringDiagnostic,
  DayNightSplit,
  FilterStage,
  LeaveOneOutRow,
  ObscuringLoss,
  SensitivityCell,
  StabilityRow,
  TaxonHeightRow,
  TimestampQuality,
} from './diagnostics.ts';

export interface ReportBin {
  index: number;
  label: string;
  loFt: number;
  hiFt: number;
  visits: number;
  hits: number;
  rate: number | null;
  usable: boolean;
  /** Wilson 95%. Context only — no refusal is decided by it. */
  interval: [number, number];
}

export interface SpotResult {
  slug: string;
  name: string;
  lat: number;
  lon: number;
  tideStation: string;
  records: number;
  visits: number;
  observers: number;
  bins: ReportBin[];
  /**
   * The amplitude gate's denominator, pooled since #72.
   *
   * Carried explicitly because it is no longer a row of the bin table a reader
   * can point at. Null when no bin is usable.
   */
  background: BackgroundBand | null;
  amplitudeRatio: number | null;
  publishes: boolean;
  criteria: CriterionResult[];
  nullReason: string | null;

  filterStages: FilterStage[];
  accuracy: AccuracyProfile;
  taxonHeights: TaxonHeightRow[];
  leaveOneOut: LeaveOneOutRow[];
  sensitivity: SensitivityCell[];
  /**
   * Where the records are, relative to where the pin says they are.
   *
   * Reported only. Nothing above reads it: no rate, no gate, no verdict, and
   * deliberately no bin table at an offset centre — recentring is a join
   * against an authority (#69), not a fit to observation density.
   */
  centring: CentringDiagnostic;
  stability: StabilityRow[];
  timestamps: TimestampQuality;
  dayNight: DayNightSplit;
  obscuringLosses: ObscuringLoss[];

  /** One sentence on whether the observed rate agrees with NPS. Cabrillo only. */
  npsAgreement: string;
  /** The pull URL this spot's numbers came from. */
  query: string;
}

export interface CalibrationRun {
  calibrationVersion: string;
  taxaVersion: string;
  pulledAt: string;
  /** 'live' or the fixture set the run read. */
  source: string;
  corpusFrom: string;
  radiusKm: number;
  tideStation: string;
  datum: string;
  tideYears: string;
  totalRecords: number;
  totalVisits: number;
  contentHash: string;
  spots: SpotResult[];
  queries: string[];
}
