from __future__ import annotations

import argparse
import hashlib
import json
import re
import zipfile
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "db.json"
WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

INSPECTION_LABEL = "檢查項目"
REPAIR_LABEL = "維修項目"
RECOMMENDATION_LABEL = "建議更換項目"
SKIP_KEYWORDS = ("標準空白頁", "~$")
STATUS_CODES = {"V", "N", "C", "W", "A"}


def read_docx_paragraphs(path: Path) -> list[str]:
    with zipfile.ZipFile(path) as archive:
        document_xml = archive.read("word/document.xml")
    root = ET.fromstring(document_xml)
    paragraphs: list[str] = []

    for paragraph in root.iter(f"{WORD_NS}p"):
        text = "".join(node.text or "" for node in paragraph.iter(f"{WORD_NS}t")).strip()
        if text:
            paragraphs.append(re.sub(r"\s+", " ", text))

    return paragraphs


def clean_value(value: str) -> str:
    value = re.sub(r"^[；;：:\s]+", "", value or "")
    return value.strip()


def value_after_label(lines: list[str], label: str) -> str:
    for line in lines:
        if line.startswith(label):
            return clean_value(line[len(label) :])
    return ""


def normalize_date(raw: str, fallback_name: str) -> str:
    
    raw = raw or fallback_name
    match = re.search(r"(20\d{2})[-/]?(\d{2})[-/]?(\d{2})", raw)
    if match:
        return f"{match.group(1)}-{match.group(2)}-{match.group(3)}"

    match = re.search(r"(20\d{2})[-/]?(\d{4})", raw)
    if match:
        month_day = match.group(2)
        return f"{match.group(1)}-{month_day[:2]}-{month_day[2:]}"

    return ""

def extract_date_from_filename(path: Path) -> str:

    match = re.search(
        r"(20\d{2})[-_]?(\d{2})[-_]?(\d{2})",
        path.stem
    )

    if match:
        return (
            f"{match.group(1)}-"
            f"{match.group(2)}-"
            f"{match.group(3)}"
        )

    return ""


def parse_mileage(raw: str) -> int | None:

    if not raw:
        return None

    numbers = re.findall(
        r"\d+",
        raw.replace(",", "")
    )

    if not numbers:
        return None

    return int(numbers[-1])

def derive_from_folder(path: Path) -> tuple[str, str]:
    folder = path.parent.name
    parts = folder.split("-")
    if len(parts) >= 3 and parts[0].isdigit():
        return "-".join(parts[:2]), "-".join(parts[2:])
    return "", ""


def split_sections(lines: list[str]) -> tuple[list[str], list[str], str]:
    inspection: list[str] = []
    repairs: list[str] = []
    recommendations: list[str] = []
    section = ""

    for line in lines:
        if line.startswith(INSPECTION_LABEL):
            section = "inspection"
            continue
        if line.startswith(REPAIR_LABEL):
            section = "repair"
            continue
        if line.startswith(RECOMMENDATION_LABEL):
            section = "recommendation"
            tail = clean_value(line[len(RECOMMENDATION_LABEL) :])
            if tail:
                recommendations.append(tail)
            continue

        if line.startswith("V="):
            continue
        if section == "inspection":
            inspection.append(line)
        elif section == "repair":
            repairs.append(line)
        elif section == "recommendation":
            recommendations.append(line)

    return inspection, repairs, "、".join(recommendations)


def parse_inspection(lines: list[str]) -> tuple[list[str], list[dict]]:
    items: list[str] = []
    results: list[dict] = []

    for line in lines:
        if not line or line in {"O", "O+G"}:
            continue
        match = re.match(r"(.+?)\s*([VNCWA]+)\s*(.*)$", line)
        if match:
            item = match.group(1).strip()
            status = match.group(2).strip()
            note = match.group(3).strip()
        else:
            item, status, note = line.strip(), "", ""

        if item and item not in items:
            items.append(item)
        if item and (status or note):
            results.append({"item": item, "status": status, "note": note})

    return items, results


def parse_repairs(lines: list[str]) -> list[str]:
    repairs: list[str] = []
    template_items = {"前輪", "後輪", "前剎車", "後剎車", "空濾", "傳動", "燈具", "喇叭", "電瓶", "火星塞"}

    for line in lines:
        line = line.strip()
        if not line:
            continue
        if line in template_items:
            continue
        if line not in repairs:
            repairs.append(line)

    return repairs


def record_id(path: Path) -> str:
    digest = hashlib.sha1(str(path).encode("utf-8")).hexdigest()[:12].upper()
    return f"R-{digest}"


def parse_record(path: Path) -> dict | None:
    if any(keyword in path.name for keyword in SKIP_KEYWORDS):
        return None

    try:
        lines = read_docx_paragraphs(path)
    except Exception as exc:
        return {
            "id": record_id(path),
            "source": str(path),
            "importError": str(exc),
        }

    folder_plate, folder_model = derive_from_folder(path)
    raw_plate = value_after_label(lines, "車牌")
    raw_owner = value_after_label(lines, "車主")
    raw_engine = value_after_label(lines, "引擎號碼")
    raw_model = value_after_label(lines, "廠牌型式")
    raw_date = value_after_label(lines, "日期")
    raw_mileage = value_after_label(lines, "公里數")
    inspection_lines, repair_lines, recommendations = split_sections(lines)
    inspection_items, inspection_results = parse_inspection(inspection_lines)
    repair_items = parse_repairs(repair_lines)

    if not raw_plate and not folder_plate and not repair_items and not inspection_items:
        return None

    return {
        "id": record_id(path),
        "plate": raw_plate or folder_plate,
        "engineNo": raw_engine,
        "owner": raw_owner,
        "model": raw_model or folder_model,
        "date":extract_date_from_filename(path)
            or normalize_date(raw_date, path.stem),
        "mileage": parse_mileage(raw_mileage),
        "statusLegend": {
            "V": "正常",
            "N": "未檢測",
            "C": "已更換",
            "W": "建議更換",
            "A": "調整",
        },
        "inspectionItems": inspection_items,
        "inspectionResults": inspection_results,
        "repairItems": repair_items,
        "recommendations": recommendations,
        "source": str(path),
        "importedAt": datetime.now().isoformat(timespec="seconds"),
    }


def sort_key(record: dict) -> tuple[str, str]:
    return (record.get("date") or "0000-00-00", record.get("plate") or "")


def main() -> None:
    parser = argparse.ArgumentParser(description="Import repair DOCX files into data/db.json")
    parser.add_argument("--source", default=r"E:\維修紀錄", help="Repair folder path")
    parser.add_argument("--db", default=str(DB_PATH), help="db.json path")
    args = parser.parse_args()

    source = Path(args.source)
    db_path = Path(args.db)
    db = json.loads(db_path.read_text(encoding="utf-8"))

    records = []
    skipped = 0
    for docx_path in source.rglob("*.docx"):
        record = parse_record(docx_path)
        if record:
            records.append(record)
        else:
            skipped += 1

    records.sort(key=sort_key, reverse=True)
    db["records"] = records
    db["importStats"] = {
        "source": str(source),
        "totalRecords": len(records),
        "skippedFiles": skipped,
        "importedAt": datetime.now().isoformat(timespec="seconds"),
    }

    db_path.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(db["importStats"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
