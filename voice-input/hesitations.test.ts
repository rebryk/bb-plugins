import { expect, it } from "vitest";
import { stripHesitations } from "./hesitations";

it.each([
  ["Эм, давай сделаем.", "Давай сделаем."],
  ["Сделаем, э, потом.", "Сделаем, потом."],
  ["Ну, ээээ. Давай", "Ну. Давай"],
  ["Э-э-э, смотри. А-а, понял.", "Смотри. Понял."],
  ["Хмм, Ммм? Ладно", "Ладно"],
  ["So, um, we ship it. Uh, today?", "So, we ship it. Today?"],
  ["Hmm. Erm, yes.", "Yes."],
  ["добавил item., да, в первую", "добавил item, да, в первую"],
  ["Um, so I think, um. Yes", "So I think. Yes"],
])("drops hesitations from %j", (text, expected) => {
  expect(stripHesitations(text)).toBe(expected);
});

it.each([
  "А потом мы, ага, закончили.",
  "Отступ 5 мм, а не 3 mm.",
  "Ah, I see. Oh well.",
  "Из-за дождя, ну-ну.",
  "Eu tenho um carro. Um dia, talvez.",
  "Es ist um 5 Uhr, UH-60 und UM.",
  "Bring tea, coffee, etc., and wait..., then т.е., go.",
])("keeps words that only look like hesitations in %j", (text) => {
  expect(stripHesitations(text)).toBe(text);
});

it("keeps a take of hesitations alone", () => {
  expect(stripHesitations("Эм...")).toBe("Эм...");
});
