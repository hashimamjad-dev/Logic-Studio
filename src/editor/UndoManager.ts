/**
 * Undo and redo.
 *
 * A plain command stack. Executing a new command clears the redo stack, which is what
 * every editor does and what people expect.
 */

import type { Circuit } from '../core/Circuit';
import type { Command } from './commands';

export class UndoManager {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private listeners = new Set<() => void>();

  constructor(
    private circuit: Circuit,
    private limit = 200,
  ) {}

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  execute(command: Command): void {
    command.apply(this.circuit);
    this.undoStack.push(command);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.notify();
  }

  /** Record a command that has already been applied (e.g. by a live drag). */
  push(command: Command): void {
    this.undoStack.push(command);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.notify();
  }

  undo(): Command | undefined {
    const command = this.undoStack.pop();
    if (!command) return undefined;
    command.revert(this.circuit);
    this.redoStack.push(command);
    this.notify();
    return command;
  }

  redo(): Command | undefined {
    const command = this.redoStack.pop();
    if (!command) return undefined;
    command.apply(this.circuit);
    this.undoStack.push(command);
    this.notify();
    return command;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get nextUndoLabel(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.label;
  }

  get nextRedoLabel(): string | undefined {
    return this.redoStack[this.redoStack.length - 1]?.label;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }
}
