import json
import re
from collections import OrderedDict
from pathlib import Path

from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parent.parent
WORKBOOK_PATH = ROOT / "Vocabulary.xlsx"
OUTPUT_PATH = ROOT / "public" / "data" / "vocabulary.json"

TARGET_SHEETS = OrderedDict(
    [
        ("War", "meaning"),
        ("Random", "meaning"),
        ("A World Undone", "meaning"),
        ("Competitive Exams", "bengali meaning"),
        ("Analogy", "bengali meaning"),
    ]
)


def clean_text(value: object, strip_terminal_punctuation: bool = False) -> str | None:
    if value is None or isinstance(value, bool):
        return None

    text = str(value).replace("\n", " ").replace("\u200d", "").strip()
    text = re.sub(r"\s+", " ", text)

    if strip_terminal_punctuation:
        text = re.sub(r"""[\s"'`.,;:!?।]+$""", "", text)

    return text or None


def build_dataset() -> dict:
    workbook = load_workbook(WORKBOOK_PATH, read_only=True, data_only=True)
    entries_by_key: OrderedDict[tuple[str, str], dict] = OrderedDict()
    source_counts: dict[str, int] = {}
    blank_rows: dict[str, int] = {}
    incomplete_rows: dict[str, int] = {}

    for sheet_name, meaning_header in TARGET_SHEETS.items():
        sheet = workbook[sheet_name]
        rows = sheet.iter_rows(values_only=True)
        header = next(rows)
        normalized_header = [
            clean_text(cell).casefold() if clean_text(cell) else "" for cell in header
        ]

        word_index = normalized_header.index("word")
        meaning_index = normalized_header.index(meaning_header)

        source_counts[sheet_name] = 0
        blank_rows[sheet_name] = 0
        incomplete_rows[sheet_name] = 0

        for row in rows:
            values = list(row)
            visible_values = [
                clean_text(value) for value in values if clean_text(value) is not None
            ]
            if not visible_values:
                blank_rows[sheet_name] += 1
                continue

            word = clean_text(
                values[word_index] if word_index < len(values) else None,
                strip_terminal_punctuation=True,
            )
            bengali = clean_text(
                values[meaning_index] if meaning_index < len(values) else None,
                strip_terminal_punctuation=True,
            )

            if not word or not bengali:
                incomplete_rows[sheet_name] += 1
                continue

            source_counts[sheet_name] += 1
            key = (word.casefold(), bengali.casefold())

            if key not in entries_by_key:
                entries_by_key[key] = {
                    "id": len(entries_by_key) + 1,
                    "english": word,
                    "bengali": bengali,
                    "sources": [sheet_name],
                }
                continue

            if sheet_name not in entries_by_key[key]["sources"]:
                entries_by_key[key]["sources"].append(sheet_name)

    entries = list(entries_by_key.values())

    return {
        "metadata": {
            "sourceWorkbook": WORKBOOK_PATH.name,
            "includedSheets": list(TARGET_SHEETS.keys()),
            "sourceCounts": source_counts,
            "blankRows": blank_rows,
            "incompleteRows": incomplete_rows,
            "totalSourcePairs": sum(source_counts.values()),
            "uniqueEntries": len(entries),
        },
        "entries": entries,
    }


def main() -> None:
    dataset = build_dataset()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(dataset, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(
        f"Wrote {dataset['metadata']['uniqueEntries']} entries to {OUTPUT_PATH.relative_to(ROOT)}"
    )


if __name__ == "__main__":
    main()
