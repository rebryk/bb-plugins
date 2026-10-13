import { expect, it } from "vitest";
import { isSlackUrl } from "./shared";

it("recognizes Slack's pages", () => {
  expect(isSlackUrl("https://app.slack.com/client/T1/C1")).toBe(true);
  expect(isSlackUrl("https://slack.com/signin")).toBe(true);
  expect(isSlackUrl("https://acme.slack.com/")).toBe(true);
  expect(isSlackUrl("https://notslack.com/")).toBe(false);
  expect(isSlackUrl("http://app.slack.com/client")).toBe(false);
  expect(isSlackUrl("not a url")).toBe(false);
});
