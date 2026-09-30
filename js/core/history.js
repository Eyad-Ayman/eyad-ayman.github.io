// EYAD STUDIO — generic undo/redo stack of reversible commands.
// Commands: { label, undo(), redo(), bytes?, coalesce?, merge?(next) }

let SEQ = 0;

export class History {
  constructor({ limit = 60, maxBytes = 512 * 1024 * 1024, onChange } = {}) {
    this.stack = [];
    this.index = -1;
    this.limit = limit;
    this.maxBytes = maxBytes;
    this.onChange = onChange || (() => {});
    this.savedSeq = 0;
    this.lastCoalesce = null;
  }

  get canUndo() { return this.index >= 0; }
  get canRedo() { return this.index < this.stack.length - 1; }
  get currentSeq() { return this.index >= 0 ? this.stack[this.index].seq : 0; }
  get dirty() { return this.currentSeq !== this.savedSeq; }
  markSaved() { this.savedSeq = this.currentSeq; this.onChange('saved'); }

  /** Push an already-applied command. */
  push(cmd) {
    if (!cmd) return;
    // Coalesce rapid edits of the same property (slider drags, nudges).
    if (cmd.coalesce && this.lastCoalesce && this.lastCoalesce.key === cmd.coalesce && Date.now() - this.lastCoalesce.time < 900 && this.index === this.stack.length - 1 && this.stack[this.index] === this.lastCoalesce.cmd) {
      const prev = this.lastCoalesce.cmd;
      if (prev.merge && prev.merge(cmd)) { this.lastCoalesce.time = Date.now(); this.onChange('push'); return; }
    }
    this.stack.length = this.index + 1;
    cmd.seq = ++SEQ;
    cmd.time = Date.now();
    this.stack.push(cmd);
    this.index = this.stack.length - 1;
    this.lastCoalesce = cmd.coalesce ? { key: cmd.coalesce, time: Date.now(), cmd } : null;
    this.trim();
    this.onChange('push');
  }

  trim() {
    let bytes = 0;
    for (const c of this.stack) bytes += c.bytes || 0;
    while (this.stack.length > 1 && (this.stack.length > this.limit || bytes > this.maxBytes) && this.index > 0) {
      const dropped = this.stack.shift();
      bytes -= dropped.bytes || 0;
      this.index--;
    }
  }

  undo() {
    if (!this.canUndo) return null;
    const c = this.stack[this.index];
    c.undo();
    this.index--;
    this.lastCoalesce = null;
    this.onChange('undo', c);
    return c;
  }
  redo() {
    if (!this.canRedo) return null;
    this.index++;
    const c = this.stack[this.index];
    c.redo();
    this.lastCoalesce = null;
    this.onChange('redo', c);
    return c;
  }
  jumpTo(i) {
    while (this.index > i && this.canUndo) this.undo();
    while (this.index < i && this.canRedo) this.redo();
  }
  clear() { this.stack = []; this.index = -1; this.savedSeq = 0; this.onChange('clear'); }
  get bytes() { return this.stack.reduce((a, c) => a + (c.bytes || 0), 0); }
}

