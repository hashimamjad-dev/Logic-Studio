# Breadboard Behaviour — Design Note

> Internal design note written **before** the breadboard, placement, wiring and power
> engines were implemented. It records the physical rules we are reproducing, the
> interaction behaviour we borrow from professional EDA tools, and the behaviour we
> deliberately do **not** copy.
>
> Sources of truth: the physical behaviour of a standard solderless breadboard and
> DIP packages (0.1 in pitch, 0.3 in / 0.6 in body widths), manufacturer datasheets
> for the 74-series parts, and the *publicly observable* interaction model of
> LogicBench and Proteus. No source code, asset, or proprietary data from any other
> product was inspected, copied or adapted. Everything below is our own model.

---

## 0. The one rule everything else follows

> **The renderer draws the electrical model. The electrical model is never derived
> from what is drawn.**

A hole is not connected to another hole because the two dots are near each other on
screen. They are connected because the *board definition* places them in the same
**connectivity group**. A wire is not connected to a pin because its polyline visually
ends near it; it is connected because its endpoint resolves to a **connection point
identifier** that is stored in the model. Geometry is presentation. Topology is truth.

---

## 1. Breadboard hole topology

A solderless breadboard is a plastic body holding rows of spring clips. Each clip
bridges a fixed set of holes and nothing else.

**Terminal strips.** The main body is divided into two banks by the centre trench.
Within one bank, the five holes of a single numbered column share one clip:

```
a10 - b10 - c10 - d10 - e10      one clip -> one connectivity group
f10 - g10 - h10 - i10 - j10      a different clip -> a different group
```

Column 10 in the upper bank and column 10 in the lower bank are **two independent
electrical groups**. They are adjacent on screen and unrelated electrically.

Consequences we enforce in code:

* every hole belongs to exactly one connectivity group;
* the group is decided by the **board definition**, never by pixel proximity;
* connecting a wire to `c10` connects it to whatever is in `a10`, `b10`, `d10`, `e10`
  and to nothing in `f10..j10`.

**Pitch.** Holes are on a 0.1 in grid in both axes. We use one *grid unit* = 0.1 in
throughout the model and only multiply by a pixel scale at render time, so the model
is resolution independent and zoom cannot change electrical meaning.

**Row-to-row spacing across the trench.** On a real board the gap between row `e` and
row `f` is 0.3 in, which is exactly the body width of a narrow DIP. That is not
decoration; it is the reason a DIP straddles the trench. Our board definitions
therefore place rows `a..e` at grid offsets 0..4 and rows `f..j` at 7..11, giving a
true 3-unit gap.

## 2. Power rail topology

Rails are long clips running the length of the board, marked `+` (red) and `-` (blue).
Each rail is its own connectivity group, completely separate from the terminal strips.

Three properties matter and are all modelled:

1. **A rail is not a power source.** A red stripe carries 5 V only when the student
   has wired a supply to it. An unwired `+` rail is a floating conductor and the
   inspector says so.
2. **Rails may be split.** Many full-size boards break each rail near the middle into
   two isolated segments, sometimes with a printed gap in the stripe. Segments are
   separate connectivity groups and need a jumper to bridge them. Our
   `BreadboardDefinition` expresses a rail as a list of *segments*, each covering a
   column range, so a board can declare continuous or split rails. We ship the Full
   and Double boards with split rails **on purpose**: discovering that the far half of
   the rail is dead, and fixing it with a jumper, is a real lab lesson.
3. **The two rails of a pair are independent.** `+` and `-` are never connected by
   the board. If the model ever finds them in one net, that is a short across the
   supply and is reported as an error, not silently resolved.

## 3. Centre trench behaviour

The trench is a *modelled void*, not a drawn line:

* it carries no holes and no connectivity group;
* it separates banks, so no group spans it;
* a package whose footprint declares `requiresTrenchStraddle` is only placeable when
  its two pin rows land in **different banks** on opposite sides of the same trench.

A board may have more than one trench (the Double board has two bank pairs), so the
rule is expressed per-trench rather than as "the middle of the board".

## 4. DIP placement rules

A DIP-14 is 7 pins x 2 rows, 0.1 in pin pitch along a row, 0.3 in between rows
(DIP-16/20 narrow bodies are identical apart from pin count; 0.6 in wide bodies such
as DIP-24 span a wider trench and are declared as such in the footprint).

