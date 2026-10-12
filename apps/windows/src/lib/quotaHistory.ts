// Read side of QuotaHistory.swift. Writes go through Rust (`quota_commit`) so the
// app and the scheduled collector share one locked archive.
import type { QuotaReading, QuotaReset, QuotaSample } from "./usage";

export interface QuotaHistoryData {
  version: number;
  readings: Record<string, Record<string, QuotaReading[]>>;
  failures: Record<string, Record<string, string>>;
}

export const emptyQuotaHistory = (): QuotaHistoryData => ({
  version: 1,
  readings: {},
  failures: {},
});

/** Milliseconds; start of the limit window this reading belongs to. */
export function windowStart(reading: QuotaReading) {
  return (
    reading.observedAt -
    (reading.window.elapsedPercent / 100) * Math.max(1, reading.window.windowMinutes * 60) * 1000
  );
}

const isRecent = (reading: QuotaReading, newest: QuotaReading) =>
  newest.observedAt - reading.observedAt <= 1_800_000 &&
  Math.abs(windowStart(reading) - windowStart(newest)) <= 300_000;

const isOverCount = (reading: QuotaReading, floor: number) =>
  reading.window.windowMinutes >= 2 * 24 * 60 && reading.window.usedPercent > floor * 1.5 + 3;

export class QuotaHistory {
  constructor(readonly data: QuotaHistoryData = emptyQuotaHistory()) {}

  rows(agent: string, source: string): QuotaReading[] {
    return this.data.readings[source]?.[agent] ?? [];
  }

  failure(agent: string, source: string): string | undefined {
    return this.data.failures[source]?.[agent];
  }

  latest(agent: string, source: string): QuotaReading | undefined {
    const rows = this.rows(agent, source);
    return rows[rows.length - 1];
  }

  /** The newest reading safe to show as the live meter (see QuotaHistory.swift). */
  current(agent: string, source: string): QuotaReading | undefined {
    const all = this.rows(agent, source);
    const newest = all[all.length - 1];
    if (!newest) return undefined;
    const recent: QuotaReading[] = [];
    for (let i = all.length - 1; i >= 0; i--) {
      if (!isRecent(all[i]!, newest)) break;
      recent.push(all[i]!);
    }
    if (recent.length === 0) return newest;
    const floor = Math.min(...recent.map((r) => r.window.usedPercent));
    return recent.find((r) => !isOverCount(r, floor)) ?? newest;
  }

  cycleConsistentReadings(agent: string, source: string): QuotaReading[] {
    const kept: { reading: QuotaReading; segment: number }[] = [];
    const segmentStarts: number[] = [];
    for (const reading of this.rows(agent, source)) {
      const start = windowStart(reading);
      const last = segmentStarts[segmentStarts.length - 1];
      if (last != null && Math.abs(start - last) <= 300_000) {
        kept.push({ reading, segment: segmentStarts.length - 1 });
      } else if (segmentStarts.some((s) => Math.abs(start - s) <= 300_000)) {
        continue;
      } else {
        segmentStarts.push(start);
        kept.push({ reading, segment: segmentStarts.length - 1 });
      }
    }
    const lowestLater = new Map<number, number>();
    const consistent: QuotaReading[] = [];
    for (let i = kept.length - 1; i >= 0; i--) {
      const { reading, segment } = kept[i]!;
      const used = reading.window.usedPercent;
      const floor = lowestLater.get(segment);
      if (floor != null && used > floor + 1) continue;
      lowestLater.set(segment, Math.min(used, floor ?? used));
      consistent.push(reading);
    }
    const chronological = [...consistent].reverse();
    const newest = chronological[chronological.length - 1];
    if (newest) {
      const recent: number[] = [];
      for (const r of consistent) {
        if (!isRecent(r, newest)) break;
        recent.push(r.window.usedPercent);
      }
      if (recent.length > 0) {
        const floor = Math.min(...recent);
        while (
          chronological.length > 0 &&
          isOverCount(chronological[chronological.length - 1]!, floor)
        ) {
          chronological.pop();
        }
      }
    }
    return chronological;
  }

  samples(agent: string, source: string): QuotaSample[] {
    return this.cycleConsistentReadings(agent, source).map((r) => ({
      date: new Date(r.observedAt),
      remaining: 100 - r.window.usedPercent,
    }));
  }

  resets(agent: string, source: string): QuotaReset[] {
    const points = this.cycleConsistentReadings(agent, source);
    const found: QuotaReset[] = [];
    for (let index = 1; index < points.length; index++) {
      const previous = points[index - 1]!;
      const reading = points[index]!;
      const remaining = 100 - reading.window.usedPercent;
      const previousRemaining = 100 - previous.window.usedPercent;
      if (!(remaining > previousRemaining + 1)) continue;
      found.push({
        date: new Date(reading.observedAt),
        scheduled: previous.window.elapsedPercent >= 80 && reading.window.elapsedPercent <= 20,
      });
    }
    return found;
  }
}
