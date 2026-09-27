// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { lockZoom } from "./lock";

afterEach(() => {
  document.head.replaceChildren();
});

it("holds the page at 100% until it stops", () => {
  const meta = document.createElement("meta");
  meta.name = "viewport";
  meta.content = "width=device-width, initial-scale=1";
  document.head.append(meta);

  const stop = lockZoom(document);
  expect(meta.content).toBe(
    "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
  );
  const pinch = new Event("gesturestart", { cancelable: true });
  document.dispatchEvent(pinch);
  expect(pinch.defaultPrevented).toBe(true);
  expect(document.documentElement.style.touchAction).toBe("manipulation");

  stop();
  expect(meta.content).toBe("width=device-width, initial-scale=1");
  const next = new Event("gesturestart", { cancelable: true });
  document.dispatchEvent(next);
  expect(next.defaultPrevented).toBe(false);
  expect(document.documentElement.style.touchAction).not.toBe("manipulation");
});
