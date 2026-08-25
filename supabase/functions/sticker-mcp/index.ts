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

const SERVER_VERSION = "1.3.0";
// UI resource URIs are cache keys. Increment this whenever the component
// contract or embedded HTML changes so mobile clients cannot reuse stale UI.
const TEMPLATE_URI = "ui://sticker-mcp/sticker-v2.html";
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

async function fetchEnabledStickers(limit = 500): Promise<StickerRow[]> {
  const columns = [
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
  ].join(",");

  const url =
    `${normalizedOrigin()}/rest/v1/sticker_catalog` +
    `?assistant_enabled=eq.true&select=${encodeURIComponent(columns)}` +
    `&limit=${Math.max(1, Math.min(limit, 1000))}`;

  const response = await fetch(url, {
    headers: authHeaders(),
  });

  if (!response.ok) {
    throw new Error(
      `Supabase sticker_catalog query failed: ${response.status} ${await response.text()}`,
    );
  }

  return await response.json();
}

async function fetchStickerById(id: string): Promise<StickerRow | null> {
  const columns = [
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
  ].join(",");

  const url =
    `${normalizedOrigin()}/rest/v1/sticker_catalog` +
    `?id=eq.${encodeURIComponent(id)}` +
    `&assistant_enabled=eq.true` +
    `&select=${encodeURIComponent(columns)}` +
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
      text: alt,
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
      background: transparent;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .wrap {
      width: 100%;
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

      function extractPayload(value, depth) {
        if (!value || typeof value !== "object" || depth > 5) return null;
        if (typeof value.url === "string" && value.url) return value;

        const candidates = [
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

      function render(value) {
        const data = extractPayload(value, 0);
        if (!data) return false;

        const url = typeof data.url === "string" ? data.url : "";
        const alt = typeof data.alt === "string" ? data.alt : "表情包";
        const cap = typeof data.caption === "string" ? data.caption : "";

        if (!url) return false;

        rendered = true;
        img.alt = alt;
        img.src = url;

        if (cap) {
          caption.textContent = cap;
          // 默认不占空间；如果你以后想显示说明，把下一行改成 "block"。
          caption.style.display = "none";
        }

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
      });

      img.addEventListener("error", () => {
        loading.style.display = "none";
        img.style.display = "none";
        error.style.display = "block";
      });

      // ChatGPT Apps SDK 兼容层：先读当前 toolOutput。
      try {
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

      // Some mobile clients attach the bridge after the document has loaded.
      // Brief polling avoids a permanent blank card without making requests.
      let attempts = 0;
      const timer = window.setInterval(() => {
        attempts += 1;
        try {
          render(window.openai);
          renderFromToolInput(window.openai);
        } catch (_) {}
        if (rendered || attempts >= 150) window.clearInterval(timer);
      }, 100);
    })();
  </script>
</body>
</html>`;

function createServer(): McpServer {
  const server = new McpServer({
    name: "智能表情包 MCP",
    version: SERVER_VERSION,
  });

  // 重要：search_stickers 只是普通 MCP Tool。
  // 不绑定 UI，不返回 structuredContent。
  server.registerTool(
    "search_stickers",
    {
      title: "搜索表情包",
      description:
        "根据当前完整聊天语境搜索表情包候选。只负责返回候选文本，不会发送图片。选中真实候选 id 后，再调用 send_sticker。",
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

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  );

  // 重要：只有 send_sticker 是 App Tool，并绑定图片 UI。
  registerAppTool(
    server,
    "send_sticker",
    {
      title: "发送表情包",
      description:
        "把 search_stickers 返回的真实 sticker_id 原样传入；按 ID 查询 sticker_catalog 并显示对应图片。不要编造 ID。",
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
        // Compatibility alias used by older ChatGPT mobile clients.
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
        content: await createStickerContent(payload.url, payload.alt),
      };
    },
  );

  registerAppResource(
    server,
    "表情包图片组件",
    TEMPLATE_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
    },
    async () => ({
      contents: [
        {
          uri: TEMPLATE_URI,
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
