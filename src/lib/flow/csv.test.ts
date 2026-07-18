import { describe, expect, test } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  test("parses headers and rows keyed by header", () => {
    const { headers, rows } = parseCsv("name,email\nAda,ada@x.com\nGrace,grace@y.com");
    expect(headers).toEqual(["name", "email"]);
    expect(rows).toEqual([
      { name: "Ada", email: "ada@x.com" },
      { name: "Grace", email: "grace@y.com" },
    ]);
  });

  test("handles quoted fields with embedded commas and newlines", () => {
    const { rows } = parseCsv('text,label\n"Hello, world\nsecond line",greeting');
    expect(rows).toEqual([{ text: "Hello, world\nsecond line", label: "greeting" }]);
  });

  test("handles CRLF line endings", () => {
    const { headers, rows } = parseCsv("a,b\r\n1,2\r\n");
    expect(headers).toEqual(["a", "b"]);
    expect(rows).toEqual([{ a: "1", b: "2" }]);
  });

  test("skips empty lines", () => {
    const { rows } = parseCsv("a\n1\n\n2\n");
    expect(rows).toEqual([{ a: "1" }, { a: "2" }]);
  });

  test("returns empty headers and rows for empty input", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
  });
});
