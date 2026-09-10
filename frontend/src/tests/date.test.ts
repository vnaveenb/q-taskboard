import { describe, it, expect } from "vitest";
import { isDateValid, formatDateTime, formatActivityDate } from "@/lib/date";

describe("date utility functions", () => {
  describe("isDateValid", () => {
    it("returns true for valid ISO date strings", () => {
      expect(isDateValid("2026-09-10T10:00:00Z")).toBe(true);
      expect(isDateValid("2026-09-10T16:21:00.000000+05:30")).toBe(true);
    });

    it("returns false for undefined, null, empty strings, and garbage", () => {
      expect(isDateValid(undefined)).toBe(false);
      expect(isDateValid(null)).toBe(false);
      expect(isDateValid("")).toBe(false);
      expect(isDateValid("not-a-date")).toBe(false);
      expect(isDateValid("undefined")).toBe(false);
    });
  });

  describe("formatDateTime", () => {
    it("formats valid dates properly without returning 'Invalid Date'", () => {
      const formatted = formatDateTime("2026-09-10T12:30:00Z");
      expect(formatted).not.toBe("Invalid Date");
      expect(formatted).not.toBe("");
      expect(formatted).toContain("2026");
    });

    it("returns an empty string when given null, undefined, or invalid strings", () => {
      expect(formatDateTime(undefined)).toBe("");
      expect(formatDateTime(null)).toBe("");
      expect(formatDateTime("")).toBe("");
      expect(formatDateTime("bad-date")).toBe("");
    });
  });

  describe("formatActivityDate", () => {
    it("formats valid dates with time and date separated by ·", () => {
      const formatted = formatActivityDate("2026-09-10T12:30:00Z");
      expect(formatted).not.toContain("Invalid Date");
      expect(formatted).toContain("·");
    });

    it("returns an empty string when given invalid inputs", () => {
      expect(formatActivityDate(undefined)).toBe("");
      expect(formatActivityDate(null)).toBe("");
      expect(formatActivityDate("")).toBe("");
      expect(formatActivityDate("invalid")).toBe("");
    });
  });
});
