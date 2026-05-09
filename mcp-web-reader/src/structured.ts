import * as cheerio from "cheerio";

export function extractTables(html: string): string[] {
  const $ = cheerio.load(html);
  const tables: string[] = [];

  $("table").each((_, table) => {
    let markdown = "";
    const rows = $(table).find("tr");

    rows.each((i, row) => {
      const cells = $(row).find("th, td");
      let rowText = "| ";
      cells.each((_, cell) => {
        rowText += $(cell).text().trim().replace(/\|/g, "\\|") + " | ";
      });
      markdown += rowText + "\n";

      if (i === 0) {
        let separator = "| ";
        cells.each(() => {
          separator += "--- | ";
        });
        markdown += separator + "\n";
      }
    });

    if (markdown.trim()) {
      tables.push(markdown.trim());
    }
  });

  return tables;
}

export function extractMetadata(html: string): any[] {
  const $ = cheerio.load(html);
  const metadata: any[] = [];

  $('script[type="application/ld+json"]').each((_, script) => {
    try {
      const content = $(script).html();
      if (content) {
        const json = JSON.parse(content);
        metadata.push(json);
      }
    } catch {
      // ignore invalid JSON
    }
  });

  return metadata;
}
