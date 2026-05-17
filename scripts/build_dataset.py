import json
import re
import csv
import io
import os
from collections import OrderedDict
from pathlib import Path

import requests


ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = ROOT / "public" / "data" / "vocabulary.json"

# Google Sheets configuration
GOOGLE_SHEETS_ID = "1TSK53uLoA8nH8QV21jByxP1Hsf_x3q9HlfGMVufp-FU"

TARGET_SHEETS = OrderedDict(
    [
        ("War", "meaning"),
        ("Random", "meaning"),
        ("A World Undone", "meaning"),
        ("Competitive Exams", "bengali meaning"),
        ("Analogy", "bengali meaning"),
    ]
)

BANGLA_RANGE = re.compile(r"[\u0980-\u09FF]")
MOJIBAKE_HINTS = ("à¦", "à§", "Ã", "Â")


def clean_text(value: object, strip_terminal_punctuation: bool = False) -> str | None:
    if value is None or isinstance(value, bool):
        return None

    text = str(value).replace("\n", " ").replace("\u200d", "").strip()
    text = re.sub(r"\s+", " ", text)

    if strip_terminal_punctuation:
        text = re.sub(r"""[\s"'`.,;:!?।]+$""", "", text)

    return text or None


def debug_escape(value: object) -> str:
    if isinstance(value, str):
        return value.encode("unicode_escape").decode("ascii")
    return repr(value)


def fix_bangla_mojibake(value: str | None) -> str | None:
    """Repair UTF-8 text that was stored as Latin-1/Windows-1252 mojibake."""
    if not value:
        return value

    if BANGLA_RANGE.search(value):
        return value

    if not any(hint in value for hint in MOJIBAKE_HINTS):
        return value

    for encoding in ("latin1", "cp1252"):
        try:
            repaired = value.encode(encoding).decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue

        if BANGLA_RANGE.search(repaired):
            return repaired

    return value


def load_previous_ids() -> dict[tuple[str, str], int]:
    if not OUTPUT_PATH.exists():
        return {}

    try:
        previous = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}

    previous_ids: dict[tuple[str, str], int] = {}
    for entry in previous.get("entries", []):
        english = clean_text(entry.get("english"))
        bengali = clean_text(entry.get("bengali"))
        entry_id = entry.get("id")

        if not english or not bengali or not isinstance(entry_id, int):
            continue

        previous_ids[(english.casefold(), bengali.casefold())] = entry_id

    return previous_ids


def get_sheet_data(sheet_id: str, gid: int, max_retries: int = 3) -> list[list]:
    """Fetch sheet data from Google Sheets as CSV with encoding fix for mojibake"""
    csv_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"
    
    for attempt in range(max_retries):
        try:
            print(f"Fetching sheet (gid={gid})... (attempt {attempt + 1}/{max_retries})")
            response = requests.get(csv_url, timeout=60)
            response.raise_for_status()
            
            # Get raw bytes
            raw_bytes = response.content
            
            # Check if this looks like UTF-8 mojibake (too many high bytes)
            high_byte_count = sum(1 for b in raw_bytes[:500] if b > 127)
            print(f"  High bytes in first 500: {high_byte_count}")
            
            # Try to detect and fix double-encoding (UTF-8 bytes interpreted as Latin-1)
            try:
                # First, try normal UTF-8
                text = raw_bytes.decode('utf-8')
                print(f"  OK decoded with utf-8")
            except UnicodeDecodeError:
                try:
                    # Try UTF-8 with BOM
                    text = raw_bytes.decode('utf-8-sig')
                    print(f"  OK decoded with utf-8-sig")
                except UnicodeDecodeError:
                    try:
                        # Fix mojibake: UTF-8 bytes interpreted as Latin-1
                        # Re-interpret Latin-1 string as UTF-8
                        text_latin = raw_bytes.decode('iso-8859-1')
                        text = text_latin.encode('iso-8859-1').decode('utf-8')
                        print(f"  OK fixed UTF-8 mojibake (iso-8859-1 -> utf-8)")
                    except (UnicodeDecodeError, UnicodeEncodeError):
                        # Fallback to latin-1
                        text = raw_bytes.decode('iso-8859-1')
                        print(f"  OK decoded with iso-8859-1 (fallback)")
            
            # Parse CSV using csv module for proper handling
            csv_file = io.StringIO(text)
            reader = csv.reader(csv_file)
            rows = [row for row in reader]
            
            if rows:
                # Debug: print sample Bengali text
                for row in rows[1:3]:
                    if len(row) > 1:
                        print(
                            f"    Sample: {debug_escape(row[0][:20])} | "
                            f"{debug_escape(row[1][:20] if len(row) > 1 else '')}"
                        )
                        break
                
                print(f"OK fetched {len(rows)} rows")
                return rows
                
        except requests.exceptions.Timeout:
            print(f"ERR timeout (attempt {attempt + 1}/{max_retries})")
            if attempt < max_retries - 1:
                continue
            else:
                print(f"Error: Could not fetch sheet (gid={gid}) after {max_retries} attempts")
                return []
        except Exception as e:
            print(f"ERR error: {e}")
            if attempt < max_retries - 1:
                continue
            else:
                return []
    
    return []


