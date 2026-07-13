/**
 * A modal input controller driven by the single TUI readline. The TUI feeds it
 * one line at a time; the controller renders its own prompts via `write` and
 * signals completion by returning `{ done: true, result }`. This keeps every
 * picker on the one shared stdin reader instead of spawning nested readline
 * interfaces (which corrupt the raw TTY and can crash the session).
 */
export type ModalStep<T> = { done: false } | { done: true; result: T };

export interface ModalController<T> {
  /** Draw the modal's current state and trailing prompt. */
  render(): void;
  /** Handle one line of user input. */
  handleLine(line: string): ModalStep<T>;
}
