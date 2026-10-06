# ProtoLab

**A virtual digital electronics laboratory.**

ProtoLab is a browser application for building and running digital logic experiments
on a solderless breadboard. It is not a gate-drawing tool with a breadboard picture
behind it: the board, the holes, the clips, the chips, the pins, the wires and the
power supply are all modelled objects, and the simulation is computed from that model.

Place a 7400 so it straddles the centre trench. Wire pin 14 to the positive rail and
pin 7 to ground. Wire two switches into pins 1 and 2 and an LED with a series resistor
onto pin 3. Run it. Pull the VCC jumper out and watch the chip report itself as
unpowered, because in ProtoLab it genuinely is.

## Handoff

This repository is self-contained. It does not require a personal machine path,
environment variable, backend service, or network connection at runtime. A new
contributor can continue from a clean checkout with:

```bash
npm install
npm test
npm run build
npm run dev
```

Use Node.js 20 or newer. `npm run dev` prints the local development URL. The
production build is written to `dist/`; that directory is generated and ignored by
Git. Editor workspace files, dependency folders, coverage output, and local
environment files are also ignored.

Before handing off a change, run `npm test` and `npm run build`. The test suite is
model-level and currently contains 134 tests covering topology, placement, wiring,
simulation, faults, persistence, examples, and the 74xx library.

---

## Why it exists

A first-year Digital Logic Design lab is mostly about the things a schematic hides:
which pin is VCC, why the chip has to sit across the trench, why the far half of the
rail is dead, why the LED needs a resistor, and why an input left floating appears to
work right up until it doesn't.

Tools that abstract those away are fine for design work and useless for the lab.
ProtoLab keeps them, deliberately, and explains them when the student gets them wrong:

> `7400 must straddle the centre trench, with one row of pins on each side. Both rows
> are currently on the same side, which would short every pin pair together.`

> `U1 (7400) is unpowered. Connect pin 14 to +5 V and pin 7 to ground.`

> `LED1 is connected across 5.0 V with no series resistor. A real LED would draw far
> too much current. Add a resistor of a few hundred ohms.`

---

## The one rule

> **The renderer draws the electrical model. The electrical model is never derived
> from what is drawn.**

Two holes are connected because the board definition puts them in the same clip, not
because the dots are near each other. A wire is attached to a pin because its endpoint
*is* a reference to that pin, not because the line ends nearby. Wire colour is
metadata and has no electrical meaning whatsoever.

`docs/BREADBOARD_BEHAVIOR.md` is the design note this was built from. It records the
physical rules, what we reproduce, and what we deliberately do not copy from
professional EDA tools because it would hide the lesson.

---

## What works today

Everything in this list is implemented and covered by tests. Nothing in this README
describes a button that does not do what it says.

### The breadboard

* Four board models - mini (170 tie points), half (400), full (830) and double
  (1660) - each a **data definition**, not an image.
* Real connectivity: the five holes of one column in one bank share a clip; the two
  banks are separated by a 0.3 in trench and are never connected.
* Power rails as separate clips, with **split rails** on the full and double boards.
  The far half is dead until you bridge it with a jumper, exactly like the real thing.
* A rail carries 5 V only when a supply has been wired to it.

### Physical placement

One validator answers "can this part go here?" for every part in the library:

| Rule | Example message |
|---|---|
| Every lead must be in a hole | `Pin 7 of 7400 is not over a breadboard hole.` |
| The part must fit on one board | `7400 extends past the edge of the board.` |
| Two-row packages must straddle a trench | `7400 must straddle the centre trench...` |
| No two pins of a part may share a clip | `Pins 1 and 14 would be shorted together in group a10-e10.` |
| One lead per hole | `Hole f12 is already taken by R1 pin 2.` |
| Rigid packages do not overlap | `7402 overlaps U1.` |

The fourth rule is the general form of "you cannot rotate a DIP by 90 degrees", so
every future package gets that check for free. Dragging is *sticky*: a part only moves
to positions the validator accepts, and the status bar says why one was refused.

### Components

