/**
 * Fixes the small limit mistakes agents make in Slack chart and table blocks,
 * so one long title does not cost the whole chart. Other blocks pass through.
 */

type Json = Record<string, unknown>;

const TITLE_CHARS = 50;
const LABEL_CHARS = 20;
const MAX_SERIES = 12;
const MAX_POINTS = 20;
const CHARTS_PER_MESSAGE = 2;
const MAX_TABLE_ROWS = 201;
const MAX_TABLE_COLUMNS = 20;
const EMPTY_CELL = "—";

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

/** Counts characters, not UTF-16 units, so emoji are not cut in half. */
const truncate = (text: string, max: number) => {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text;
};

/** Maps each label to a unique one of at most `max` characters. */
function uniqueLabels(labels: string[], max: number): Map<string, string> {
  const mapped = new Map<string, string>();
  const used = new Set<string>();
  for (const label of labels) {
    if (mapped.has(label)) continue;
    let candidate = truncate(label, max);
    for (let n = 2; used.has(candidate); n += 1) {
      const suffix = ` ${n}`;
      candidate = `${truncate(label, max - suffix.length)}${suffix}`;
    }
    used.add(candidate);
    mapped.set(label, candidate);
  }
  return mapped;
}

function fixChart(block: Json, fixes: string[]): Json {
  const name = typeof block.title === "string" ? block.title : "";
  const title = truncate(name || "Chart", TITLE_CHARS);
  if (title !== name) fixes.push(`chart title "${name}" → "${title}"`);
  const chart = isObject(block.chart) ? block.chart : {};

  if (chart.type === "pie") {
    const all = asArray(chart.segments).filter(isObject);
    const positive = all.filter(
      (segment) => typeof segment.value === "number" && segment.value > 0,
    );
    if (positive.length < all.length) {
      fixes.push(
        `${title}: dropped ${all.length - positive.length} segment(s) without a positive value`,
      );
    }
    const segments = positive.slice(0, MAX_SERIES);
    if (segments.length < positive.length) {
      fixes.push(
        `${title}: kept the first ${MAX_SERIES} of ${positive.length} segments`,
      );
    }
    const labels = uniqueLabels(
      segments.map((segment) => String(segment.label ?? "")),
      LABEL_CHARS,
    );
    return {
      ...block,
      title,
      chart: {
        ...chart,
        segments: segments.map((segment) => ({
          ...segment,
          label: labels.get(String(segment.label ?? "")),
        })),
      },
    };
  }

  const allSeries = asArray(chart.series).filter(isObject);
  const series = allSeries.slice(0, MAX_SERIES);
  if (series.length < allSeries.length) {
    fixes.push(
      `${title}: kept the first ${MAX_SERIES} of ${allSeries.length} series`,
    );
  }
  const axis = isObject(chart.axis_config) ? chart.axis_config : {};
  const points = (entry: Json) => asArray(entry.data).filter(isObject);
  const declared = asArray(axis.categories).map(String);
  const allCategories = [
    ...new Set(
      declared.length > 0
        ? declared
        : series.flatMap((entry) => points(entry).map((p) => String(p.label))),
    ),
  ];
  // Time series run left to right: keep the most recent points.
  const categories = allCategories.slice(-MAX_POINTS);
  if (categories.length < allCategories.length) {
    fixes.push(
      `${title}: kept the last ${MAX_POINTS} of ${allCategories.length} points`,
    );
  }
  const labels = uniqueLabels(categories, LABEL_CHARS);
  const names = uniqueLabels(
    series.map((entry) => String(entry.name ?? "")),
    LABEL_CHARS,
  );
  const shortened = [...labels, ...names].filter(([from, to]) => from !== to);
  if (shortened.length > 0) {
    fixes.push(
      `${title}: shortened ${shortened.length} label(s) to ${LABEL_CHARS} characters`,
    );
  }
  const axisLabels: Json = {};
  for (const key of ["x_label", "y_label"] as const) {
    if (typeof axis[key] === "string") {
      axisLabels[key] = truncate(axis[key], TITLE_CHARS);
      if (axisLabels[key] !== axis[key])
        fixes.push(`${title}: shortened ${key}`);
    }
  }
  return {
    ...block,
    title,
    chart: {
      ...chart,
      series: series.map((entry) => {
        // One point per category, the last one when a label repeats.
        const byLabel = new Map<string, Json>();
        for (const point of points(entry)) {
          const label = labels.get(String(point.label));
          if (label) byLabel.set(label, { ...point, label });
        }
        return {
          ...entry,
          name: names.get(String(entry.name ?? "")),
          data: categories
            .map((category) => byLabel.get(labels.get(category) ?? ""))
            .filter(Boolean),
        };
      }),
      axis_config: {
        ...axis,
        ...axisLabels,
        categories: categories.map((category) => labels.get(category)),
      },
    },
  };
}

