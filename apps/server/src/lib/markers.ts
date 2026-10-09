import { partialSuffix } from "../ai/minimax.js";

/** Removes a literal marker from a token stream, remembering whether it was seen. */
export class MarkerStripper {
  found = false;
  private buffer = "";

  constructor(private readonly marker: string) {}

  push(text: string): string {
    this.buffer += text;
    const idx = this.buffer.indexOf(this.marker);
    if (idx !== -1) {
      this.found = true;
      this.buffer = this.buffer.slice(0, idx) + this.buffer.slice(idx + this.marker.length);
    }
    const keep = partialSuffix(this.buffer, this.marker);
    const out = this.buffer.slice(0, this.buffer.length - keep);
    this.buffer = this.buffer.slice(this.buffer.length - keep);
    return out;
  }

  flush(): string {
    const rest = this.buffer;
    this.buffer = "";
    return rest;
  }
}
