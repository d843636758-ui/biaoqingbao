#!/usr/bin/env python3
# import_batch.py
# 批量上传 images/ 中的图片到 Supabase Storage，
# 并把 stickers-batch.json 中的元数据 upsert 到 sticker_catalog。
#
# 运行前：
#   pip install requests
#
# Windows PowerShell：
#   $env:SUPABASE_URL="https://cqoevridrpdgqjyiksok.supabase.co"
#   $env:SUPABASE_SERVICE_ROLE_KEY="你的 service_role key"
#   python import_batch.py
#
# 重要：service_role key 绝不能写进源码、截图、公开仓库。

from __future__ import annotations

import json
import mimetypes
import os
import sys
from pathlib import Path
from urllib.parse import quote

import requests

BASE_DIR = Path(__file__).resolve().parent
JSON_FILE = BASE_DIR / "stickers-batch.json"
IMAGES_DIR = BASE_DIR / "images"
BUCKET = "stickers"


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"缺少环境变量 {name}")
    return value.rstrip("/")


SUPABASE_URL = os.environ.get(
    "SUPABASE_URL",
    "https://cqoevridrpdgqjyiksok.supabase.co",
).strip().rstrip("/")
SERVICE_ROLE_KEY = require_env("SUPABASE_SERVICE_ROLE_KEY")

HEADERS = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
}


def public_url(storage_path: str) -> str:
    escaped = "/".join(quote(part, safe="") for part in storage_path.split("/"))
    return (
        f"{SUPABASE_URL}/storage/v1/object/public/"
        f"{BUCKET}/{escaped}"
    )


def upload_one(item: dict) -> None:
    if item.get("upload", True) is False:
        print(f"↷ 跳过已存在图片：{item['storage_path']}")
        return

    filename = str(item["filename"])
    storage_path = str(item["storage_path"]).lstrip("/")

    file_path = IMAGES_DIR / filename
    if not file_path.exists():
        raise FileNotFoundError(f"找不到图片：{file_path}")

    mime_type = (
        item.get("mime_type")
        or mimetypes.guess_type(file_path.name)[0]
        or "application/octet-stream"
    )

    escaped = "/".join(quote(part, safe="") for part in storage_path.split("/"))
    url = (
        f"{SUPABASE_URL}/storage/v1/object/"
        f"{BUCKET}/{escaped}"
    )

    with file_path.open("rb") as f:
        response = requests.post(
            url,
            headers={
                **HEADERS,
                "Content-Type": mime_type,
                "x-upsert": "true",
            },
            data=f,
            timeout=60,
        )

    if response.status_code not in (200, 201):
        raise RuntimeError(
            f"上传失败 {filename}: "
            f"{response.status_code} {response.text}"
        )

    print(f"✓ 图片已上传：{filename} -> {storage_path}")


def upsert_catalog(items: list[dict]) -> None:
    rows = []

    for item in items:
        storage_path = str(item["storage_path"]).lstrip("/")

        row = {
            "id": item["id"],
            "public_url": item.get("public_url") or public_url(storage_path),
            "filename": item["filename"],
            "storage_path": storage_path,
            "mime_type": item.get("mime_type") or "image/jpeg",
            "animated": bool(item.get("animated", False)),
            "ocr_text": item.get("ocr_text", ""),
            "visual_description": item.get("visual_description", ""),
            "semantic_intent": item.get("semantic_intent", ""),
            "tone_tags": item.get("tone_tags", []),
            "use_intents": item.get("use_intents", []),
            "avoid_when": item.get("avoid_when", []),
            "confidence": float(item.get("confidence", 1.0)),
            "is_adult": bool(item.get("is_adult", False)),
            "assistant_enabled": bool(item.get("assistant_enabled", True)),
        }

        rows.append(row)

    response = requests.post(
        f"{SUPABASE_URL}/rest/v1/sticker_catalog?on_conflict=id",
        headers={
            **HEADERS,
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=representation",
        },
        json=rows,
        timeout=60,
    )

    if response.status_code not in (200, 201):
        raise RuntimeError(
            f"数据库 upsert 失败："
            f"{response.status_code} {response.text}"
        )

    print(f"✓ sticker_catalog 已写入/更新 {len(rows)} 条")


def main() -> int:
    if not JSON_FILE.exists():
        print(f"找不到 {JSON_FILE}", file=sys.stderr)
        return 1

    if not IMAGES_DIR.exists():
        print(f"找不到图片目录 {IMAGES_DIR}", file=sys.stderr)
        return 1

    items = json.loads(JSON_FILE.read_text("utf-8"))

    if not isinstance(items, list) or not items:
        print("stickers-batch.json 必须是非空 JSON 数组", file=sys.stderr)
        return 1

    required = {"id", "filename", "storage_path"}

    for i, item in enumerate(items, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"第 {i} 条不是 JSON 对象")

        missing = required - set(item)
        if missing:
            raise ValueError(
                f"第 {i} 条缺字段：{', '.join(sorted(missing))}"
            )

    for item in items:
        upload_one(item)

    upsert_catalog(items)

    print("完成。去 Supabase Storage 和 Table Editor 各检查一次。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
