/**
 * Pure markdown → plain-text helpers, isolated from `shared.ts` so that
 * callers (notably `lib/report-export.ts`) can use them without pulling
 * `jspdf` or `docx` into their static module graph.
 *
 * Keep this module dependency-free: no jspdf, no docx, no React.
 */

type MarkdownBlock =
  | { type: "space" }
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string }
  | { type: "listItem"; ordered: boolean; index?: number; text: string }
  | { type: "table"; rows: string[][] };

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .trim();
}

export { stripInlineMarkdown };

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|");
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function isTableStart(lines: string[], index: number): boolean {
  const current = lines[index]?.trim();
  const next = lines[index + 1]?.trim();
  return Boolean(current && next && current.includes("|") && isTableSeparator(next));
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => stripInlineMarkdown(cell));
}

export function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i] ?? "";
    const line = raw.trim();

    if (!line) {
      blocks.push({ type: "space" });
      i += 1;
      continue;
    }

    if (isTableStart(lines, i)) {
      const rows: string[][] = [parseTableRow(lines[i])];
      i += 2;
      while (i < lines.length) {
        const rowLine = lines[i]?.trim() ?? "";
        if (!rowLine || !rowLine.includes("|") || isTableSeparator(rowLine)) break;
        rows.push(parseTableRow(rowLine));
        i += 1;
      }
      blocks.push({ type: "table", rows });
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length as 1 | 2 | 3,
        text: stripInlineMarkdown(headingMatch[2]),
      });
      i += 1;
      continue;
    }

    const bulletMatch = /^[-*]\s+(.+)$/.exec(line);
    if (bulletMatch) {
      blocks.push({ type: "listItem", ordered: false, text: stripInlineMarkdown(bulletMatch[1]) });
      i += 1;
      continue;
    }

    const numberedMatch = /^(\d+)\.\s+(.+)$/.exec(line);
    if (numberedMatch) {
      blocks.push({
        type: "listItem",
        ordered: true,
        index: Number(numberedMatch[1]),
        text: stripInlineMarkdown(numberedMatch[2]),
      });
      i += 1;
      continue;
    }

    const quoteMatch = /^>\s?(.+)$/.exec(line);
    if (quoteMatch) {
      blocks.push({ type: "quote", text: stripInlineMarkdown(quoteMatch[1]) });
      i += 1;
      continue;
    }

    const paragraphLines = [line];
    i += 1;
    while (i < lines.length) {
      const next = lines[i]?.trim() ?? "";
      if (
        !next ||
        isTableStart(lines, i) ||
        /^(#{1,3})\s+/.test(next) ||
        /^[-*]\s+/.test(next) ||
        /^\d+\.\s+/.test(next) ||
        /^>\s?/.test(next)
      ) {
        break;
      }
      paragraphLines.push(next);
      i += 1;
    }
    blocks.push({ type: "paragraph", text: stripInlineMarkdown(paragraphLines.join(" ")) });
  }

  return blocks;
}

export function parseMarkdownToPdfText(text: string): string {
  return parseMarkdownBlocks(text)
    .map((block) => {
      if (block.type === "space") return "";
      if (block.type === "heading") return block.text;
      if (block.type === "paragraph" || block.type === "quote") return block.text;
      if (block.type === "listItem") return `${block.ordered ? `${block.index ?? 1}.` : "•"} ${block.text}`;
      if (block.type === "table") return block.rows.map((row) => row.join("    ")).join("\n");
      return "";
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