**74-series (19 parts, datasheet pin tables):** 7400, 7402, 7404, 7408, 7410, 7420,
7427, 7430, 7432, 7447, 7474, 7476, 7483, 7486, 7490, 74138, 74151, 74163, 74195.

Gate packages are pure data - a gate list against pin numbers - so adding another gate
IC is adding a table. Sequential and decoding parts have device models with real
state, edge detection and asynchronous preset/clear. Parts with unusual power pins
(the 7483 on 5 and 12, the 7476 on 5 and 13, the 7490 on 5 and 10) are modelled that
way and say so in the inspector.

**Everything else on the bench:** adjustable DC supply, battery, +5 V and ground
terminals, SPDT toggle switch, four-pin tactile push button, logic level source, clock
generator (which has to be powered itself), LED, indicator lamp, resistor with
datasheet colour bands, logic probe, and a seven-segment display in a wide 0.6 in
package.

### Simulation

* Union-find net resolution over clips, pins, wires, junctions, bonded package pins
  and closed switch contacts.
* Event-driven solving in nanoseconds with per-part propagation delay, running in real
  time so a 1 Hz clock ticks once a second.
* Drive strengths: a supply beats a push-pull output beats a pull resistor. Two
  outputs fighting produce a reported conflict, not a silent winner.
* Resistors are modelled as **weak links**, so pull-ups and pull-downs behave
  correctly rather than acting like wire.
* Power resolved from the nets: `POWERED`, `UNPOWERED`, `NO_GROUND`, `UNDERVOLTAGE`,
  `OVERVOLTAGE`, `REVERSE_POLARITY`, `OVERHEATING`, `DAMAGED`.
* A damage model with a timer: abuse a chip and it warns first, then dies, then stays
  dead until you replace it.
* Oscillation detection, so a ring oscillator is reported instead of hanging the tab.

### The workspace

* Modeless wiring: press any pin or hole to start a wire, click to drop corners,
  click a target to finish. Right click removes the last corner.
* Orthogonal routing, junctions, wire colours, segment dragging, endpoint snapping.
* Wire geometry and electrical topology are separate, so moving a part re-routes its
  wires without the net list noticing.
* Undo and redo over model operations, copy and paste, marquee select, rotation.
* An inspector that follows the chain: pin → hole → clip → net → voltage. Select a
  hole and it lists everything in that clip.
* A status bar that names what is under the cursor and collects every problem the
  circuit has.
* Light and dark themes, both designed rather than inverted.

### Instruments

* **Logic analyzer** - up to twelve channels, sampled from the solver itself, storing
  transitions with a scrollable time window.
* **Truth table** - sweeps every combination of the switches in the circuit *by
  actually running it*, records what the LEDs and probes did, and restores the circuit
  exactly as it was. It is a record of the bench, not a symbolic analysis.

### Project files

JSON is the project. It is versioned, validated field by field on load, and never
executed. A file that refers to a part this build does not have is reported by name;
a wire that lost an endpoint is dropped with an explanation rather than silently.
A workspace PNG can be exported too, and is clearly labelled as a picture rather than
a project.

```json
{
  "format": "protolab-project",
  "version": 1,
  "project": { "name": "7400 NAND Experiment" },
  "boards": [{ "id": "BB1", "definition": "bb-half", "position": { "x": 0, "y": 0 } }],
  "components": [
    {
      "id": "U1",
      "reference": "U1",
      "definition": "ic-7400",
      "position": { "x": 9, "y": 10 },
      "rotation": 0,
      "properties": {}
    }
  ],
  "wires": [
    {
      "id": "W3",
      "from": { "type": "hole", "board": "BB1", "hole": "TP10" },
      "to": { "type": "hole", "board": "BB1", "hole": "a10" },
      "corners": [],
      "color": "red"
    }
  ],
  "junctions": [],
  "settings": {}
}
```

---

## What is *not* built yet

Stated plainly, because a tool that overstates itself is worse than a small one:

* **Schematic view.** The model is view-independent and a schematic mode can read the
  same circuit, but it has not been written.
* **Subcircuits.** Not implemented.
* **The wider DLD suite.** The truth table generator is real. The K-map solver,
  boolean simplifier, FSM designer and counter designer are not written.