Placement is legal only when **all** of the following hold:

| # | Rule | Message shown to the student |
|---|------|------------------------------|
| 1 | Every pin lands exactly on an existing hole | "Pin 7 is not over a breadboard hole." |
| 2 | The component is fully inside a board | "7400 extends past the edge of the board." |
| 3 | The two pin rows sit in different banks across one trench | "7400 must straddle the centre trench." |
| 4 | No two pins of the same part share a connectivity group | "Pins 1 and 14 would be shorted together in group a10-e10." |
| 5 | No pin lands in a hole already occupied by another part's pin | "Hole f12 is already used by R1 pin 2." |
| 6 | Bodies do not overlap | "7400 overlaps U2." |

Rule 4 is the general form of rule 3 and of "no rotated DIP": rotating a DIP by 90
degrees puts both of its pin rows inside the *same* column group, which on a real
board is a dead short across the package. The validator derives that from the
topology rather than from a special case, so every future package gets the check for
free.

Placement is evaluated on the **pins**, not on the body. The body is snapped because
the pins are snapped, never the other way round.

## 5. IC pin to hole to group to net mapping

The pin is the electrical entity. The plastic body conducts nothing. The chain is:

```
7400 pin 1  ->  hole a10  ->  group (a10 b10 c10 d10 e10)  ->  net N7
```

A wire landing on `c10` joins net `N7` and is therefore connected to pin 1. A wire
landing on `f10` is **not** connected to pin 1 and never becomes connected to it by
being drawn close to it. The inspector shows this whole chain for any selected hole,
pin or wire, because being able to see *why* two things are connected is the point of
the tool.

## 6. Wire endpoint rules

A wire endpoint is stored as a **connection reference**, never as a coordinate:

* a breadboard hole (`board / row / column`, or `board / rail / column`);
* a component pin (`component id / pin number`);
* a junction on another wire.

While routing, the cursor snaps to the nearest valid connection point inside a
tolerance of roughly half the hole pitch; outside that tolerance nothing is
highlighted and the click does not commit a connection. An endpoint "5 px from a
hole" is not connected, because coordinates are not what is stored. When a wire is
committed its geometry is recomputed from the two resolved endpoints.

Endpoints, not bodies, also decide legality: a wire may not start and end on the same
connectivity group (that is a null connection and is rejected with an explanation).

## 7. Junction rules

Two wires crossing on screen are **not** connected. A connection exists only where a
junction object exists in the model, drawn as a filled dot. Junctions are created
explicitly, by starting or ending a wire on an existing wire, and they carry an id
that participates in net resolution exactly like a hole. Deleting a junction splits
the net; deleting a wire that carried a junction removes the junction with it rather
than leaving an orphan.

## 8. Battery / power-supply model

A supply is a two-terminal physical object with `+` and `-` terminals, a voltage, a
current limit and an enabled flag. It powers **nothing** until both terminals are
wired into the circuit:

```
supply +  ->  red wire   ->  + rail segment  ->  jumper  ->  7400 pin 14
supply -  ->  black wire ->  - rail segment  ->  jumper  ->  7400 pin 7
```

There is no "a battery exists on the canvas, therefore everything is powered" short
cut anywhere in the engine. The power solver walks the actual nets. A supply whose
terminals end up on the same net is a short across the source and is reported.

## 9. Ground model

Ground is the circuit's voltage reference, which in our model means the net that the
supply's negative terminal drives at 0 V. A dedicated GND symbol is a one-terminal
component that drives the reference, so schematic-style grounding also works, but in
breadboard mode the student is expected to build the return path physically. A TTL
part whose GND pin cannot reach a reference net reports `NO GROUND REFERENCE` and does
not produce output levels; it is not quietly treated as working.

## 10. VCC model

Likewise `+5 V` is a net property, not a component property. For each part we check
its declared power pins against the resolved nets and derive an electrical state:

| Condition | State |
|---|---|
| VCC net at 4.75-5.25 V **and** GND net at reference | `POWERED` |
| VCC pin floating or on an unpowered net | `UNPOWERED` |
| GND pin floating | `NO_GROUND` |
| VCC net below the family minimum | `UNDERVOLTAGE` |
| VCC net above the absolute maximum | `OVERVOLTAGE` then damage timer |
| VCC and GND nets swapped | `REVERSE_POLARITY` then damage timer |

