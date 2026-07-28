/**
 * Blaze Hawks-specific visual report shapes. Used by the handoff /profit page
 * and the financialSummary adapter. Do NOT add these to ComplianceReportResult.
 */
import type { Market, ProductCategory } from "@/lib/types";

export interface CostBreakdownItem {
  itemId: string;
  label: string;
  labelEn?: string;
  amount: string;
  detail: string;
  detailEn?: string;
}

export interface FinancialSummary {
  /** Real values must be validated at the report-package boundary. */
  provenance?: "demo" | "validated-backend";
  /** ISO-4217 code used for display, for example CNY or USD. */
  currency?: string;
  /** Compliant scenario sales baseline; views must never hard-code it. */
  retailBaseline?: number;
  /** Bare scenario baseline and costs for the comparison toggle. */
  bareRetailBaseline?: number;
  bareCostBreakdown?: CostBreakdownItem[];
  estimatedHeroicProfit: string;
  trueNetProfit: string;
  complianceCost: string;
  monthlyNetProfit: string;
  targetVolumeLabel: string;
  targetVolumeLabelEn?: string;
  riskExposureItems: string[];
  riskExposureItemsEn?: string[];
  costBreakdown: CostBreakdownItem[];
}
