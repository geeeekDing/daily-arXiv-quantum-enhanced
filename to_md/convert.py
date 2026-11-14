import argparse
import json
from collections import defaultdict
from pathlib import Path


TEMPLATE = Path(__file__).with_name("paper_template.md")


def render_paper(paper: dict, template: str) -> str:
    ai = paper.get("AI") or {}
    sections = []
    translation = ai.get("abstract_zh")
    if translation:
        sections.append(f"**中文摘要**\n\n{translation}")
        source = "正文结论节选与摘要" if ai.get("source") == "paper" else "摘要"
        if ai.get("conclusion"):
            sections.append(f"**研究结论（依据{source}）**\n\n{ai['conclusion']}")
        if ai.get("innovations"):
            points = "\n".join(f"- {point}" for point in ai["innovations"])
            sections.append(f"**创新点**\n\n{points}")

    sections.append(f"<details>\n<summary>原文摘要</summary>\n\n{paper.get('summary', '')}\n\n</details>")
    tags = list(ai.get("tags", []))
    applications = ai.get("application_tags") or []
    if applications:
        tags.append("量子应用 · " + "、".join(applications))
    return template.format(
        title=paper["title"],
        url=paper["abs"],
        authors="、".join(paper["authors"]),
        tags=" · ".join(tags),
        content="\n\n".join(sections),
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, required=True)
    args = parser.parse_args()

    groups = defaultdict(list)
    template = TEMPLATE.read_text(encoding="utf-8")
    with args.data.open(encoding="utf-8") as stream:
        for line in stream:
            if line.strip():
                paper = json.loads(line)
                category = (paper.get("categories") or ["未分类"])[0]
                groups[category].append(render_paper(paper, template))

    markdown = ["# arXiv 论文日报\n"]
    for category, papers in sorted(groups.items()):
        markdown.extend([f"## {category}（{len(papers)} 篇）\n", *papers])
    date = args.data.stem.split("_AI_enhanced_", 1)[0]
    args.data.with_name(f"{date}.md").write_text("\n".join(markdown), encoding="utf-8")


if __name__ == "__main__":
    main()
