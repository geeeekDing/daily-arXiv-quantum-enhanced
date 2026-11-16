"""Prepare new arXiv announcements and build the site's historical date index."""

import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path


ARCHIVE_NAME = re.compile(r"(\d{4}-\d{2}-\d{2})(?:_AI_enhanced_(?:Chinese|English))?\.jsonl")
VERSION = re.compile(r"v[1-9]\d*$", re.IGNORECASE)


def paper_id(record):
    return VERSION.sub("", record["id"])


def read_rows(path):
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            if line.strip():
                yield json.loads(line)


def archived_files(directory):
    for path in sorted(directory.glob("*.jsonl")):
        match = ARCHIVE_NAME.fullmatch(path.name)
        if match:
            yield match[1], path


def write_index(archive):
    files = defaultdict(list)
    ids = defaultdict(set)
    translated = defaultdict(set)
    verified = set()
    for day, path in archived_files(archive / "data"):
        files[day].append(path.name)
        for record in read_rows(path):
            identifier = paper_id(record)
            ids[day].add(identifier)
            if ((record.get("AI") or {}).get("abstract_zh") or "").strip():
                translated[day].add(identifier)
            if record.get("announcement_date") == day:
                verified.add(day)

    # Identical sets represent the same issue. Prefer a verified announcement
    # date, then the most complete translations, then the earliest stored date.
    issues = {}
    for day in sorted(files):
        if not ids[day]:
            continue
        key = frozenset(ids[day])
        score = (day in verified, len(translated[day]))
        if key not in issues or score > issues[key][0]:
            issues[key] = (score, day)
    dates = {day for _, day in issues.values()}
    index = archive / "assets" / "file-list.txt"
    index.parent.mkdir(parents=True, exist_ok=True)
    index.write_text("".join(f"{name}\n" for day in sorted(dates) for name in files[day]), encoding="utf-8")
    print(f"Indexed {len(dates)} issues. Excluded {sum(bool(ids[day]) for day in files) - len(dates)} repeated dates.")


def prepare(args):
    batches = json.loads(args.manifest.read_text(encoding="utf-8"))
    dates = {date.fromisoformat(batch["date"]).isoformat() for batch in batches.values()}
    if len(dates) != 1:
        raise ValueError("arXiv categories returned different announcement dates. Retry after they update.")
    day = dates.pop()
    candidates = list(read_rows(args.crawl))
    if len(candidates) != sum(batch["count"] for batch in batches.values()) or any(
        row.get("announcement_date") != day for row in candidates
    ):
        raise ValueError("The exported papers do not match the arXiv announcement listing.")
    if args.expected_date and day != args.expected_date:
        print(f"arXiv {day}: waiting for the {args.expected_date} announcement.", file=sys.stderr)
        return 1

    history = set()
    existing = {}
    for archived_day, path in archived_files(args.archive / "data"):
        for record in read_rows(path):
            identifier = paper_id(record)
            if archived_day == day:
                existing.setdefault(identifier, record)
            else:
                history.add(identifier)

    new_papers = {}
    for record in candidates:
        identifier = paper_id(record)
        if identifier not in existing and identifier not in history:
            new_papers.setdefault(identifier, record)
    print(f"arXiv {day}: {len(candidates)} listed, {len(new_papers)} new to the archive.", file=sys.stderr)
    if not new_papers and not (args.resume_existing and candidates and existing):
        return 1

    args.output.mkdir(parents=True, exist_ok=True)
    target = args.output / f"{day}.jsonl"
    target.write_text(
        "".join(
            json.dumps({key: value for key, value in row.items() if key != "AI"}, ensure_ascii=False) + "\n"
            for row in [*existing.values(), *new_papers.values()]
        ),
        encoding="utf-8",
    )
    print(day)
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)
    batch = subcommands.add_parser("prepare", help="Filter a complete arXiv announcement against the archive.")
    for argument in ("crawl", "manifest", "archive", "output"):
        batch.add_argument(f"--{argument}", type=Path, required=True)
    batch.add_argument("--resume-existing", action="store_true", help="Resume processing the current local issue.")
    batch.add_argument("--expected-date", help="Wait for this announcement date during scheduled checks.")
    index = subcommands.add_parser("reindex", help="Hide empty and repeated dates from the website index.")
    index.add_argument("archive", type=Path)
    args = parser.parse_args()

    try:
        if args.command == "prepare":
            return prepare(args)
        write_index(args.archive)
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"arXiv archive: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
