/**
 * Minimal client for MiniMax's OpenAI-compatible Chat Completions API
 * (https://platform.minimax.io/docs/api-reference/text-openai-api).
 *
 * Plain fetch is used instead of the OpenAI SDK because MiniMax takes extra
 * body params (`thinking`, `reasoning_split`) and can report errors in a
 * `base_resp` envelope with HTTP 200.
 */

export type LlmMessage = { role: "system" | "user" | "assistant"; content: string };

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface AiClient {
  readonly enabled: boolean;
  stream(messages: LlmMessage[], opts?: CompletionOptions): AsyncGenerator<string>;
  complete(messages: LlmMessage[], opts?: CompletionOptions): Promise<string>;
}

export class AiError extends Error {
  constructor(message: string, readonly retriable = false) {
    super(message);
    this.name = "AiError";
  }
}

export interface MinimaxConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  thinking: "disabled" | "adaptive";
  timeoutMs?: number;
}

interface ChatChunk {
  choices?: { delta?: { content?: string | null }; message?: { content?: string | null } }[];
  base_resp?: { status_code?: number; status_msg?: string };
}

export function createMinimaxClient(cfg: MinimaxConfig): AiClient {
  const enabled = cfg.apiKey.trim() !== "";
  const timeoutMs = cfg.timeoutMs ?? 90_000;

  async function post(messages: LlmMessage[], stream: boolean, opts: CompletionOptions): Promise<Response> {
    if (!enabled) throw new AiError("AI assistant is not configured");
    const signal = opts.signal
      ? AbortSignal.any([opts.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
          messages,
          stream,
          temperature: opts.temperature ?? 1.0,
          max_tokens: opts.maxTokens ?? 1024,
          thinking: { type: cfg.thinking },
          // Keep any reasoning out of `content`; stripThink() is a second line of defence.
          reasoning_split: true,
        }),
        signal,
      });
    } catch (err) {
      throw new AiError(`MiniMax request failed: ${(err as Error).message}`, true);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new AiError(`MiniMax returned HTTP ${res.status}: ${body.slice(0, 300)}`, res.status >= 500 || res.status === 429);
    }
    return res;
  }

  function checkEnvelope(chunk: ChatChunk): void {
    const code = chunk.base_resp?.status_code;
    if (code !== undefined && code !== 0) {
      throw new AiError(`MiniMax error ${code}: ${chunk.base_resp?.status_msg ?? "unknown"}`, code === 1002);
    }
  }

  return {
    enabled,

    async *stream(messages, opts = {}) {
      const res = await post(messages, true, opts);
      if (!res.body) throw new AiError("MiniMax returned an empty stream");
      const filter = new ThinkFilter();
      let buffer = "";
      for await (const piece of res.body.pipeThrough(new TextDecoderStream())) {
        buffer += piece;
        let boundary: number;
        while ((boundary = buffer.search(/\r?\n\r?\n/)) !== -1) {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, "");
          for (const line of event.split(/\r?\n/)) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "" || data === "[DONE]") continue;
            let chunk: ChatChunk;
            try {
              chunk = JSON.parse(data) as ChatChunk;
            } catch {
              continue;
            }
            checkEnvelope(chunk);
            const text = chunk.choices?.[0]?.delta?.content;
            if (text) {
              const visible = filter.push(text);
              if (visible) yield visible;
            }
          }
        }
      }
      const rest = filter.flush();
      if (rest) yield rest;
    },

    async complete(messages, opts = {}) {
      const res = await post(messages, false, opts);
      const json = (await res.json()) as ChatChunk;
      checkEnvelope(json);
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new AiError("MiniMax returned no content");
      return stripThink(content);
    },
  };
}

export function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trim();
}

/**
 * Removes literal markers (e.g. `<think>…</think>` blocks) from a token stream
 * whose tags may be split across chunks.
 */
export class ThinkFilter {
  private buffer = "";
  private inThink = false;

  push(text: string): string {
    this.buffer += text;
    let out = "";
    for (;;) {
      if (this.inThink) {
        const end = this.buffer.indexOf("</think>");
        if (end === -1) {
          this.buffer = this.buffer.slice(-("</think>".length - 1));
          return out;
        }
        this.buffer = this.buffer.slice(end + "</think>".length);
        this.inThink = false;
      } else {
        const start = this.buffer.indexOf("<think>");
        if (start === -1) {
          const keep = partialSuffix(this.buffer, "<think>");
          out += this.buffer.slice(0, this.buffer.length - keep);
          this.buffer = this.buffer.slice(this.buffer.length - keep);
          return out;
        }
        out += this.buffer.slice(0, start);
        this.buffer = this.buffer.slice(start + "<think>".length);
        this.inThink = true;
      }
    }
  }

  flush(): string {
    const rest = this.inThink ? "" : this.buffer;
    this.buffer = "";
    return rest;
  }
}

/** Length of the longest suffix of `text` that is a proper prefix of `marker`. */
export function partialSuffix(text: string, marker: string): number {
  for (let n = Math.min(marker.length - 1, text.length); n > 0; n--) {
    if (text.endsWith(marker.slice(0, n))) return n;
  }
  return 0;
}
