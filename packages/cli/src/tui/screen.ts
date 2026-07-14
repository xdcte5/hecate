export type ScreenSize = {
  cols: number;
  rows: number;
};

export type ScreenOptions = {
  onResize?: (size: ScreenSize) => void;
};

const ALT_ENTER = "\x1b[?1049h";
const ALT_EXIT = "\x1b[?1049l";
const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";
const CLEAR_HOME = "\x1b[H\x1b[J";

/** ANSI alternate-screen manager (pi-tui skipped — requires Node >=22.19). */
export class AltScreen {
  private active = false;
  private resizeListener: (() => void) | null = null;
  private readonly onResize?: (size: ScreenSize) => void;

  constructor(options: ScreenOptions = {}) {
    this.onResize = options.onResize;
  }

  get size(): ScreenSize {
    return {
      cols: Math.max(40, process.stdout.columns || 80),
      rows: Math.max(12, process.stdout.rows || 24),
    };
  }

  enter(): void {
    if (this.active) return;
    process.stdout.write(ALT_ENTER);
    process.stdout.write(CURSOR_HIDE);
    process.stdout.write("\x1b[2J\x1b[H");
    this.active = true;
    this.resizeListener = () => {
      this.onResize?.(this.size);
    };
    process.stdout.on("resize", this.resizeListener);
  }

  exit(): void {
    if (!this.active) return;
    if (this.resizeListener) {
      process.stdout.off("resize", this.resizeListener);
      this.resizeListener = null;
    }
    process.stdout.write(CURSOR_SHOW);
    process.stdout.write(ALT_EXIT);
    this.active = false;
  }

  /** Full repaint at home position (caller supplies complete frame). */
  paint(frame: string): void {
    process.stdout.write(CLEAR_HOME);
    process.stdout.write(frame);
    if (!frame.endsWith("\n")) process.stdout.write("\n");
  }

  setCursorVisible(visible: boolean): void {
    process.stdout.write(visible ? CURSOR_SHOW : CURSOR_HIDE);
  }

  isActive(): boolean {
    return this.active;
  }
}

export function defaultScreenSize(): ScreenSize {
  return {
    cols: Math.max(40, process.stdout.columns || 80),
    rows: Math.max(12, process.stdout.rows || 24),
  };
}
