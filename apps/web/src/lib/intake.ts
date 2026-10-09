import type { IntakeStreamEvent, SubmitReportResponse } from "@whistle/shared";

export interface IntakeHandle {
  id: string;
  token: string;
}

const INTAKE_KEY = "wb.intake";
const RESULT_KEY = "wb.result";

/**
 * Per-tab storage only (sessionStorage), so nothing survives closing the tab on a shared device.
 * Every access is guarded: storage can be unavailable in private modes.
 */
function read<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the flow still works within this page */
  }
}

export const savedIntake = () => read<IntakeHandle>(INTAKE_KEY);
export const saveIntake = (h: IntakeHandle | null) => write(INTAKE_KEY, h);
export const savedResult = () => read<SubmitReportResponse>(RESULT_KEY);
export const saveResult = (r: SubmitReportResponse | null) => write(RESULT_KEY, r);

export const intakeHeaders = (h: IntakeHandle) => ({ "x-intake-token": h.token });

/** Sends a chat message and invokes `onEvent` for each server-sent event. */
export async function streamChat(
  handle: IntakeHandle,
  content: string,
  onEvent: (event: IntakeStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/intake/sessions/${handle.id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...intakeHeaders(handle) },
    body: JSON.stringify({ content }),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    onEvent({ type: "error", message: data.message ?? "The assistant is unavailable right now." });
    return;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (chunk.startsWith("data: ")) onEvent(JSON.parse(chunk.slice(6)) as IntakeStreamEvent);
    }
  }
}
