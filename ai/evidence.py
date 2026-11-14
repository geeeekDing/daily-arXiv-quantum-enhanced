import re
from urllib.parse import quote
from urllib.request import urlopen

from lxml import html as lxml_html
from lxml.etree import ParserError


CONCLUSION_HEADING = re.compile(
    r"\b(conclusions?|concluding|summary|outlook|discussion)\b", re.IGNORECASE
)
EXPLICIT_CONCLUSION = re.compile(r"\b(conclusions?|concluding)\b", re.IGNORECASE)


def extract_conclusion(html: str) -> str:
    try:
        document = lxml_html.fromstring(html)
    except ParserError:
        return ""

    candidates = []
    for section in document.xpath("//section"):
        classes = set(section.get("class", "").split())
        if not classes.intersection({"ltx_section", "ltx_subsection"}):
            continue
        heading = " ".join(section.xpath("./*[self::h2 or self::h3 or self::h4]//text()"))
        if not CONCLUSION_HEADING.search(heading):
            continue

        paragraphs = []
        for paragraph in section.xpath(".//*[contains(concat(' ', normalize-space(@class), ' '), ' ltx_p ')]"):
            parts = paragraph.xpath(
                ".//text()[not(ancestor::*[local-name()='math'])] | .//*[local-name()='math']/@alttext"
            )
            content = " ".join("".join(parts).split())
            if content:
                paragraphs.append(content)
        if paragraphs:
            candidates.append((bool(EXPLICIT_CONCLUSION.search(heading)), "\n\n".join(paragraphs)))
    if not candidates:
        return ""
    return max(candidates, key=lambda candidate: candidate[0])[1][:12000]


def fetch_conclusion(paper_id: str) -> str:
    try:
        url = f"https://arxiv.org/html/{quote(paper_id, safe='/')}"
        with urlopen(url, timeout=8) as response:
            html = response.read(4_000_000).decode("utf-8", errors="replace")
        return extract_conclusion(html)
    except (OSError, ValueError):
        return ""
