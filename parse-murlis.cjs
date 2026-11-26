const cheerio = require("cheerio");
const fs = require("fs/promises");
const path = require("path");

const WP_API_URL =
  "https://gyanmurli.com/wp-json/wp/v2/pages?search=hindi+date&per_page=100&_fields=id,slug,title,content";
const OUTPUT_FILE = path.join(__dirname, "hindi-murli-dates.json");

// Matches DD.MM.YYYY (optional spaces around dots) with optional "-1", "-2", "- A", "- B", etc.
const DOT_DATE_REGEX =
  /\b(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4})(?:\s*-\s*(\d+|[A-Za-z]+))?\b/gi;
const YEAR_REGEX = /\b(?:19|20)\d{2}\b/g;

function isValidCalendarDate(dayStr, monthStr, yearStr) {
  const day = Number(dayStr);
  const month = Number(monthStr);
  const year = Number(yearStr);

  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

function extractDatesFromText(text) {
  const entries = [];
  const seen = new Set();

  for (const match of (text || "").matchAll(DOT_DATE_REGEX)) {
    const day = match[1].padStart(2, "0");
    const month = match[2].padStart(2, "0");
    const year = match[3];
    const rawSuffix = match[4] ? match[4].trim().toUpperCase() : null;

    if (!isValidCalendarDate(day, month, year)) continue;

    // Preserve original hyphen/spacing style while normalizing letter case
    const suffixPart = match[4]
      ? match[0].slice(match[0].indexOf("-")).replace(/[a-z]+/gi, (s) => s.toUpperCase())
      : "";
    const rawDate = `${day}.${month}.${year}${suffixPart}`;

    if (!seen.has(rawDate)) {
      seen.add(rawDate);
      entries.push({
        rawDate, // e.g. "25.01.1974", "06.08.1970-1", "30.06.1974 - A"
        day, // "25"
        month, // "01"
        year, // "1974"
        suffix: rawSuffix, // e.g. "1", "A", or null
        isoDate: `${year}-${month}-${day}`, // "1974-01-25"
      });
    }
  }

  return entries;
}

function extractLinks($, $container) {
  const links = [];
  const seen = new Set();

  $container.find("a[href]").each((_, el) => {
    const $el = $(el);
    const href = ($el.attr("href") || "").trim();
    const label = $el.text().replace(/\s+/g, " ").trim();
    if (!href || href === "#" || seen.has(href)) return;
    seen.add(href);
    links.push({ label, href });
  });

  return links;
}

function parsePageContent(html) {
  const $ = cheerio.load(html || "");

  const rows = [];
  $("section.elementor-section").each((index, sec) => {
    const $sec = $(sec);
    const text = $sec.text().replace(/\s+/g, " ").trim();
    const dates = extractDatesFromText(text);
    const links = extractLinks($, $sec);
    const yearsFromTextAndLinks = [
      ...new Set(
        `${text} ${links.map((l) => l.href).join(" ")}`.match(YEAR_REGEX) || []
      ),
    ];

    if (dates.length > 0 || links.length > 0) {
      rows.push({
        sectionIndex: index,
        dates,
        years: [
          ...new Set([
            ...dates.map((d) => d.year),
            ...yearsFromTextAndLinks,
          ]),
        ],
        links,
      });
    }
  });

  const fullText = $.text().replace(/\s+/g, " ").trim();
  const allLinks = extractLinks($, $.root());
  const pageDates = extractDatesFromText(fullText);
  const pageYears = [
    ...new Set([
      ...pageDates.map((d) => d.year),
      ...(`${fullText} ${allLinks.map((l) => l.href).join(" ")}`.match(
        YEAR_REGEX
      ) || []),
    ]),
  ];

  return {
    dates: pageDates,
    years: pageYears,
    rows,
  };
}

async function main() {
  const response = await fetch(WP_API_URL);
  if (!response.ok) {
    throw new Error(
      `WP API request failed: ${response.status} ${response.statusText}`
    );
  }

  const pages = await response.json();

  const output = pages.map((page) => {
    const parsed = parsePageContent(page?.content?.rendered || "");
    return {
      id: page.id,
      slug: page.slug,
      title: page.title?.rendered || "",
      dates: parsed.dates,
      years: parsed.years,
      rows: parsed.rows,
    };
  });

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2), "utf8");
  console.log(`Saved ${output.length} pages to ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});