* **Analogue simulation.** There is no SPICE engine and no pretence of one. The
  analogue behaviour that exists (supply voltage, LED forward drop, resistor coupling)
  is deliberately coarse and documented as such.
* **Arduino, sensors, timers, I2C/SPI.** Not implemented.
* **Desktop packaging.** The build is already offline-capable and framework-free; the
  Tauri or Electron shell is a later decision.

---

## Architecture

```
src/
  core/         circuit model: boards, parts, wires, junctions, connection refs
  breadboard/   board definitions, hole/clip topology, placement validator
  components/   definitions, footprints, pin tables, 74xx library, registry
  simulation/   net resolver, device models, event-driven engine, power and faults
  wiring/       orthogonal router, geometry, snapping, connection finder
  editor/       editor state, commands, undo manager
  rendering/    canvas renderer: breadboard, components, wires, overlays, themes
  ui/           toolbar, library, inspector, status bar, dialogs, instrument panels
  instruments/  logic analyzer
  suite/        truth table generator
  persistence/  JSON schema, validation, migration, serializer
  app/          workbench controller, worked examples, keyboard map
```

The layers only depend downwards. `core` knows nothing about pixels; `rendering`
writes nothing to the model; `simulation` reads the circuit and never edits it.

**Stack:** TypeScript, Vite, ES modules, Canvas 2D. No UI framework and no runtime
dependencies - the production bundle is the application. The core simulator has no
notion of a network, which is what makes a desktop shell a packaging job rather than a
rewrite.

---

## Running it

```bash
npm install
npm run dev        # development server
npm run build      # type-check and produce a static, offline-capable bundle
npm run preview    # serve the built bundle
npm test           # run the test suite
npm run typecheck  # type-check only
```

Requires Node 20 or newer. The built output in `dist/` is static files: open it from a
web server, a file:// URL, or inside a desktop shell.

---

## Tests

134 tests, all model-level - no screenshot comparisons anywhere.

```
tests/breadboard.test.ts    clip topology, trench isolation, split rails, tie counts
tests/placement.test.ts     every placement rule, including the refusals
tests/ttl74xx.test.ts       pin tables and exhaustive truth tables for the library
tests/nand7400.test.ts      the reference experiment end to end, including power loss
tests/faults.test.ts        overvoltage, reverse polarity, shorts, damage, oscillation
tests/wiring.test.ts        routing, snapping, segment dragging, junctions
tests/editor.test.ts        undo and redo, restoring electrical behaviour exactly
tests/persistence.test.ts   round trips, validation, rejection of malformed files
tests/examples.test.ts      both worked examples build, power up and behave
```

The IC tests drive real chips placed on a real board through a real supply, so a pin
table error fails a test rather than producing a plausible-looking wrong answer.

---

## Keyboard

Every shortcut in the help dialog (`?`) is bound, and a test keeps the advertised list
and the key handler in step.

| | |
|---|---|
| `V` / `M` | select tool / multi-select |
| `R` | rotate the selection or the part being placed |
| `D` / `S` | design mode / simulate mode |
| `P` / `N` | run or pause / step 1 ms |
| `A` / `T` | logic analyzer / truth table |
| `1`-`9` | wire colour |
| `F` / `+` `-` / `0` | fit / zoom / reset zoom |
| `L` / `K` | labels / theme |
| `Ctrl+Z`, `Ctrl+Shift+Z` | undo, redo |
| `Ctrl+C` `V` `X` `A` | copy, paste, cut, select all |
| `Ctrl+N` `O` `S` `E` `F` | new, open, save, export, search |

---

## Independence and attribution

ProtoLab was written from scratch. LogicBench and Proteus were consulted as *public
product references* for workflow and feature expectations - what a breadboard
simulator is expected to do, how modeless wiring feels, what belongs in a component
library. No source code, asset, symbol artwork, branding or private data from either
product was inspected, copied or adapted, and ProtoLab shares no code with them.

The electrical behaviour comes from the physics of a solderless breadboard and from
published 74-series datasheet pinouts, which are factual information about real parts.

---

## Licence

MIT. See `LICENSE`.