An unpowered IC drives nothing: its outputs go high-impedance and any LED fed from
them goes dark. This falls out of the model rather than being special-cased in the
renderer.

## 11. Constraints for other physical components

Every through-hole part declares a footprint, so the same validator serves all of
them:

* **resistor / capacitor / diode** - two axial leads, span configurable in whole grid
  units, each lead on a hole, the two leads in *different* groups (a part with both
  leads in one group is a short across itself and is rejected with that wording);
* **LED** - two leads, polarised; the model tracks which lead is the anode, so a
  reversed LED stays dark instead of lighting anyway;
* **push button** - a four-pin tactile switch: the two pins on each side are
  internally bonded, and the package is 0.3 in wide, so like a DIP it must straddle
  the trench. This is exactly why real tactile switches are mounted that way and it
  falls out of rule 4 above;
* **SPDT toggle switch** - modelled with real terminals (throw A, common, throw B) so
  the student wires the pull-up / pull-down themselves;
* **supplies, instruments and probes** - off-board objects, allowed to sit on the
  canvas, connected only by wires.

## 12. How physical movement affects wires

The model keeps **electrical topology** and **wire geometry** in separate structures:

* moving a component changes its placement and therefore which holes its pins occupy.
  If it is dropped on a legal position, wires that referenced its *pins* stay
  referenced to those pins and their polylines are re-routed; nets are unchanged.
  Wires that referenced the *holes* it used to sit in stay attached to those holes,
  which is physically correct, because a wire in a hole does not follow a chip that is
  pulled out of the board;
* dragging a wire segment preserves that segment's orientation and repairs the two
  neighbours, adding a corner when one is needed;
* dragging an endpoint re-resolves it against the connection-point index, so the net
  changes only when the endpoint really lands somewhere else;
* an illegal drop is refused: the part springs back to its previous legal placement
  and the status bar explains why. Nothing is ever left in an unrepresentable state.

Undo operates on model operations (place, move, connect, set property), never on
rendered images.

## 13. Behaviour we are deliberately implementing

* Hole-level connectivity groups with the trench and rail splits made real.
* Footprint-driven placement validation with explanatory refusals.
* Pin-numbered DIP packages with datasheet pin mapping, including power pins.
* Modeless wiring: no tool mode required to start a wire from a pin or hole.
* Orthogonal routing with user-chosen corners, junctions, wire editing, wire colours.
* Wire colour as pure metadata, with zero electrical meaning.
* Real power and ground nets; explicit per-IC power state; faults and damage.
* Net resolution over holes, wires, junctions, closed switch contacts and passive
  links, re-run whenever the topology changes.
* Event-driven digital solving with per-part propagation delay.
* A JSON project file that is the single source of truth, versioned and validated.

## 14. Behaviour we are deliberately **not** copying

* **Implicit / hidden power nets.** Schematic tools commonly hide `VCC` and `GND`
  pins and auto-connect them by name. That is a productivity feature for engineers and
  a pedagogical disaster for a first-year lab: the whole point of the exercise is that
  the student wires pin 14 and pin 7. Breadboard mode therefore has no implicit power.
  A future schematic mode may offer named power symbols, but they will be explicit
  objects that create a net, not invisible magic.
* **Auto-routing whole nets, rip-up-and-retry.** We keep manual routing with snapping
  and simple orthogonal assistance. Automatic routing hides the topology the student
  is supposed to be learning.
* **Connection by proximity or by overlapping bodies.** Only declared connection
  points connect.
* **A full analogue solver.** We do not pretend to be SPICE. The digital lab is
  modelled properly, and the analogue behaviour we do model (supply voltage, current
  limit, LED forward drop, pull resistor strength) is deliberately coarse, documented
  as such in the inspector, and kept behind an interface so a real solver can be added
  later without touching the digital core.
* **Game-like failure effects.** Faults are shown as a warning state, a heat tint and
  a disabled output, with a written explanation. No explosions.
* **Any proprietary look, branding, symbol artwork or asset** from the reference
  products. All rendering in ProtoLab is drawn from our own primitives.
