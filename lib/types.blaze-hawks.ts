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
