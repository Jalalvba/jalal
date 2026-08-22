// Text preparation shared by the PDF export routes.
//
// Extracted from /api/bdd/export, which learned each of these rules the hard
// way against real sheet data — a second export route copying them would
// inherit the rules but not the corrections. pdf-lib and its font objects stay
// on the caller's side: these functions only need "something that can measure
// a string", so nothing here imports pdf-lib at all.

/** The one thing these helpers need from a pdf-lib font. */
export type Measurer = { widthOfTextAtSize: (text: string, size: number) => number };

/**
 * Makes a string safe for pdf-lib's WinAnsi StandardFonts.
 *
 * Every replacement below is a real crash or a real mangling seen in this
 * data, not defensive garnish — in particular \x80-\x9f (the C1 range) is
 * inside \x00-\xff and therefore passes a naive "is it Latin-1" check, but is
 * NOT encodable: one such character, from a Windows-1252-mangled paste,
 * crashed an entire export with an opaque 500.
 */
export function sanitize(s: string): string {
  return String(s ?? "")
    .replace(/[\r\n\t\x00-\x1f\x7f]/g, " ")
    .replace(/[\x80-\x9f]/g, " ")
    .replace(new RegExp("[\\u202f\\u00a0\\u2007\\u2009\\u200a\\u3000]", "g"), " ")
    .replace(new RegExp("[\\u2018\\u2019\\u02bc]", "g"), "'")
    .replace(new RegExp("[\\u201c\\u201d\\u00ab\\u00bb]", "g"), '"')
    .replace(new RegExp("[\\u2013\\u2212]", "g"), "-")
    .replace(new RegExp("[\\u2014\\u2015]", "g"), "--")
    .replace(new RegExp("[\\u2026]", "g"), "...")
    .replace(/[^\x20-\xff]/g, "?");
}

/** Sanitized, and cut to fit the width with an ellipsis. */
export function truncate(s: string, font: Measurer, size: number, maxW: number): string {
  const str = sanitize(s);
  if (font.widthOfTextAtSize(str, size) <= maxW) return str;
  let t = str;
  while (t.length > 1 && font.widthOfTextAtSize(t + "...", size) > maxW) t = t.slice(0, -1);
  return t + "...";
}

/**
 * Word-wraps into as many lines as needed, never truncating — for the columns
 * allowed to grow a row instead of clipping.
 *
 * Falls back to hard character-breaking for a single word wider than the
 * column: rare, but a run-on value with no spaces would otherwise never fit at
 * all and would silently vanish from the page.
 */
export function wrapText(s: string, font: Measurer, size: number, maxW: number): string[] {
  const words = sanitize(s).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxW) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (font.widthOfTextAtSize(word, size) <= maxW) {
      current = word;
    } else {
      let chunk = "";
      for (const ch of word) {
        const next = chunk + ch;
        if (font.widthOfTextAtSize(next, size) <= maxW) {
          chunk = next;
        } else {
          lines.push(chunk);
          chunk = ch;
        }
      }
      current = chunk;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Wraps text that already carries its own line breaks, preserving them.
 *
 * The Parking ACTION column holds a numbered work order — one operation per
 * line — and collapsing those newlines the way sanitize() does would run the
 * operations together into a paragraph, which is exactly what the column
 * exists not to be.
 */
export function wrapPreservingBreaks(s: string, font: Measurer, size: number, maxW: number): string[] {
  return String(s ?? "")
    .split(/\r?\n/)
    .flatMap((line) => (line.trim() ? wrapText(line, font, size, maxW) : [""]));
}
