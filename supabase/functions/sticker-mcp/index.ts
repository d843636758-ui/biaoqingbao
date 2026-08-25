// sticker-mcp-final.ts
// 功能等价重建版：依据用户提供的《智能表情包 MCP · 零基础保姆级版》整理。
// 用法：Supabase -> Edge Functions -> New Function -> Via Editor
// Function name: sticker-mcp
// 删除模板代码，把本文件完整粘贴进去，再 Deploy。
// 部署后记得关闭 JWT verification。
//
// 本文件已写入项目 cqoevridrpdgqjyiksok 与控制组 control.png，
// 可直接粘贴部署，无需再替换占位符。

import { McpServer } from "npm:@modelcontextprotocol/sdk@1.30.0/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "npm:@modelcontextprotocol/sdk@1.30.0/server/webStandardStreamableHttp.js";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "npm:@modelcontextprotocol/ext-apps@1.7.5/server";
import { z } from "npm:zod@4.1.13";

// ─────────────────────────────────────────────────────────────────────────────
// 当前项目配置
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_ORIGIN =
  Deno.env.get("SUPABASE_URL") ??
  "https://cqoevridrpdgqjyiksok.supabase.co";

const STICKER_PATH =
  "/storage/v1/object/public/stickers/funny/control.png";

const STICKER_ALT =
  "控制组测试表情包（control.png）";

// ─────────────────────────────────────────────────────────────────────────────
// 一般不要动下面这些
// ─────────────────────────────────────────────────────────────────────────────

const SERVER_VERSION = "1.9.0";
// Keep every previously advertised UI URI readable. ChatGPT can retain a tool
// descriptor for an existing conversation, so removing an older URI makes the
// host fail before the iframe is even created ("Failed to fetch template").
const TEMPLATE_URI = "ui://sticker-mcp/sticker-v4.html";
const TEMPLATE_URIS = [
  TEMPLATE_URI,
  "ui://sticker-mcp/sticker-v3.html",
  "ui://sticker-mcp/sticker-v2.html",
  "ui://sticker-mcp/sticker.html",
] as const;
// ChatGPT hosts MCP UI resources in this sandbox. Supabase is only the image
// origin; using it as the widget origin makes iOS request an invalid Supabase
// route such as /ui://sticker-mcp/sticker.html.
const WIDGET_SANDBOX_ORIGIN = "https://web-sandbox.oaiusercontent.com";

type StickerRow = {
  id: string;
  public_url: string;
  filename?: string | null;
  storage_path?: string | null;
  mime_type?: string | null;
  animated?: boolean | null;
  ocr_text?: string | null;
  visual_description?: string | null;
  semantic_intent?: string | null;
  tone_tags?: string[] | null;
  use_intents?: string[] | null;
  avoid_when?: string[] | null;
  confidence?: number | null;
  is_adult?: boolean | null;
  assistant_enabled?: boolean | null;
  metadata_status?: string | null;
  auto_registered?: boolean | null;
};

type StickerCandidate = {
  id: string;
  public_url: string;
  ocr_text: string;
  visual_description: string;
  semantic_intent: string;
  tone_tags: string[];
  use_intents: string[];
  avoid_when: string[];
  confidence: number;
  score: number;
};

function readPublicKey(): string {
  // Supabase 项目通常会自动注入 SUPABASE_ANON_KEY。
  // 新项目若只提供 publishable key，也兼容下面两个常见名字。
  const key =
    Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    Deno.env.get("SB_PUBLISHABLE_KEY");

  if (!key) {
    throw new Error(
      "Missing Supabase public key. Expected SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEY / SB_PUBLISHABLE_KEY.",
    );
  }

  return key;
}

function normalizedOrigin(): string {
  return SUPABASE_ORIGIN.replace(/\/+$/, "");
}

function fallbackStickerUrl(): string {
  return `${normalizedOrigin()}${STICKER_PATH}`;
}

function authHeaders(): HeadersInit {
  const key = readPublicKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
}

function serviceHeaders(extra?: Record<string, string>): HeadersInit {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY for catalog enrichment.");
  }

  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...(extra ?? {}),
  };
}

const CATALOG_COLUMNS = [
  "id",
  "public_url",
  "filename",
  "storage_path",
  "mime_type",
  "animated",
  "ocr_text",
  "visual_description",
  "semantic_intent",
  "tone_tags",
  "use_intents",
  "avoid_when",
  "confidence",
  "is_adult",
  "assistant_enabled",
  "metadata_status",
  "auto_registered",
].join(",");

function safeArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((x) => String(x ?? "").trim()).filter(Boolean)
    : [];
}

function clean(row: StickerRow): StickerCandidate {
  return {
    id: String(row.id),
    public_url: String(row.public_url),
    ocr_text: String(row.ocr_text ?? ""),
    visual_description: String(row.visual_description ?? ""),
    semantic_intent: String(row.semantic_intent ?? ""),
    tone_tags: safeArray(row.tone_tags),
    use_intents: safeArray(row.use_intents),
    avoid_when: safeArray(row.avoid_when),
    confidence: Number(row.confidence ?? 1),
    score: 0,
  };
}

async function fetchEnabledStickers(): Promise<StickerRow[]> {
  const pageSize = 1000;
  const rows: StickerRow[] = [];

  for (let offset = 0; offset < 10_000; offset += pageSize) {
    const url =
      `${normalizedOrigin()}/rest/v1/sticker_catalog` +
      `?assistant_enabled=eq.true&metadata_status=eq.ready&select=${encodeURIComponent(CATALOG_COLUMNS)}` +
      `&order=id.asc&limit=${pageSize}&offset=${offset}`;

    const response = await fetch(url, {
      headers: authHeaders(),
    });

    if (!response.ok) {
      throw new Error(
        `Supabase sticker_catalog query failed: ${response.status} ${await response.text()}`,
      );
    }

    const page: StickerRow[] = await response.json();
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

async function fetchStickerById(id: string): Promise<StickerRow | null> {
  const url =
    `${normalizedOrigin()}/rest/v1/sticker_catalog` +
    `?id=eq.${encodeURIComponent(id)}` +
    `&assistant_enabled=eq.true` +
    `&metadata_status=eq.ready` +
    `&select=${encodeURIComponent(CATALOG_COLUMNS)}` +
    `&limit=1`;

  const response = await fetch(url, {
    headers: authHeaders(),
  });

  if (!response.ok) {
    throw new Error(
      `Supabase sticker lookup failed: ${response.status} ${await response.text()}`,
    );
  }

  const rows: StickerRow[] = await response.json();
  return rows[0] ?? null;
}

async function fetchNextPendingSticker(): Promise<StickerRow | null> {
  const url =
    `${normalizedOrigin()}/rest/v1/sticker_catalog` +
    `?metadata_status=eq.pending&auto_registered=eq.true` +
    `&select=${encodeURIComponent(CATALOG_COLUMNS)}` +
    `&order=created_at.asc&limit=1`;
  const response = await fetch(url, { headers: serviceHeaders() });

  if (!response.ok) {
    throw new Error(
      `Pending sticker query failed: ${response.status} ${await response.text()}`,
    );
  }

  const rows: StickerRow[] = await response.json();
  return rows[0] ?? null;
}

async function pendingStickerContent(row: StickerRow): Promise<Array<
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
>> {
  const result: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  > = [
    {
      type: "text",
      text: JSON.stringify(
        {
          pending: true,
          sticker_id: row.id,
          filename: row.filename ?? "",
          storage_path: row.storage_path ?? "",
          instruction:
            "请查看随附图片，准确读取可见文字并概括画面、语义、语气、适用语境和避用语境；随后调用 save_sticker_metadata 写回。不要仅根据文件名猜测。",
        },
        null,
        2,
      ),
    },
  ];

  const response = await fetch(row.public_url);
  if (!response.ok) {
    throw new Error(`Pending image fetch failed: ${response.status}`);
  }

  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > 12 * 1024 * 1024) {
    throw new Error("Pending image is larger than 12 MB");
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 12 * 1024 * 1024) {
    throw new Error("Pending image is larger than 12 MB");
  }

  result.push({
    type: "image",
    data: bytesToBase64(bytes),
    mimeType:
      response.headers.get("content-type")?.split(";")[0]?.trim() ||
      row.mime_type ||
      "image/jpeg",
  });
  return result;
}

type StickerMetadataInput = {
  sticker_id: string;
  ocr_text: string;
  visual_description: string;
  semantic_intent: string;
  tone_tags: string[];
  use_intents: string[];
  avoid_when: string[];
  confidence: number;
  is_adult: boolean;
};

async function savePendingStickerMetadata(
  metadata: StickerMetadataInput,
): Promise<StickerRow> {
  const enabled = !metadata.is_adult;
  const url =
    `${normalizedOrigin()}/rest/v1/sticker_catalog` +
    `?id=eq.${encodeURIComponent(metadata.sticker_id)}` +
    `&metadata_status=eq.pending&auto_registered=eq.true` +
    `&select=${encodeURIComponent(CATALOG_COLUMNS)}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: serviceHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation",
    }),
    body: JSON.stringify({
      ocr_text: metadata.ocr_text,
      visual_description: metadata.visual_description,
      semantic_intent: metadata.semantic_intent,
      tone_tags: metadata.tone_tags,
      use_intents: metadata.use_intents,
      avoid_when: metadata.avoid_when,
      confidence: metadata.confidence,
      is_adult: metadata.is_adult,
      assistant_enabled: enabled,
      metadata_status: enabled ? "ready" : "blocked",
      metadata_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Sticker metadata update failed: ${response.status} ${await response.text()}`,
    );
  }

  const rows: StickerRow[] = await response.json();
  if (!rows[0]) {
    throw new Error(
      "Sticker metadata was not updated; it may already have been reviewed.",
    );
  }
  return rows[0];
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function extractTerms(text: string): string[] {
  const raw = normalizeText(text);
  if (!raw) return [];

  const terms = new Set<string>();

  for (const part of raw.split(/[\s,，。.!！？?、;；:："'“”‘’()（）[\]【】<>《》]+/g)) {
    if (part.length >= 1) terms.add(part);

    // 中文长句补 2/3/4 字片段，避免完整句子匹配不到。
    if (/[\u3400-\u9fff]/.test(part) && part.length >= 2) {
      for (const n of [2, 3, 4]) {
        if (part.length < n) continue;
        for (let i = 0; i <= part.length - n; i++) {
          terms.add(part.slice(i, i + n));
        }
      }
    }
  }

  return [...terms].slice(0, 80);
}

function countHits(haystack: string, terms: string[]): number {
  const h = normalizeText(haystack);
  let hits = 0;
  for (const term of terms) {
    if (term && h.includes(term)) hits += 1;
  }
  return hits;
}

function scoreSticker(
  sticker: StickerCandidate,
  query: string,
  emotion?: string,
  tone?: string,
): number {
  const terms = extractTerms([query, emotion ?? "", tone ?? ""].join(" "));

  if (terms.length === 0) return sticker.confidence;

  const ocrHits = countHits(sticker.ocr_text, terms);
  const semanticHits = countHits(sticker.semantic_intent, terms);
  const visualHits = countHits(sticker.visual_description, terms);
  const toneHits = countHits(sticker.tone_tags.join(" "), terms);
  const useHits = countHits(sticker.use_intents.join(" "), terms);
  const avoidHits = countHits(sticker.avoid_when.join(" "), terms);

  // 教程强调：语义、标签、用途为主；avoid_when 必须参与过滤/降权。
  return (
    semanticHits * 5 +
    toneHits * 4 +
    useHits * 4 +
    ocrHits * 3 +
    visualHits * 1.5 -
    avoidHits * 8 +
    Math.max(0, sticker.confidence)
  );
}

function candidateSummary(c: StickerCandidate) {
  return {
    id: c.id,
    ocr_text: c.ocr_text,
    visual_description: c.visual_description,
    semantic_intent: c.semantic_intent,
    tone_tags: c.tone_tags,
    use_intents: c.use_intents,
    avoid_when: c.avoid_when,
    confidence: c.confidence,
    score: Number(c.score.toFixed(3)),
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function createStickerContent(
  url: string,
  alt: string,
  finalMarkdown: string,
): Promise<Array<
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
>> {
  const result: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  > = [
    {
      type: "text",
      text:
        `${alt}\n\n` +
        "iOS may collapse the inline tool card after the answer completes. " +
        "In the final user-visible reply, copy the following Markdown image " +
        `exactly once, outside a code block:\n\n${finalMarkdown}`,
    },
  ];

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`image fetch failed: ${response.status}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const mimeType =
      response.headers.get("content-type")?.split(";")[0]?.trim() ||
      "image/jpeg";

    result.push({
      type: "image",
      data: bytesToBase64(bytes),
      mimeType,
    });
  } catch (error) {
    // 图片小组件仍可按 public URL 显示；同时让模型知道标准 image 内容未能附加。
    result.push({
      type: "text",
      text: `标准 MCP 图片内容生成失败：${String(error)}`,
    });
  }

  return result;
}

function buildStickerPayload(stickerId: string, row: StickerRow | null) {
  let url = fallbackStickerUrl();
  let alt = STICKER_ALT;
  let caption = `sticker_id: ${stickerId}`;

  if (row) {
    const sticker = clean(row);
    url = sticker.public_url || fallbackStickerUrl();
    alt =
      sticker.ocr_text ||
      sticker.semantic_intent ||
      sticker.visual_description ||
      STICKER_ALT;
    caption = [
      sticker.ocr_text,
      sticker.semantic_intent,
      sticker.tone_tags.length ? `语气：${sticker.tone_tags.join("、")}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  } else {
    caption = `没有查到 ${stickerId}，已显示控制组兜底图片。`;
  }

  return {
    url,
    alt,
    caption,
    sticker_id: stickerId,
    final_markdown: `![表情包](${url})`,
  };
}

const WIDGET_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>表情包</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      min-height: 48px;
      background: transparent;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .wrap {
      width: 100%;
      min-height: 48px;
      display: flex;
      justify-content: flex-start;
      padding: 2px;
    }
    .card {
      max-width: min(360px, 100%);
      border-radius: 18px;
      overflow: hidden;
      background: rgba(127,127,127,.08);
      border: 1px solid rgba(127,127,127,.16);
    }
    img {
      display: block;
      max-width: 100%;
      width: auto;
      height: auto;
      max-height: 420px;
      object-fit: contain;
      background: transparent;
    }
    .caption {
      display: none;
      padding: 9px 12px 10px;
      font-size: 12px;
      line-height: 1.4;
      opacity: .72;
    }
    .error {
      display: none;
      padding: 12px;
      font-size: 13px;
    }
    .loading {
      padding: 12px;
      font-size: 13px;
      opacity: .72;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <img id="sticker" alt="表情包" />
      <div id="caption" class="caption"></div>
      <div id="loading" class="loading">正在加载表情包…</div>
      <div id="error" class="error">表情包加载失败</div>
    </div>
  </div>

  <script>
    (() => {
      const img = document.getElementById("sticker");
      const caption = document.getElementById("caption");
      const loading = document.getElementById("loading");
      const error = document.getElementById("error");
      let rendered = false;
      let fallbackStickerId = "";
      let lastPayload = null;
      let lastSavedState = "";
      let heightFrame = 0;

      // MCP Apps bridge is kept inline so iOS never has to download a runtime
      // module before it can receive the initial tool result. v1.5 used
      // @modelcontextprotocol/ext-apps@1.7.5/app-with-deps + app.connect();
      // this is the equivalent minimal ui/initialize handshake.
      let bridgeRequestId = 1;
      const pendingBridgeRequests = new Map();

      function postBridge(message) {
        window.parent.postMessage(message, "*");
      }

      function requestBridge(method, params) {
        const id = bridgeRequestId++;
        postBridge({ jsonrpc: "2.0", id, method, params });
        return new Promise((resolve, reject) => {
          const timeout = window.setTimeout(() => {
            pendingBridgeRequests.delete(id);
            reject(new Error("MCP Apps bridge timeout"));
          }, 5000);
          pendingBridgeRequests.set(id, { resolve, reject, timeout });
        });
      }

      function notifyBridge(method, params) {
        postBridge({ jsonrpc: "2.0", method, params });
      }

      async function connectBridge() {
        try {
          await requestBridge("ui/initialize", {
            protocolVersion: "2026-01-26",
            appCapabilities: {},
            clientInfo: { name: "sticker-viewer", version: "1.7.0" }
          });
          notifyBridge("ui/notifications/initialized", {});
          reportHeight();
        } catch (_) {
          // Legacy window.openai and widget-data fallbacks remain active.
        }
      }

      function extractPayload(value, depth) {
        if (!value || typeof value !== "object" || depth > 5) return null;
        if (typeof value.url === "string" && value.url) return value;

        const candidates = [
          value.widgetState,
          value.privateContent,
          value.sticker,
          value.state,
          value.structuredContent,
          value.toolOutput,
          value.toolResponseMetadata,
          value.result,
          value.mcp_tool_result,
          value.call_tool_result,
          value.content
        ];

        for (const candidate of candidates) {
          const payload = extractPayload(candidate, depth + 1);
          if (payload) return payload;
        }

        return null;
      }

      function extractStickerId(value, depth) {
        if (!value || typeof value !== "object" || depth > 5) return "";
        if (typeof value.sticker_id === "string") return value.sticker_id;

        const candidates = [
          value.toolInput,
          value.arguments,
          value.params,
          value.structuredContent,
          value.result,
          value.mcp_tool_result,
          value.call_tool_result
        ];

        for (const candidate of candidates) {
          const stickerId = extractStickerId(candidate, depth + 1);
          if (stickerId) return stickerId;
        }

        return "";
      }

      function reportHeight() {
        if (heightFrame) window.cancelAnimationFrame(heightFrame);
        heightFrame = window.requestAnimationFrame(() => {
          heightFrame = 0;
          const root = document.documentElement;
          const body = document.body;
          const width = Math.ceil(Math.max(root.scrollWidth, body.scrollWidth));
          const height = Math.ceil(
            Math.max(48, root.scrollHeight, body.scrollHeight)
          );

          // Portable MCP Apps hosts consume this notification. ChatGPT also
          // exposes notifyIntrinsicHeight as a compatibility extension.
          notifyBridge("ui/notifications/size-changed", { width, height });
          try {
            if (window.openai && window.openai.notifyIntrinsicHeight) {
              window.openai.notifyIntrinsicHeight();
            }
          } catch (_) {}
        });
      }

      function persistPayload(data) {
        const payload = {
          url: data.url,
          alt: typeof data.alt === "string" ? data.alt : "表情包",
          caption: typeof data.caption === "string" ? data.caption : "",
          sticker_id:
            typeof data.sticker_id === "string" ? data.sticker_id : ""
        };
        const serialized = JSON.stringify(payload);
        if (serialized === lastSavedState) return;

        try {
          if (window.openai && window.openai.setWidgetState) {
            // This snapshot belongs to the rendered card. It lets ChatGPT
            // reconstruct the image when iOS rehydrates the conversation.
            window.openai.setWidgetState({ sticker: payload });
            lastSavedState = serialized;
          }
        } catch (_) {}
      }

      function render(value) {
        const data = extractPayload(value, 0);
        if (!data) return false;

        const url = typeof data.url === "string" ? data.url : "";
        const alt = typeof data.alt === "string" ? data.alt : "表情包";
        const cap = typeof data.caption === "string" ? data.caption : "";

        if (!url) return false;

        rendered = true;
        lastPayload = {
          url,
          alt,
          caption: cap,
          sticker_id:
            typeof data.sticker_id === "string" ? data.sticker_id : ""
        };
        img.alt = alt;
        loading.style.display = img.complete && img.naturalWidth ? "none" : "block";
        error.style.display = "none";
        img.style.display = "block";
        img.src = url;

        if (cap) {
          caption.textContent = cap;
          // 默认不占空间；如果你以后想显示说明，把下一行改成 "block"。
          caption.style.display = "none";
        }

        persistPayload(lastPayload);
        reportHeight();

        return true;
      }

      async function renderFromToolInput(value) {
        const stickerId = extractStickerId(value, 0);
        if (!stickerId || rendered || fallbackStickerId === stickerId) return;

        fallbackStickerId = stickerId;
        try {
          const endpoint =
            "https://cqoevridrpdgqjyiksok.supabase.co/functions/v1/" +
            "sticker-mcp/widget-data?sticker_id=" +
            encodeURIComponent(stickerId);
          const response = await fetch(endpoint, { method: "GET" });
          if (!response.ok) throw new Error("widget fallback failed");
          render(await response.json());
        } catch (_) {
          fallbackStickerId = "";
        }
      }

      img.addEventListener("load", () => {
        loading.style.display = "none";
        error.style.display = "none";
        img.style.display = "block";
        reportHeight();
      });

      img.addEventListener("error", () => {
        loading.style.display = "none";
        img.style.display = "none";
        error.style.display = "block";
        reportHeight();
      });

      // ChatGPT Apps SDK 兼容层：先读当前 toolOutput。
      try {
        render(window.openai && window.openai.widgetState);
        render(window.openai && window.openai.toolOutput);
        render(window.openai && window.openai.toolResponseMetadata);
        renderFromToolInput(window.openai);
      } catch (_) {}

      // 当 ChatGPT 把 structuredContent 更新进 widget 时再渲染。
      window.addEventListener(
        "openai:set_globals",
        (event) => {
          try {
            const globals = event && event.detail && event.detail.globals;
            render(globals && globals.widgetState);
            render(globals);
            render(window.openai);
            renderFromToolInput(globals);
            renderFromToolInput(window.openai);
          } catch (_) {}
        },
        { passive: true }
      );

      // MCP Apps 标准桥接的兜底：接收 ui/notifications/tool-result。
      window.addEventListener(
        "message",
        (event) => {
          if (event.source !== window.parent) return;
          const message = event.data;
          if (!message || message.jsonrpc !== "2.0") return;

          try {
            if (message.id != null && pendingBridgeRequests.has(message.id)) {
              const pending = pendingBridgeRequests.get(message.id);
              pendingBridgeRequests.delete(message.id);
              window.clearTimeout(pending.timeout);
              if (message.error) pending.reject(message.error);
              else pending.resolve(message.result);
              return;
            }
            if (message.method === "ui/notifications/tool-result") {
              render(message.params);
            }
            if (message.method === "ui/notifications/tool-input") {
              renderFromToolInput(message.params);
            }
          } catch (_) {}
        },
        { passive: true }
      );

      connectBridge();

      // Rehydrate after iOS scroll recycling, returning from background, or
      // transcript restoration. The server remains the source of truth; the
      // widget snapshot only prevents a visible card from disappearing.
      function restoreAndResize() {
        try {
          render(window.openai && window.openai.widgetState);
          render(window.openai && window.openai.toolOutput);
          render(window.openai && window.openai.toolResponseMetadata);
          if (!rendered && lastPayload) render(lastPayload);
          renderFromToolInput(window.openai);
        } catch (_) {}
        reportHeight();
      }

      window.addEventListener("pageshow", restoreAndResize, { passive: true });
      window.addEventListener("focus", restoreAndResize, { passive: true });
      document.addEventListener(
        "visibilitychange",
        () => {
          if (!document.hidden) restoreAndResize();
        },
        { passive: true }
      );

      if (typeof ResizeObserver !== "undefined") {
        const resizeObserver = new ResizeObserver(reportHeight);
        resizeObserver.observe(document.body);
      }

      // Some mobile clients attach the bridge after the document has loaded.
      // Brief polling avoids a permanent blank card without making requests.
      let attempts = 0;
      const timer = window.setInterval(() => {
        attempts += 1;
        try {
          render(window.openai && window.openai.widgetState);
          render(window.openai);
          renderFromToolInput(window.openai);
        } catch (_) {}
        if (rendered || attempts >= 150) {
          window.clearInterval(timer);
          reportHeight();
        }
      }, 100);
    })();
  </script>
</body>
</html>`;

function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "智能表情包 MCP",
      version: SERVER_VERSION,
    },
    {
      instructions:
        "Storage 自动入库：search_stickers 或 inspect_pending_sticker 若附带待识别图片，必须先看图，调用 save_sticker_metadata 写回真实中文 OCR、画面描述、语义、语气、用途与避用语境；不要根据文件名猜。每轮最多处理 3 张。" +
        "表情包发送：用 search_stickers 选真实 ID，再调用 send_sticker。" +
        "调用 send_sticker 后，最终用户可见回复必须逐字包含 structuredContent.final_markdown，" +
        "只输出一次且不得放进代码块；这是 iOS 在回答结束后收起内联工具卡时的持久图片后备，不得省略。",
    },
  );

  server.registerTool(
    "inspect_pending_sticker",
    {
      title: "识别新上传表情包",
      description:
        "读取一张由 Supabase Storage 自动登记、但尚未生成检索语义的新图片。若返回 pending=true，必须查看随附图片并调用 save_sticker_metadata；不得仅按小写文件名猜内容。每轮最多处理 3 张。",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      const pending = await fetchNextPendingSticker();
      if (!pending) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ pending: false, message: "没有待识别图片" }),
            },
          ],
        };
      }
      return { content: await pendingStickerContent(pending) };
    },
  );

  server.registerTool(
    "save_sticker_metadata",
    {
      title: "保存表情包中文语义",
      description:
        "只用于 inspect_pending_sticker 或 search_stickers 返回的 st_auto_ 待识别图片。根据实际画面写入中文 OCR、描述、聊天语义、语气标签、适用和避用语境；成功后图片会自动进入可检索目录。",
      inputSchema: {
        sticker_id: z.string().regex(/^st_auto_[a-f0-9]{20}$/),
        ocr_text: z.string().max(500).describe("图片中实际可见文字；没有文字传空字符串"),
        visual_description: z.string().min(4).max(1000),
        semantic_intent: z.string().min(2).max(600),
        tone_tags: z.array(z.string().min(1).max(50)).min(1).max(16),
        use_intents: z.array(z.string().min(2).max(160)).min(1).max(10),
        avoid_when: z.array(z.string().min(2).max(160)).max(10).default([]),
        confidence: z.number().min(0).max(1).default(0.9),
        is_adult: z.boolean().default(false),
      },
      outputSchema: {
        saved: z.boolean(),
        sticker_id: z.string(),
        metadata_status: z.string(),
        assistant_enabled: z.boolean(),
        message: z.string(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (metadata) => {
      const saved = await savePendingStickerMetadata(metadata);
      const payload = {
        saved: true,
        sticker_id: saved.id,
        metadata_status: String(saved.metadata_status ?? ""),
        assistant_enabled: Boolean(saved.assistant_enabled),
        message: saved.assistant_enabled
          ? "中文语义已写回，图片现在可检索"
          : "图片已识别，但因内容分级未启用",
      };
      return {
        structuredContent: payload,
        content: [
          {
            type: "text",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  );

  // 重要：search_stickers 只是普通 MCP Tool。
  // 不绑定 UI，不返回 structuredContent。
  server.registerTool(
    "search_stickers",
    {
      title: "搜索表情包",
      description:
        "根据当前完整聊天语境搜索表情包候选。若结果末尾附带 pending=true 的新上传图片，先看图并调用 save_sticker_metadata；同时仍可从 candidates 选真实 ID，再调用 send_sticker。",
      inputSchema: {
        query: z.string().min(2).describe("概括当前完整语境，而不是只写一个词"),
        emotion: z.string().optional().describe("可选：情绪，例如开心、委屈、生气"),
        tone: z.string().optional().describe("可选：语气，例如撒娇、吐槽、调情、震惊"),
        limit: z.number().int().min(1).max(12).optional().default(6),
        exclude_ids: z
          .array(z.string())
          .optional()
          .default([])
          .describe("已经发过的 sticker_id；用户说再来一个时用于排除重复"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ query, emotion, tone, limit, exclude_ids }) => {
      const excluded = new Set(exclude_ids ?? []);
      const rows = await fetchEnabledStickers();

      const candidates = rows
        .map(clean)
        .filter((item) => !excluded.has(item.id))
        .map((item) => ({
          ...item,
          score: scoreSticker(item, query, emotion, tone),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit ?? 6);

      const payload = {
        query,
        emotion: emotion ?? null,
        tone: tone ?? null,
        candidates: candidates.map(candidateSummary),
      };

      const content: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
      > = [
        {
          type: "text",
          text: JSON.stringify(payload, null, 2),
        },
      ];

      try {
        const pending = await fetchNextPendingSticker();
        if (pending) content.push(...await pendingStickerContent(pending));
      } catch (error) {
        content.push({
          type: "text",
          text: `待识别图片读取暂时失败，不影响现有目录检索：${String(error)}`,
        });
      }

      return { content };
    },
  );

  // send_sticker 同时提供标准 MCP image content 与 MCP Apps URL 组件：
  // 原生图片是后备，组件通过标准 ui/initialize 桥跨端接收结果。
  registerAppTool(
    server,
    "send_sticker",
    {
      title: "发送表情包",
      description:
        "把 search_stickers 返回的真实 sticker_id 原样传入；按 ID 查询 sticker_catalog 并显示对应图片。不要编造 ID。调用后，最终回复必须原样包含 structuredContent.final_markdown（不要放代码块），确保 iOS 收起中间工具卡后图片仍留在消息正文。",
      inputSchema: {
        sticker_id: z
          .string()
          .min(1)
          .describe("必须来自 search_stickers.candidates[].id"),
      },
      outputSchema: {
        url: z.string().url(),
        alt: z.string(),
        caption: z.string(),
        sticker_id: z.string(),
        final_markdown: z.string(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          resourceUri: TEMPLATE_URI,
          visibility: ["model", "app"],
        },
        "openai/outputTemplate": TEMPLATE_URI,
        "openai/toolInvocation/invoking": "正在加载表情包…",
        "openai/toolInvocation/invoked": "表情包已就绪",
      },
    },
    async ({ sticker_id }) => {
      const row = await fetchStickerById(sticker_id);
      const payload = buildStickerPayload(sticker_id, row);

      return {
        structuredContent: payload,
        content: await createStickerContent(
          payload.url,
          payload.alt,
          payload.final_markdown,
        ),
      };
    },
  );

  for (const [index, resourceUri] of TEMPLATE_URIS.entries()) {
    registerAppResource(
      server,
      `表情包图片组件 ${index + 1}`,
      resourceUri,
      {},
      async () => ({
        contents: [
          {
            uri: resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: WIDGET_HTML,
            _meta: {
              ui: {
                prefersBorder: false,
                domain: WIDGET_SANDBOX_ORIGIN,
                csp: {
                  resourceDomains: [normalizedOrigin()],
                  connectDomains: [normalizedOrigin()],
                },
              },
              // Keep the legacy aliases for ChatGPT clients that have not yet
              // migrated to the standard `_meta.ui` fields.
              "openai/widgetPrefersBorder": false,
              "openai/widgetDescription": "显示 send_sticker 选中的真实表情包图片。",
              "openai/widgetDomain": WIDGET_SANDBOX_ORIGIN,
              "openai/widgetCSP": {
                resource_domains: [normalizedOrigin()],
                connect_domains: [normalizedOrigin()],
              },
            },
          },
        ],
      }),
    );
  }

  return server;
}

function corsHeaders(source?: Headers): Headers {
  const headers = new Headers(source ?? {});
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set(
    "Access-Control-Allow-Headers",
    "authorization, x-client-info, apikey, content-type, accept, mcp-session-id, mcp-protocol-version",
  );
  headers.set(
    "Access-Control-Expose-Headers",
    "mcp-session-id, mcp-protocol-version",
  );
  headers.set("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  return headers;
}

async function handleMcp(request: Request): Promise<Response> {
  // 每个请求创建新 server + stateless transport，避免复用 stateless transport 的兼容坑。
  const server = createServer();

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  transport.onerror = (error) => {
    console.error("[sticker-mcp transport error]", error);
  };

  await server.connect(transport);

  const response = await transport.handleRequest(request);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: corsHeaders(response.headers),
  });
}

async function handleWidgetData(url: URL): Promise<Response> {
  const stickerId = url.searchParams.get("sticker_id")?.trim() ?? "";

  if (!/^st_[a-z0-9_-]{1,80}$/.test(stickerId)) {
    return new Response(JSON.stringify({ error: "invalid sticker_id" }), {
      status: 400,
      headers: corsHeaders(
        new Headers({ "content-type": "application/json; charset=utf-8" }),
      ),
    });
  }

  const row = await fetchStickerById(stickerId);
  if (!row) {
    return new Response(JSON.stringify({ error: "sticker not found" }), {
      status: 404,
      headers: corsHeaders(
        new Headers({ "content-type": "application/json; charset=utf-8" }),
      ),
    });
  }

  return new Response(JSON.stringify(buildStickerPayload(stickerId, row)), {
    status: 200,
    headers: corsHeaders(
      new Headers({
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=300",
      }),
    ),
  });
}

Deno.serve(async (request: Request): Promise<Response> => {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  // Supabase 最终地址：
  // https://cqoevridrpdgqjyiksok.supabase.co/functions/v1/sticker-mcp/mcp
  if (url.pathname.endsWith("/mcp")) {
    try {
      return await handleMcp(request);
    } catch (error) {
      console.error("[sticker-mcp fatal]", error);

      return new Response(
        JSON.stringify({
          error: "sticker-mcp failed",
          detail: String(error),
        }),
        {
          status: 500,
          headers: corsHeaders(
            new Headers({ "content-type": "application/json; charset=utf-8" }),
          ),
        },
      );
    }
  }

  if (request.method === "GET" && url.pathname.endsWith("/widget-data")) {
    try {
      return await handleWidgetData(url);
    } catch (error) {
      console.error("[sticker widget-data error]", error);
      return new Response(JSON.stringify({ error: "widget data failed" }), {
        status: 500,
        headers: corsHeaders(
          new Headers({ "content-type": "application/json; charset=utf-8" }),
        ),
      });
    }
  }

  return new Response(
    "智能表情包 MCP is running. Use the /mcp endpoint.",
    {
      status: 200,
      headers: corsHeaders(
        new Headers({ "content-type": "text/plain; charset=utf-8" }),
      ),
    },
  );
});