def build_dataset() -> dict:
    # Sheet GIDs - these are the tab IDs in the Google Sheet
    # You can find gid in the URL: #gid=998634496
    sheet_gids = {
        "War": 0,
        "Random": 2437002,
        "A World Undone": 14183764,
        "Competitive Exams": 81797183,
        "Analogy": 998634496,
    }
    
    entries_by_key: OrderedDict[tuple[str, str], dict] = OrderedDict()
    source_counts: dict[str, int] = {}
    blank_rows: dict[str, int] = {}
    incomplete_rows: dict[str, int] = {}
    row_ranges: dict[str, dict[str, int]] = {}
    previous_id_by_key = load_previous_ids()
    reserved_ids = set(previous_id_by_key.values())
    next_id = max(reserved_ids, default=0) + 1

    def allocate_id(key: tuple[str, str]) -> int:
        nonlocal next_id

        existing_id = previous_id_by_key.get(key)
        if existing_id is not None:
            reserved_ids.add(existing_id)
            return existing_id

        while next_id in reserved_ids:
            next_id += 1

        allocated = next_id
        reserved_ids.add(allocated)
        next_id += 1
        return allocated

    for sheet_name, meaning_header in TARGET_SHEETS.items():
        gid = sheet_gids.get(sheet_name, 0)
        rows = get_sheet_data(GOOGLE_SHEETS_ID, gid)
        
        if not rows or len(rows) < 2:
            print(f"WARN skipping '{sheet_name}': no data found")
            continue
            
        header = rows[0]
        normalized_header = [
            clean_text(cell).casefold() if clean_text(cell) else "" for cell in header
        ]

        try:
            word_index = normalized_header.index("word")
            meaning_index = normalized_header.index(meaning_header.casefold())
        except ValueError as e:
            print(f"ERR '{sheet_name}': Missing column - {e}")
            continue
        
        # Find example column - prioritize "complex sentence"
        example_index = None
        possible_example_names = ["complex sentence", "example", "example sentence", "sentence", "example text"]
        for possible_name in possible_example_names:
            if possible_name in normalized_header:
                example_index = normalized_header.index(possible_name)
                print(f"  Using '{possible_name}' for examples")
                break

        source_counts[sheet_name] = 0
        blank_rows[sheet_name] = 0
        incomplete_rows[sheet_name] = 0
        min_row = float('inf')
        max_row = 0

        for row_idx, row in enumerate(rows[1:], start=2):
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
            bengali = fix_bangla_mojibake(bengali)
            example = clean_text(
                values[example_index] if example_index is not None and example_index < len(values) else None,
            )

            if not word or not bengali:
                incomplete_rows[sheet_name] += 1
                continue

            source_counts[sheet_name] += 1
            min_row = min(min_row, row_idx)
            max_row = max(max_row, row_idx)
            key = (word.casefold(), bengali.casefold())

            if key not in entries_by_key:
                entries_by_key[key] = {
                    "id": allocate_id(key),
                    "english": word,
                    "bengali": bengali,
                    "example": example,
                    "sources": {sheet_name: row_idx},
                }
                continue

            if sheet_name not in entries_by_key[key]["sources"]:
                entries_by_key[key]["sources"][sheet_name] = row_idx

        if min_row != float('inf'):
            row_ranges[sheet_name] = {"min": min_row, "max": max_row}

    entries = list(entries_by_key.values())

    return {
        "metadata": {
            "sourceWorkbook": "Google Sheets: Vocabulary.xlsx",
            "sourceUrl": f"https://docs.google.com/spreadsheets/d/{GOOGLE_SHEETS_ID}",
            "includedSheets": list(TARGET_SHEETS.keys()),
            "sourceCounts": source_counts,
            "blankRows": blank_rows,
            "incompleteRows": incomplete_rows,
            "totalSourcePairs": sum(source_counts.values()),
            "uniqueEntries": len(entries),
            "rowRanges": row_ranges,
        },
        "entries": entries,
    }


def main() -> None:
    dataset = build_dataset()
    
    # Debug: print raw Bengali values
    print("\nDebug - Sample Bengali values from dataset:")
    for i, entry in enumerate(dataset['entries'][1:5]):
        if 'bengali' in entry and entry['bengali']:
            print(
                f"  Entry {i}: {debug_escape(entry['english'])} -> "
                f"{debug_escape(entry['bengali'][:30])}"
            )
    
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Write with standard UTF-8 (no BOM)
    json_string = json.dumps(dataset, ensure_ascii=False, indent=2)
    temp_path = OUTPUT_PATH.with_name(f"{OUTPUT_PATH.name}.tmp")
    with open(temp_path, 'w', encoding='utf-8') as f:
        f.write(json_string)
        f.flush()
        os.fsync(f.fileno())
    temp_path.replace(OUTPUT_PATH)
    print(
        f"Wrote {dataset['metadata']['uniqueEntries']} entries to {OUTPUT_PATH.relative_to(ROOT)} (UTF-8)"
    )


if __name__ == "__main__":
    main()
