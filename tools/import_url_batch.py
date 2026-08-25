#!/usr/bin/env python3
"""Mirror approved sticker URLs into Supabase Storage and upsert catalog rows."""

from __future__ import annotations

import concurrent.futures
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
MANIFEST = BASE_DIR / "sticker-url-batch.json"
BUCKET = "stickers"
MAX_IMAGE_BYTES = 12 * 1024 * 1024
ALLOWED_SOURCE_HOSTS = {"pic1.imgdb.cn", "iili.io"}
WORKERS = 8


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


def request_bytes(
    url: str,
    *,
    method: str = "GET",
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 45,
) -> tuple[bytes, dict[str, str]]:
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "User-Agent": "biaoqingbao-importer/1.0",
            **(headers or {}),
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read(MAX_IMAGE_BYTES + 1)
        if len(body) > MAX_IMAGE_BYTES:
            raise ValueError(f"响应超过 {MAX_IMAGE_BYTES} 字节：{url}")
        return body, {key.lower(): value for key, value in response.headers.items()}


def with_retries(action, description: str):
    last_error: Exception | None = None
    for attempt in range(1, 4):
        try:
            return action()
        except Exception as error:  # noqa: BLE001 - retries must cover transport failures
            last_error = error
            if attempt < 3:
                time.sleep(attempt * 2)
    raise RuntimeError(f"{description} 连续三次失败：{last_error}") from last_error


def assert_source_url(url: str) -> None:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED_SOURCE_HOSTS:
        raise ValueError(f"不允许的图片来源：{url}")


def extension_from_url(url: str) -> str:
    suffix = Path(urllib.parse.urlparse(url).path).suffix.lower()
    if suffix in {".png", ".gif", ".jpg", ".jpeg", ".webp"}:
        return ".jpg" if suffix == ".jpeg" else suffix
    raise ValueError(f"图片 URL 缺少受支持的扩展名：{url}")


def mime_for_extension(extension: str) -> str:
    return {
        ".png": "image/png",
        ".gif": "image/gif",
        ".jpg": "image/jpeg",
        ".webp": "image/webp",
    }[extension]


def verify_image(data: bytes, extension: str, source_url: str) -> None:
    checks = {
        ".png": data.startswith(b"\x89PNG\r\n\x1a\n"),
        ".gif": data.startswith((b"GIF87a", b"GIF89a")),
        ".jpg": data.startswith(b"\xff\xd8\xff"),
        ".webp": data.startswith(b"RIFF") and data[8:12] == b"WEBP",
    }
    if not data or not checks[extension]:
        raise ValueError(f"下载结果不是有效的 {extension} 图片：{source_url}")


def destination_exists(public_url: str) -> bool:
    try:
        request_bytes(
            public_url,
            headers={"Range": "bytes=0-0"},
            timeout=20,
        )
        return True
    except urllib.error.HTTPError as error:
        if error.code in {400, 404}:
            return False
        raise


def upload_image(storage_path: str, image: bytes, mime_type: str) -> None:
    escaped = "/".join(
        urllib.parse.quote(part, safe="") for part in storage_path.split("/")
    )
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{escaped}"
    request_bytes(
        url,
        method="POST",
        data=image,
        headers={
            "apikey": SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
            "Content-Type": mime_type,
            "x-upsert": "true",
        },
        timeout=60,
    )


def semantic_tags(label: str) -> list[str]:
    groups = {
        "开心正向": "开心 喜欢 爱 萌 棒 爽 幸福 漂亮 复活 支持 期待 骄傲 嘿嘿 得意 花 比心",
        "生气不满": "气 怒 恨 啧 嫌弃 走开 别搞 不听 拳头 咬 狠 笨",
        "难过委屈": "哭 委屈 受伤 可怜 寂寞 安慰 倒下 晕 灵魂 上天国",
        "疑惑震惊": "疑惑 问号 思考 构思 震惊 不对 何意味 怎么了 啊 哇",
        "亲昵安抚": "抱抱 蹭蹭 顺毛 拍拍 宝宝 爱你 亲亲",
        "疲惫休息": "困 睡 被窝 饿 累",
        "尴尬紧张": "汗 紧张 尴尬 被看穿 心虚 不好意思",
    }
    tags = []
    for tag, keywords in groups.items():
        if any(keyword in label for keyword in keywords.split()):
            tags.append(tag)
    return tags or ["日常反应"]


