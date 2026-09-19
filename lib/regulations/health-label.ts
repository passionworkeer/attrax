// Pure label formatter for source health buckets. Lives in a separate
// module so client components can import it without dragging in the
// `node:fs`-using registry reader (`sources-data.ts`).

import type { SourceHealth } from "./types";

export function healthLabel(health: SourceHealth, locale: "zh" | "en"): string {
  if (locale === "en") {
    switch (health) {
      case "ok":
        return "Healthy";
      case "anti_bot":
        return "Anti-bot protected";
      case "waf_challenge_temporary":
        return "WAF challenge (transient)";
      case "unreachable":
        return "Unreachable";
      case "unknown":
        return "Status pending";
    }
  }
  switch (health) {
    case "ok":
      return "可达";
    case "anti_bot":
      return "反爬保护";
    case "waf_challenge_temporary":
      return "WAF 临时挑战";
    case "unreachable":
      return "不可达";
    case "unknown":
      return "待确认";
  }
}