/** The plain text of a table cell, for a header or an empty cell. */
function cellText(cell: unknown): string {
  if (!isObject(cell)) return "";
  if (typeof cell.text === "string") return cell.text;
  if (typeof cell.value === "number") return String(cell.value);
  return asArray(cell.elements).map(cellText).join("");
}

function fixCell(cell: unknown, header: boolean): Json {
  const text = cellText(cell).trim() || EMPTY_CELL;
  if (header || !isObject(cell)) return { type: "raw_text", text };
  if (cell.type === "raw_text") return { ...cell, text };
  if (cell.type === "raw_number" && typeof cell.text !== "string") {
    return { ...cell, text };
  }
  return cell;
}

function fixTable(block: Json, fixes: string[]): Json {
  const caption =
    typeof block.caption === "string" && block.caption.trim()
      ? block.caption
      : "Table";
  if (caption !== block.caption)
    fixes.push(`table caption set to "${caption}"`);
  const allRows = asArray(block.rows).map(asArray);
  const rows = allRows.slice(0, MAX_TABLE_ROWS);
  if (rows.length < allRows.length) {
    fixes.push(
      `${caption}: kept the first ${MAX_TABLE_ROWS - 1} of ${allRows.length - 1} rows`,
    );
  }
  const width = Math.min(
    MAX_TABLE_COLUMNS,
    Math.max(1, ...rows.map((row) => row.length)),
  );
  if (rows.some((row) => row.length !== width)) {
    fixes.push(`${caption}: evened rows to ${width} cells`);
  }
  const fixed: Json = {
    ...block,
    caption,
    rows: rows.map((row, index) =>
      Array.from({ length: width }, (_, column) =>
        fixCell(row[column], index === 0),
      ),
    ),
  };
  if (block.page_size !== undefined) {
    const size = Math.round(Number(block.page_size));
    fixed.page_size = Number.isFinite(size)
      ? Math.min(100, Math.max(1, size))
      : 5;
    if (fixed.page_size !== block.page_size)
      fixes.push(`${caption}: page_size → ${String(fixed.page_size)}`);
  }
  return fixed;
}

/**
 * Fixes chart and table blocks and splits them into messages of at most two
 * charts each. `fixes` says what changed, for the log.
 */
export function sanitizeBlocks<B>(blocks: B[]): {
  groups: B[][];
  fixes: string[];
} {
  const fixes: string[] = [];
  const groups: B[][] = [];
  let current: B[] = [];
  let charts = 0;
  for (const block of blocks) {
    if (!isObject(block)) {
      current.push(block);
      continue;
    }
    if (block.type === "data_visualization") {
      if (charts === CHARTS_PER_MESSAGE) {
        fixes.push("moved charts beyond the second to a follow-up message");
        groups.push(current);
        current = [];
        charts = 0;
      }
      charts += 1;
      current.push(fixChart(block, fixes) as B);
    } else if (block.type === "data_table") {
      current.push(fixTable(block, fixes) as B);
    } else {
      current.push(block);
    }
  }
  if (current.length > 0) groups.push(current);
  return { groups, fixes: [...new Set(fixes)] };
}

/** The block indexes named by Slack's `[json-pointer:/blocks/N…]` errors. */
export function blockPointers(detail: string): number[] {
  return [...detail.matchAll(/json-pointer:\/blocks\/(\d+)/gu)].map((match) =>
    Number(match[1]),
  );
}
