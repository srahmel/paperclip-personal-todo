import { describe, expect, it } from "vitest";
import { createI18n, german, resolveLocale } from "../src/i18n.js";

describe("host language", () => {
  it("uses Paperclip's English default and preserves supported regional locales", () => {
    expect(resolveLocale(undefined)).toBe("en");
    expect(resolveLocale("de-de")).toBe("de-DE");
    expect(resolveLocale("en-GB")).toBe("en-GB");
    expect(resolveLocale("invalid_locale")).toBe("en");
    expect(resolveLocale("fr")).toBe("en");
  });
  it("provides matching English and German UI labels", () => {
    expect(createI18n("en").t("Task board")).toBe("Task board");
    expect(createI18n("de").t("My tasks")).toBe("Meine Aufgaben");
    for (const [english, translation] of Object.entries(german)) {
      expect(createI18n("de").t(english)).toBe(translation);
      expect(translation.trim()).not.toBe("");
      expect([...english.matchAll(/\{\w+\}/g)].map((x) => x[0]).sort()).toEqual(
        [...translation.matchAll(/\{\w+\}/g)].map((x) => x[0]).sort(),
      );
    }
  });
  it("preserves user content, including replacement syntax, inside accessible labels", () => {
    const title = "Prüfe $& und {date} <Entwurf>";
    expect(createI18n("en").t("Details for “{title}”", { title })).toBe(
      `Details for “${title}”`,
    );
    expect(createI18n("en").message(title)).toBe(title);
    expect(createI18n("de").t("Unknown fallback")).toBe("Unknown fallback");
  });
  it("localizes known server errors without modifying arbitrary source messages", () => {
    expect(createI18n("en").message("Gib einen Titel ein.")).toBe(
      "Enter a title.",
    );
    expect(createI18n("de").message("Gib einen Titel ein.")).toBe(
      "Gib einen Titel ein.",
    );
    expect(createI18n("en").message("Besprechung mit Rückmeldung")).toBe(
      "Besprechung mit Rückmeldung",
    );
  });
});
