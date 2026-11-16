import json
import os
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote, urlsplit

import scrapy


LISTING_DATE = re.compile(r"Showing new listings for \w+, (\d{1,2} \w+ \d{4})")
NEW_SUBMISSIONS = re.compile(r"New submissions \(showing (\d+) of (\d+) entries\)")
SUBJECT_CODE = re.compile(r"\(([\w.-]+)\)")


def text_without_label(element):
    return element.xpath("normalize-space(string(.))").get(default="").partition(":")[2].strip()


class ArxivSpider(scrapy.Spider):
    name = "arxiv"
    allowed_domains = ["arxiv.org"]
    # The listing already provides the metadata and original abstract.
    custom_settings = {"ITEM_PIPELINES": {}}

    def __init__(self, manifest=None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        categories = (os.environ.get("CATEGORIES") or "quant-ph").split(",")
        self.categories = sorted({category.strip() for category in categories if category.strip()})
        if not self.categories:
            raise ValueError("No arXiv categories configured")
        self.start_urls = [f"https://arxiv.org/list/{cat}/new?show=2000" for cat in self.categories]
        self.manifest = Path(manifest) if manifest else None
        self.batches = {}

    def parse(self, response):
        category = urlsplit(response.url).path.split("/")[2]
        page = response.css("#dlpage")
        date_label = next(
            (match[1] for title in page.xpath("./h3/text()").getall()
             if (match := LISTING_DATE.fullmatch(title.strip()))),
            None,
        )
        if not date_label or category not in self.categories:
            raise ValueError(f"Could not verify arXiv announcement date for {response.url}")
        date = datetime.strptime(date_label, "%d %B %Y").date().isoformat()

        papers = []
        verified_layout = bool(page.css(".paging").re(r"Total of 0 entries"))
        for section in page.css("dl"):
            heading = section.xpath("normalize-space(h3)").get(default="")
            counts = NEW_SUBMISSIONS.fullmatch(heading)
            if not counts:
                if heading.startswith(("Cross submissions", "Replacement submissions")):
                    verified_layout = True
                continue

            verified_layout = True
            rows = section.xpath("./dt")
            shown, total = map(int, counts.groups())
            if shown != total or len(rows) != total:
                raise ValueError(f"Incomplete arXiv listing for {category} on {date}")
            for row in rows:
                link = row.css("a[title='Abstract']::attr(href)").get(default="")
                paper_path = urlsplit(link).path
                identifier = unquote(paper_path.removeprefix("/abs/"))
                details = row.xpath("following-sibling::*[1][self::dd]")
                title = text_without_label(details.css(".list-title"))
                abstract = details.css("p.mathjax").xpath("string(.)").get(default="").strip()
                primary = SUBJECT_CODE.findall(details.css(".primary-subject").xpath("string(.)").get(default=""))
                if not paper_path.startswith("/abs/") or not identifier or not title or not abstract or primary != [category]:
                    raise ValueError(f"Incomplete arXiv paper metadata for {category} on {date}: {link}")
                papers.append({
                    "id": identifier,
                    "announcement_date": date,
                    "abs": response.urljoin(f"/abs/{identifier}"),
                    "pdf": response.urljoin(f"/pdf/{identifier}"),
                    "title": title,
                    "authors": [name.strip() for name in details.css(".list-authors a::text").getall()],
                    "categories": SUBJECT_CODE.findall(text_without_label(details.css(".list-subjects"))),
                    "comment": text_without_label(details.css(".list-comments")) or None,
                    "summary": abstract,
                })
        if not verified_layout:
            raise ValueError(f"Could not verify arXiv listing for {category} on {date}")
        self.batches[category] = {"date": date, "count": len(papers)}
        yield from papers

    def closed(self, reason):
        if self.manifest is not None and reason == "finished" and set(self.batches) == set(self.categories):
            self.manifest.write_text(json.dumps(self.batches), encoding="utf-8")
