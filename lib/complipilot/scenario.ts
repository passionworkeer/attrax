import {
  blazeReportFiles as sourceReportFiles,
  blazeReportPreviewTabs as sourceReportPreviewTabs,
} from "@/lib/mock/blaze-scenario";
import { toCompliPilotValue } from "@/lib/complipilot/copy";

export const blazeReportFiles = toCompliPilotValue(sourceReportFiles);
export const blazeReportPreviewTabs = toCompliPilotValue(sourceReportPreviewTabs);
