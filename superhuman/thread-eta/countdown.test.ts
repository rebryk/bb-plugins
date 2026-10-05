// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { mountCountdowns } from "./countdown";
import { formatEta } from "./shared";

const NOW = new Date(2026, 8, 28, 14, 30).getTime();

/** A sidebar row as BB draws it, with or without an indicator at its end. */
function row(threadId: string, indicator = "") {
  const element = document.createElement("div");
  element.setAttribute("data-sidebar-rename-row", "");
  element.innerHTML = `<a data-sidebar-thread-id="${threadId}"></a><span class="bb-sidebar-hover-actions-fade">${indicator}</span>`;
  document.body.append(element);
  return element.querySelector<HTMLElement>(".bb-sidebar-hover-actions-fade")!;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

it("formats the time left", () => {
  expect(formatEta(59_001)).toBe("1:00");
  expect(formatEta(5_000)).toBe("0:05");
  expect(formatEta(754_000)).toBe("12:34");
  expect(formatEta(3_723_000)).toBe("1:02:03");
});

it("counts down on working and idle rows until the time runs out", () => {
  vi.useFakeTimers({ now: NOW });
  const working = row("a", '<svg aria-label="Thread working"></svg>');
  const idle = row("b");
  const withoutEta = row("c");
  const until = NOW + 65_000;
  const dispose = mountCountdowns({
    a: { until, label: "Tests" },
    b: { until, label: null },
  });

  expect(working.dataset.superhumanEta).toBe("1:05");
  expect(working.title).toBe("Tests");
  expect(idle.dataset.superhumanEta).toBe("1:05");
  expect(withoutEta.dataset.superhumanEta).toBeUndefined();

  vi.advanceTimersByTime(6_000);
  expect(idle.dataset.superhumanEta).toBe("0:59");
  vi.advanceTimersByTime(60_000);
  expect(idle.dataset.superhumanEta).toBeUndefined();
  expect(working.hasAttribute("title")).toBe(false);

  dispose();
});

it("widens the row's box for the digits while it counts down", () => {
  vi.useFakeTimers({ now: NOW });
  const slot = row("a");
  const box = document.createElement("div");
  box.className = "relative";
  slot.replaceWith(box);
  box.append(slot);
  const dispose = mountCountdowns({ a: { until: NOW + 5_000, label: null } });
  expect(box.hasAttribute("data-superhuman-eta-box")).toBe(true);
  vi.advanceTimersByTime(5_000);
  expect(box.hasAttribute("data-superhuman-eta-box")).toBe(false);
  dispose();
});

it("puts the rows back when it unmounts", () => {
  vi.useFakeTimers({ now: NOW });
  const idle = row("a");
  const dispose = mountCountdowns({ a: { until: NOW + 5_000, label: null } });
  expect(idle.dataset.superhumanEta).toBe("0:05");
  dispose();
  expect(idle.dataset.superhumanEta).toBeUndefined();
});
