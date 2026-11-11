"""Convert the CIBuzzBench CSV into the JSON glossary used by the app.

Source: CIBuzzBench (https://github.com/SuperYFan/CIBuzzBench) - 3,001 Chinese
internet buzzwords annotated with an English meaning, an English equivalent,
a category and a harmfulness label.

Usage:  python3 scripts/build_glossary.py
Input:  data/raw/cibuzzbench.csv
Output: data/slang_zh_cibuzzbench.json
"""
import csv
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "raw" / "cibuzzbench.csv"
OUT = ROOT / "data" / "slang_zh_cibuzzbench.json"


def main() -> None:
    entries = []
    with SRC.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            term = row["term_zh"].strip()
            if not term:
                continue
            entries.append(
                {
                    "id": f"cib-{row['row_id']}",
                    "term": term,
                    "lang": "zh",
                    "meaning_en": row["meaning_en"].strip(),
                    "equivalent_en": row["equivalent_en"].strip(),
                    "explanation_zh": row["explanation_zh"].strip(),
                    "category": row["category_label"].strip(),
                    "harmful": row["harmful_label"].strip() == "harmful",
                    # keep the official split so the evaluation can exclude test
                    # entries from retrieval (no answer leakage)
                    "split": row["split"].strip(),
                    "source": "CIBuzzBench",
                }
            )
    OUT.write_text(json.dumps(entries, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(entries)} entries to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