def build_row(
    slug: str,
    title: str,
    index: int,
    source_url: str,
    label: str,
) -> dict:
    extension = extension_from_url(source_url)
    sticker_id = f"st_{slug}_{index:03d}"
    filename = f"{sticker_id}{extension}"
    storage_path = f"imports/{slug}/{filename}"
    public_url = (
        f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{storage_path}"
    )
    tags = semantic_tags(label)

    return {
        "id": sticker_id,
        "source_url": source_url,
        "public_url": public_url,
        "filename": filename,
        "storage_path": storage_path,
        "mime_type": mime_for_extension(extension),
        "animated": extension == ".gif",
        "ocr_text": label,
        "visual_description": f"{title}表情包：{label}",
        "semantic_intent": f"在聊天中表达“{label}”这一反应或情绪",
        "tone_tags": [title, *tags],
        "use_intents": [f"聊天语境适合表达{label}时使用"],
        "avoid_when": ["正式严肃、对方可能误解或该反应会加剧冲突的场合"],
        "confidence": 0.94,
        "is_adult": False,
        "assistant_enabled": True,
    }


def mirror_one(row: dict) -> tuple[dict, bool]:
    source_url = row["source_url"]
    assert_source_url(source_url)

    exists = with_retries(
        lambda: destination_exists(row["public_url"]),
        f"检查目标 {row['id']}",
    )
    if exists:
        return row, False

    image, _ = with_retries(
        lambda: request_bytes(source_url),
        f"下载来源 {row['id']}",
    )
    extension = Path(row["filename"]).suffix.lower()
    verify_image(image, extension, source_url)
    with_retries(
        lambda: upload_image(row["storage_path"], image, row["mime_type"]),
        f"上传图片 {row['id']}",
    )
    return row, True


def upsert_rows(rows: list[dict]) -> None:
    catalog_rows = [
        {key: value for key, value in row.items() if key != "source_url"}
        for row in rows
    ]
    for start in range(0, len(catalog_rows), 50):
        batch = catalog_rows[start : start + 50]
        payload = json.dumps(batch, ensure_ascii=False).encode("utf-8")
        with_retries(
            lambda: request_bytes(
                f"{SUPABASE_URL}/rest/v1/sticker_catalog?on_conflict=id",
                method="POST",
                data=payload,
                headers={
                    "apikey": SERVICE_ROLE_KEY,
                    "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
                    "Content-Type": "application/json",
                    "Prefer": "resolution=merge-duplicates,return=minimal",
                },
                timeout=60,
            ),
            f"upsert 第 {start + 1}-{start + len(batch)} 条目录记录",
        )


def load_rows() -> list[dict]:
    manifest = json.loads(MANIFEST.read_text("utf-8"))
    rows = []
    seen_urls = set()
    seen_ids = set()

    for collection in manifest.get("collections", []):
        slug = str(collection["slug"])
        title = str(collection["title"])
        for index, pair in enumerate(collection.get("items", []), start=1):
            source_url, label = map(str, pair)
            row = build_row(slug, title, index, source_url, label)
            if source_url in seen_urls or row["id"] in seen_ids:
                raise ValueError(f"清单存在重复项：{source_url} / {row['id']}")
            seen_urls.add(source_url)
            seen_ids.add(row["id"])
            rows.append(row)

    if not rows:
        raise ValueError("清单为空")
    return rows


def main() -> int:
    rows = load_rows()
    uploaded = 0

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = [pool.submit(mirror_one, row) for row in rows]
        for completed, future in enumerate(
            concurrent.futures.as_completed(futures), start=1
        ):
            row, was_uploaded = future.result()
            uploaded += int(was_uploaded)
            action = "上传" if was_uploaded else "复用"
            print(f"[{completed:03d}/{len(rows)}] {action} {row['id']}")

    upsert_rows(rows)
    print(
        f"完成：目录 {len(rows)} 条；新上传 {uploaded} 张；"
        f"已存在 {len(rows) - uploaded} 张。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
