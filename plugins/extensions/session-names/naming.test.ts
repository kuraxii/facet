import { describe, expect, it } from "vitest";
import { contentToText, normalizeName, parseJsonArray } from "./naming.ts";

describe("naming helpers", () => {
	it("extracts text from strings and content blocks", () => {
		expect(contentToText("hello")).toBe("hello");
		expect(contentToText([{ text: "a" }, "b", { image: "x" }])).toBe("a\nb");
		expect(contentToText(undefined)).toBe("");
	});

	it("parses a JSON array with fences and surrounding prose", () => {
		expect(parseJsonArray('["A","B"]')).toEqual(["A", "B"]);
		expect(parseJsonArray('Here: ```json\n["A", "B"]\n```')).toEqual(["A", "B"]);
		expect(parseJsonArray("no array")).toBeNull();
		expect(parseJsonArray('["A", 1]')).toBeNull();
	});

	it("cleans wrapping quotes, list markers, and whitespace", () => {
		expect(normalizeName('  "  Fix login  "  ', 30)).toBe("Fix login");
		expect(normalizeName("- first line\nsecond line", 30)).toBe("first line second line");
		expect(normalizeName("   ", 30)).toBeNull();
	});

	it("caps the name length", () => {
		expect(normalizeName("abcdefgh", 5)).toBe("abcde");
	});
});
