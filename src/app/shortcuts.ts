/**
 * The keyboard map.
 *
 * This list is what the help dialog shows, and a test asserts that every entry here
 * is actually handled by the key handler. Advertising a shortcut that does nothing is
 * worse than having no shortcut at all.
 */

export interface Shortcut {
  keys: string;
  description: string;
  group: string;
  /** Key name as it arrives in a KeyboardEvent, lower-cased. */
  token: string;
  ctrl?: boolean;
  shift?: boolean;
}

export const SHORTCUTS: Shortcut[] = [
  { keys: 'V', description: 'Select and drag tool', group: 'Editing', token: 'v' },
  { keys: 'M', description: 'Multi-select tool', group: 'Editing', token: 'm' },
  { keys: 'R', description: 'Rotate the selection (or the part being placed)', group: 'Editing', token: 'r' },
  { keys: 'Delete', description: 'Delete the selection', group: 'Editing', token: 'delete' },
  { keys: 'Esc', description: 'Cancel placement, wiring or a dialog', group: 'Editing', token: 'escape' },
  { keys: 'Ctrl + Z', description: 'Undo', group: 'Editing', token: 'z', ctrl: true },
  { keys: 'Ctrl + Shift + Z', description: 'Redo', group: 'Editing', token: 'z', ctrl: true, shift: true },
  { keys: 'Ctrl + C', description: 'Copy the selected parts', group: 'Editing', token: 'c', ctrl: true },
  { keys: 'Ctrl + V', description: 'Paste at the cursor', group: 'Editing', token: 'v', ctrl: true },
  { keys: 'Ctrl + X', description: 'Cut the selected parts', group: 'Editing', token: 'x', ctrl: true },
  { keys: 'Ctrl + A', description: 'Select every part', group: 'Editing', token: 'a', ctrl: true },

  { keys: 'D', description: 'Design mode', group: 'Modes', token: 'd' },
  { keys: 'S', description: 'Simulate mode', group: 'Modes', token: 's' },
  { keys: 'P', description: 'Run or pause the simulation', group: 'Modes', token: 'p' },
  { keys: 'N', description: 'Step the simulation forward 1 ms', group: 'Modes', token: 'n' },

  { keys: 'A', description: 'Show or hide the logic analyzer', group: 'Instruments', token: 'a' },
  { keys: 'T', description: 'Show or hide the truth table', group: 'Instruments', token: 't' },

  { keys: '1 - 9', description: 'Pick a wire colour', group: 'Wiring', token: '1' },
  { keys: 'Click a pin or hole', description: 'Start a wire; click again to place a corner', group: 'Wiring', token: '' },
  { keys: 'Right click', description: 'Remove the last corner, or cancel the wire', group: 'Wiring', token: '' },

  { keys: 'F', description: 'Fit the circuit to the window', group: 'View', token: 'f' },
  { keys: '+ / -', description: 'Zoom in and out', group: 'View', token: '+' },
  { keys: '0', description: 'Reset zoom to 100%', group: 'View', token: '0' },
  { keys: 'L', description: 'Show or hide labels', group: 'View', token: 'l' },
  { keys: 'K', description: 'Switch between the light and dark theme', group: 'View', token: 'k' },
  { keys: 'Space + drag', description: 'Pan the workspace', group: 'View', token: ' ' },
  { keys: 'Scroll', description: 'Zoom about the cursor', group: 'View', token: '' },

  { keys: 'Ctrl + N', description: 'New project', group: 'Project', token: 'n', ctrl: true },
  { keys: 'Ctrl + O', description: 'Open a project file', group: 'Project', token: 'o', ctrl: true },
  { keys: 'Ctrl + S', description: 'Save the project as JSON', group: 'Project', token: 's', ctrl: true },
  { keys: 'Ctrl + E', description: 'Export the project as JSON', group: 'Project', token: 'e', ctrl: true },
  { keys: 'Ctrl + F', description: 'Jump to the library search box', group: 'Project', token: 'f', ctrl: true },
  { keys: '?', description: 'Show this list', group: 'Project', token: '?' },
];
