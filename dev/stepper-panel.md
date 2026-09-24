> Superseded 2026-09-24 by DESIGN.md "Stepper anatomy" (no pip, no latch, no Home/End, no governed set; the stepper is a readout plus figure.activeState).

# Stepper redesign — panel spec (workflow wf_f357ff8e-513, 2026-09-24)

# Stepper spec (panel verdict, verified)

## Vocabulary (new "Stepper anatomy" table beside "Slider anatomy")

| word | what it is | DOM |
|---|---|---|
| stepper | the whole widget: row + caption | `.x-stepper` |
| step | one named state as the reader meets it ("2 of 3"); code keeps `state`; a slider's `step` key is its *increment* | `notice.states[i]`, optional `label` |
| row | paddles, latch, key hints; carries the face | `.x-stepper-row[role=group][data-face]` |
| paddle | the ‹ › buttons (never "arrow") | `.x-prev` / `.x-next` |
| latch | the center toggle: free "Step through 3 steps", stepped "2 of 3 · quarter"; press = step in / step off | `button.x-latch[aria-pressed]` |
| counter | the latch's stepped text (`label ?? name`) | `span.x-counter` |
| pip | .7em disc: ring = free, solid = stepped; the corner toggle's dot, one rule | `.x-latch::before` |
| caption | the step's sentence; slot keeps one line | `p.x-caption` |
| key hints | ← → `<kbd>` outside the paddles while armed | `kbd.x-key` |
| announcer | hidden live text, guarded writes | `span.x-sr[aria-live]` |

## Modes

Two axes. **stepped / free** is the figure's pose: stepped = the stepper holds a step (`activeState`, set only by `goto`); free = the figure follows its controls. **armed** = focus inside the row, forced with an explicit `focus()` so Safari arms on click. Boot is always free, even when defaults equal step 1: your fourth state. **Step off** = a *governed* control moved (grabbing a drag handle counts; "show the rim" does not), Play pressed (synchronous, so it works under pause-all), Restart, or the latch pressed again. Prose and deep links step in without arming.

## The first click

It is no longer on ›. The free face dims both paddles and puts one labeled door in the middle: **Step through 3 steps**, hollow pip. Pressing it steps in at the **nearest** step (step 1 from defaults, no motion; the closest step after dragging, never backwards), fills the pip, reveals the caption, lights the paddles, and keeps focus so arrows work at once. Pressing the filled latch steps off. Hollow = system, filled = you.

## Keyboard (armed, unmodified)

| key | result |
|---|---|
| Tab | latch (free) or ‹ latch › (stepped); never a trap |
| ← → | previous / next, clamped; on the latch when free = step in |
| Home / End | first / last step |
| Enter / Space | the focused button |
| Escape, ↑ ↓, Page keys | not bound |

Ends use `aria-disabled` dimmed by color, so focus never drops and the ring keeps contrast.

## Visuals

Paddles unchanged (44 px). Latch = house pill, two spans grid-stacked so the row never changes width; 2.75rem on phones too. Counter ellipsizes with the row. Pip drawn as border (survives forced colors; the toggle gets the same fix). Key hints `<kbd>` at ±2.4rem on `:focus-within` under `(hover: hover) and (pointer: fine)`, hidden under 40rem. Caption `min-height: 1.5em`. Both radio rows 2.75rem. All tokens; nothing for dark mode; no transitions under reduced motion.

## Edge cases

Defaults equal a step → boots free, latch lands with no motion. Drag onto 90° → still free. Between steps → nearest. Play while stepped → off at once, focus rescued to the latch. Deep link → stepped, figure focused, not armed. Autoplay skipped when booted stepped (scene3d safe). Non-governed toggle mid-ease → ease continues. Rapid presses → retarget. Segmented → legend "Steps", caption-only announcer.

## Budget

Bundle 38,896 B gz today; ceiling 40,000 (`test/runtime.test.mjs:326`). Estimate +0.85 KB → ~39,750. Cap +1.0 KB measured. Drop order: Home/End, paddle `aria-describedby`, kbd → pseudo-elements, nearest → step-1 fallback, governed refinement.

## Verifiers

Accepted: renamed held/release/enter/tick to stepped, step off, latch, advance (drag and slider own the old words); made the center slot a real toggle (`aria-pressed`), which also fixes the pip idiom, the width shift and the entry focus handoff; dropped Escape and `aria-keyshortcuts`; color-dim for `aria-disabled`; 44 px latch and radio labels on phones; border-drawn pip; `label ?? name`; caption-only announcer in segmented; step off moved into `fig.play()`; autoplay guard; cancel scoped to the step-off branch; handoffs in `sync()` with `preventScroll`; governed set built once per goto, drag grab stated; `nearestState → {name, exact}`; deep-link focus; corrected ceiling and measurement; DESIGN.md edit list (:525, :828, :867, :947–950, Figure object, increment row); dev page words and selector; unique top-level names. Rejected: the readout-mirror JS change (the 300 ms debounce already yields one line per press; the spec's claim was corrected instead); `[hidden] !important` (superseded by `data-face` + visibility); "start button" (collides with Restart and the range start); describedby to the counter (it is now the latch's own name; caption only).

## Dissent

Boot-in-step; › as entry; per-step pips; spinbutton; auto-landing; plain-text stepped face. Open questions list what to revisit.

## Vocabulary
- **stepper** — the whole widget under the controls: the row and the caption `.x-stepper (id <fig>_steps)`
- **step** — one of the N named states in author order, as the reader meets it ("2 of 3"); spec, code, deep link and events keep `state`. A slider's `step` key is its increment (DESIGN.md:460 already says so; the Slider-anatomy stop row is rewritten to match), so the word is free. `notice.states[i]; goto(name); #fig-x=name`
- **label** — optional reader-facing text for a step (`states[i].label`); the counter, announcer and segmented labels show `label ?? name`; goto, hash and events keep `name` `notice.states[i].label`
- **row** — the one-line strip: two paddles, the latch between them, the key hints floating outside; carries the face `.x-stepper-row[role=group][aria-label=Steps][data-face=free|stepped]`
- **paddle** — one of the two round ‹ › buttons that move one step; never "arrow" (a scene2d layer kind) or "chevron" `button.x-prev / button.x-next, aria-label "previous step" / "next step", aria-describedby → the caption`
- **latch** — the center toggle button, always present and focusable. Free: hollow pip + "Step through 3 steps" ("Step through 1 step" for N=1); pressing it steps in at the nearest step. Stepped: filled pip + counter; pressing it steps off (the figure stays put, the caption empties). The one door in and the one deliberate door out; completes the corner toggle's pressed/unpressed idiom. `button.x-latch[aria-pressed=false|true]; two stacked spans, the inactive one visibility:hidden so the width never changes`
- **invitation** — the latch's free-face text, "Step through 3 steps" `span.x-invite inside .x-latch`
- **counter** — the latch's stepped-face text, "2 of 3 · quarter" (label ?? name); not a readout (on-canvas text) and not a value (a slider's number) `span.x-counter inside .x-latch`
- **pip** — the .7em border-box disc at the start of the latch: 1.5px ring when free, solid (border-width .35em, no background, so forced colors keep it) when stepped. The corner toggle's dot uses the same rule, so the figure has one pressed/unpressed glyph; never token-colored on the latch (currentColor) `.x-latch::before, .x-toggle::before; filled via [aria-pressed=true]::before { border-width: .35em }`
- **caption** — the stepped step's sentence under the row (spec key `caption`); empty when free, its slot keeps one line so the figcaption does not jump `p.x-caption#<fig>_steps_cap`
- **key hints** — the two <kbd> glyphs ← → floating just outside the paddles while the row is armed on a fine-pointer device; decorative `kbd.x-key[aria-hidden=true] ×2, absolutely positioned`
- **announcer** — the visually hidden live text that speaks a step change ("Step 2 of 3, quarter. <caption>"); written only when the string changes, emptied on step off; in segmented mode it carries the caption alone (the radio already says its name and position) `span.x-sr[aria-live=polite][aria-atomic=true]`
- **stepped** — mode: the stepper holds the figure at a step (the owner's human-controlled); set only by goto. Replaces "held", which DESIGN.md:988 uses for a drag handle `fig.activeState === name; row[data-face=stepped]`
- **free** — mode: the figure follows its own controls: defaults, a control the reader moved, Play, Restart (the owner's system-controlled) `fig.activeState === null; row[data-face=free]`
- **step in / step off** — the two transitions: step in = free → stepped (latch, paddles from free via arrows, prose link, deep link, radio); step off = stepped → free (a governed control moved, Play pressed, Restart, the latch pressed again). Replaces "release", a drag word (DESIGN.md:220, 850) `fig.activeState set by goto / cleared in fig.set, fig.play, fig.restart`
- **armed** — mode: keyboard focus is inside the row (the owner's clicked-in), so ← → Home End act and the key hints show. Orthogonal to stepped/free: a prose link steps in without arming, Tab arms without stepping in `.x-stepper-row:focus-within`
- **face** — which of the row's two appearances shows: the free face (hollow pip, invitation, dimmed paddles, empty caption) or the stepped face (filled pip, counter, live paddles, caption) `data-face on .x-stepper-row; CSS swaps the latch spans by visibility`
- **ends** — step 1 for ‹ and step N for ›: the paddle is inert but stays focusable and keeps its focus ring; the tour never wraps `[aria-disabled=true] (stepped face); `disabled` only in the free face`
- **nearest** — the step whose targets are closest to the current scope (per-target difference normalized by the control's range, booleans 0/1, camera and drag targets ignored, ties to the lower index) and whether it is exact (every measurable target within 1e-6); where the latch lands `nearestState(compiled, scope, eps = 1e-6) → { name, exact } in lib/core/state.js`
- **governed** — a control the stepped step sets a value for; moving a governed control steps off, moving any other (a toggle the step never names) does not. Computed once per goto as the set of target-name prefixes; `p.x` and `p.y` govern `p`, so grabbing a governed drag handle (`p.dragging`, set with source 'user' at pointerdown) steps off `held-set = new Set(Object.keys(targets).map(k => k.split('.')[0])), tested in fig.set as set.has(name.split('.')[0])`
- **advance** — one Play clock step (`advance(dt)` in figure.js); never "tick", which Slider anatomy owns for the bar at a stop `advance(dt)`
- **ease** — the 600 ms glide of a goto (0 ms under prefers-reduced-motion); the counter and caption already show the target while the controls catch up `transition() in figure.js; x-fig:state fires on completion`

## Modes
- **free** — System-controlled. The figure shows its defaults, whatever the reader set on a control, or Play's progress. The stepper only offers a way in.
  - enter: Boot, always, even when the defaults equal step 1 (figure.js:418 is removed and the unused activeState import dropped; activeState() stays exported for test/runtime.test.mjs:159-166 and the CLI); Boot with #fig-x (no state) or a plain scroll to the figure; The reader moves a governed control (slider knob, keyboard nudge, drag handle grab or move, segmented pick, a toggle the step sets) → fig.set(..., 'user'); Play pressed: fig.play() clears activeState synchronously, before its range reset, so the free face and the snapped slider appear together (no frame shows '3 of 3' over a slider already at 0); Restart; The latch pressed while stepped (step off; the figure stays where it is)
  - leave: Press the latch (steps in at nearest); ← or → while armed with focus on the latch (same as pressing it); Click a prose a[data-state] link; Load or hashchange to #fig-x=<state>; Segmented mode: pick a radio
  - shown by: Hollow pip; the latch reads "Step through 3 steps" with aria-pressed=false; both paddles `disabled` at .35 opacity; caption empty (slot keeps one line); announcer emptied so stepping off says nothing; hash unchanged.
- **stepped (step k of N)** — Human-controlled. The stepper holds the figure at step k: the controls sit at that step's values and the caption is true of the drawing.
  - enter: Latch: goto(nearest.name, {ease: !nearest.exact}); Paddle press, ← → Home End while armed, from another step (retargets a running ease from its current values); a[data-state] click: goto with ease, scroll only if off-screen, does not arm (hooks.js:46 unchanged); #fig-x=<state> at load or hashchange: goto without ease, scrolled to, then fig.el (tabIndex -1) takes focus with preventScroll so Tab and the reading cursor continue from the figure; not armed; Segmented radio change
  - leave: Reader moves a governed control (a drag handle's grab counts); Play pressed (synchronous in fig.play); Restart; The latch pressed again; Never by Escape (unbound), never by a paddle
  - shown by: Filled pip; latch reads "2 of 3 · quarter" (label ?? name) with aria-pressed=true; caption below; paddles live, the one at an end dimmed by color, not opacity, with aria-disabled; hash #fig-x=quarter; announcer "Step 2 of 3, quarter. <caption>"; x-fig:state when the ease completes.
- **armed** — Keyboard focus is inside the row (the owner's clicked-in). Keyboard traversal is live. Orthogonal to stepped/free.
  - enter: Tab or Shift+Tab onto a stepper button (the latch in the free face; ‹, latch, › in the stepped face); Any pointer or touch activation of a stepper button: the handler calls .focus({preventScroll:true}) so Safari, which never focuses a clicked button, arms too
  - leave: Tab or Shift+Tab out; Pointer down anywhere else (a slider, Play, the prose); Step off while focus is on a paddle (Play's click in Safari leaves focus on ›): stepper.sync() moves focus to the latch with preventScroll before the paddles are disabled, so it never lands on body
  - shown by: Key hints ← → outside the paddles, only under @media (hover: hover) and (pointer: fine); the house 2 px --x-accent :focus-visible ring on the focused button after keyboard focus, none after a mouse click. Nothing is drawn around the row itself.
- **easing (transient, inside stepped)** — A goto is in flight for up to 600 ms (0 under reduced motion); the controls glide to the step's values while the counter and caption already show the target.
  - enter: Any step in or any step change
  - leave: The transition completes (hash written, x-fig:state emitted, the readout mirror follows 300 ms later as one line); Retargeted by the next press (no queue, no overshoot); Cancelled by a governed 'user' set (step off; the figure stays where the ease had got to). A non-governed set (a toggle the step never names) leaves the ease running: fig.set scopes the cancel to the step-off branch
  - shown by: The knob and drawing moving; nothing on the stepper changes. Deliberate: the counter is the promise, the figure catches up.
- **playing (sub-case of free)** — Play is advancing its target control; the stepper stepped off the moment Play was pressed.
  - enter: Play or Restart pressed; autoplay on approach (never under reduced motion, and skipped when the figure booted stepped: markMounted guards on !fig.activeState, so a scene3d deep link is not undone by its late mount)
  - leave: Latch, prose link or deep link: goto pauses Play first, then steps in; Pause, or a non-looping play reaching its max: stays free
  - shown by: Free face plus the corner button reading Pause; the stepper does not say "playing", the Play button already does. The announcer is not rewritten per advance (writes are guarded).

## Interactions
- Click or tap the latch (free face) → nearestState → goto(name, {ease: !exact}); face → stepped; pip fills; counter and caption appear; paddles enable; focus stays on the latch (explicit .focus for Safari) so the row is armed and arrows work at once; hash → #fig-x=<step>. From a defaults-equal-step-1 figure this is step 1 with no motion; from a slider at 170° with steps at 0/90/180 it is half (180°), never backwards.
- Click or tap the latch (stepped face) → Step off: activeState → null; face → free; caption empties; the figure does not move; announcer emptied; hash unchanged. Pressing again steps in at the same step with no motion (exact).
- Click or tap › (stepped, k < N) → goto(step k+1) eased; counter, caption and announcer update at once; › keeps focus (armed).
- Click or tap ‹ (stepped, k > 1) → goto(step k−1) eased; same as above.
- Click or tap a paddle at an end (stepped, k = 1 (‹) or k = N (›)) → No-op. The paddle is aria-disabled, stays focusable, keeps focus and its full-contrast focus ring. No wrap.
- Click or tap a paddle (free face) → Nothing; the paddles are `disabled`. The latch is the one door in.
- Pointer down on any stepper button (any) → Explicit .focus({preventScroll:true}) so :focus-within holds in every browser; no :focus-visible ring for pointer-originated focus.
- Hover a paddle or the latch (fine pointer) → Border darkens to --x-muted (existing .x-fig button:hover). Hover never changes state.
- Move a governed control: drag the knob, nudge it with keys, grab or drag a handle, pick a segment, press a toggle the step sets (stepped) → Step off on the first 'user' set: running ease cancelled, activeState → null; face → free; caption empties; the figure stays where the reader put it; the announcer is emptied, not rewritten.
- Press a toggle or control the step does not set ("show the rim" at quarter) (stepped, including mid-ease) → The step holds and a running ease keeps running; the toggle just draws. (Today fig.set:190 cancels and clears unconditionally.)
- Press Play (stepped) → fig.play() steps off synchronously, then resets the range and starts; the free face and any snapped slider appear in the same frame. If focus was on a paddle it moves to the latch first. Works under pause-all and off screen, since it no longer waits for advance().
- Press the latch, a prose link or a deep link (playing) → goto pauses Play, then steps in; the corner button reads Play again.
- Press Restart (any) → Step off (free face); the target control snaps to its start and Play runs.
- Click a[data-state][href="#fig-x"] in the prose (any) → Step in at that step, eased; the figure scrolls into view only if off-screen; stepped face shown but not armed, focus stays on the link; the announcer speaks the step and caption.
- Load with #fig-x=<state>, or hashchange to it (any) → Figure boots eagerly, goto without ease → stepped face, scrolled to; route() then focuses fig.el (tabIndex -1, preventScroll) so sequential focus and the reading cursor start at the figure; not armed. An unknown state is ignored (existing compiled.states check).
- Segmented mode: click or tap a radio label, or arrow keys in the radiogroup (steps: 'segmented') → Native radio → goto(that step), stepped face with caption; no radio checked is the free face; the legend reads "Steps"; labels show label ?? name and are 2.75rem tall; the announcer carries the caption only.
- Rapid › presses or held-down → during an ease (stepped) → Each press retargets the running transition from the current interpolated values; hash and x-fig:state fire once, at the end; the counter always shows the latest target.
- Scheme change (light ↔ dark) (any) → Pip, paddles, key hints and latch recolor through tokens; no state change.

## Keyboard
- `Tab / Shift+Tab` (from outside the row) → Free face: lands on the latch (disabled paddles are skipped). Stepped face: ‹, latch, › (paddles focusable even at an end). The row is armed; key hints appear on fine-pointer devices.
- `→` (armed and stepped) → Same as ›: goto(k+1), clamped at N (swallowed no-op at the last step); preventDefault.
- `←` (armed and stepped) → Same as ‹: goto(k−1), clamped at 1; preventDefault.
- `→ or ←` (armed and free (focus is on the latch)) → Same as pressing the latch: step in at nearest; focus stays on the latch.
- `Home / End` (armed and stepped) → goto(step 1) / goto(step N); preventDefault. First to drop if the budget is tight.
- `Enter / Space` (on a focused paddle or the latch) → Native button activation, identical to a click; a no-op on an aria-disabled paddle.
- `Escape` (armed) → Not bound. blur() would send focus to body (APG focus-loss anti-pattern) and no key needs handing back: ↑ ↓ PageUp PageDown were never taken. Tab out or a pointer elsewhere disarms.
- `Any of the above with Alt, Ctrl, Meta or Shift held` (armed) → Not handled, not prevented (Cmd+← is Back in Safari, Alt+← in Chrome).
- `↑ ↓ PageUp PageDown` (armed) → Not bound; the page scrolls.
- `Tab / Shift+Tab` (from inside the row) → Leaves the row (never a trap); disarms; key hints hide.

## Visuals
- Row: .x-stepper-row { position: relative; display: inline-flex; align-items: center; gap: .75rem; max-width: 100%; min-height: 2.75rem }. Paddles are always in the DOM (dimmed, never hidden); the latch is one element whose two spans are stacked (.x-latch { display: inline-grid; align-items: center } .x-latch > span { grid-area: 1 / 1 }) with the inactive span visibility: hidden, so the slot is always the width of the wider face and switching face or arming never moves a paddle. The row has no border or background in any mode.
- Paddles: unchanged 2.75rem circles, ‹ ›, 1.6rem/400 glyph, 1 px --x-rule border, translucent --bg fill. Two dim rules: .x-stepper button:disabled { opacity: .35 } (free face, unfocusable) and .x-stepper button[aria-disabled="true"] { color: color-mix(in srgb, currentColor 35%, transparent); border-color: color-mix(in srgb, var(--x-rule) 50%, transparent); cursor: default } (stepped-face ends, focusable), so the :focus-visible outline keeps full contrast.
- Latch: the house pill as the corner toggle draws it (600 .8125rem sans, 1 px --x-rule border, color-mix(--bg 88%) fill, hover darkens the border); .x-stepper .x-latch { min-height: 2.75rem; min-width: 0 } repeated inside the 40rem block so line 204's 2.5rem shrink never applies (one row, one height). Not inverted when pressed: it follows .x-toggle (dot fills), not .x-play.
- Counter span: .9rem sans is dropped in favor of the pill's own font; font-variant-numeric: tabular-nums; white-space: nowrap; min-width: 0; overflow: hidden; text-overflow: ellipsis so at 360 px the latch shrinks to the column (44 + 12 + latch + 12 + 44 ≤ 328) instead of overflowing at a fixed 14rem. Color inherits --fg (today's --x-muted made the active thing look inactive).
- Pip: shared rule .x-toggle::before, .x-latch::before { content: ''; display: inline-block; box-sizing: border-box; width: .7em; height: .7em; border-radius: 50%; border: 1.5px solid var(--token, currentColor); margin-right: .5em; vertical-align: -.05em } and .x-toggle[aria-pressed="true"]::before, .x-latch[aria-pressed="true"]::before { border-width: .35em }. The fill is border, not background, so forced-colors mode (which paints backgrounds Canvas) still shows a solid disc; the toggle's own latent bug goes with it (its dot grows ~1 px).
- Key hints: kbd.x-key { position: absolute; top: 50%; translate: 0 -50%; font: 600 .7rem/1 var(--x-sans); padding: .2em .4em; min-width: 1.6rem; text-align: center; color: var(--fg); background: var(--x-panel); border: 1px solid var(--x-rule); border-bottom-width: 2px; border-radius: 4px; visibility: hidden; opacity: 0; transition: opacity .12s } with left: -2.4rem / right: -2.4rem; .x-stepper-row:focus-within .x-key { visibility: visible; opacity: 1 } inside @media (hover: hover) and (pointer: fine); display: none otherwise and under @media (max-width: 40rem).
- Caption: .x-caption { margin: .6rem 0 0; min-height: 1.5em; font: .95rem/1.5 var(--x-serif) }; the :empty { display: none } rule (CSS:144) goes so stepping off does not pull the figcaption up. No fade; the caption changes at the start of the ease.
- Focus: the existing 2 px --x-accent :focus-visible ring on every stepper button; nothing on the row.
- Dark mode: every color is a token (--fg, --bg, --x-rule, --x-panel, --x-accent); the pip is currentColor; nothing new to theme.
- Phone (360 px, 328 px content): key hints hidden; free row ≈ 44 + 12 + ~150 + 12 + 44 = 262 px; the stepped row is the same width (stacked faces); a long name ellipsizes inside the latch. The 40rem block's 2.5rem shrink is overridden for .x-latch; paddles keep 2.75rem.
- Segmented: CSS:130 changes to min-height: 2.75rem for both .x-ctl-segmented label and .x-steps-seg label, so the one pill idiom has one height and every radio is a 44 px target; legend "Steps"; no pip.
- Reduced motion: the key-hint transition is set to none in the existing @media (prefers-reduced-motion: reduce) block; goto is already 0 ms; faces switch instantly.
- Forced colors: pip is border-drawn (above); key hints are real borders; aria-disabled paddles read in GrayText through the color-mix of currentColor.

## ARIA
- Row: role="group" aria-label="Steps" on .x-stepper-row so the paddles and latch announce as one control; the keydown listener lives on the row, so arrows act only while a stepper button has focus and never intercept browse-mode arrows, the slider's native arrows or the drag proxy's handler.
- Latch: a toggle button, aria-pressed="false" free / "true" stepped; its accessible name is the visible span ("Step through 3 steps" or "2 of 3 · quarter"), since a visibility:hidden span is excluded from name computation; the name changes with state the way the house Play/Pause button's does.
- Paddles: aria-label "previous step" / "next step"; aria-describedby="<fig>_steps_cap" (the caption's id) so a Tab onto a paddle says where the figure is; `disabled` only in the free face (focus is never on them then); aria-disabled="true" at the ends in the stepped face so they stay in the tab order. No aria-keyshortcuts: browse-mode readers never deliver arrows to the page handler, and the attribute is for shortcuts that work without focus.
- Announcer: one persistent visually hidden span.x-sr[aria-live=polite][aria-atomic=true] (reuse the sr-only rule at CSS:71). sync() writes "Step 2 of 3, quarter. <caption>" only when the string changed, "" on step off, and in segmented mode the caption alone (the native radio already says "north, radio button, checked, 2 of 3"). Not the visible caption or a toggled element: a region that leaves and re-enters the tree via display:none is a new region and often silent, and per-frame syncControls during an ease must not re-announce.
- A paddle press yields the announcer line and, 300 ms after the ease settles, one readout-mirror line ("angle 90°", figure.js:344 debounce); the two regions carry different content and each speaks once per press.
- Focus management: explicit .focus({preventScroll:true}) on pointer activation (Safari); no handoff on step in, the latch keeps focus; on step off while focus is on a paddle, stepper.sync() moves focus to the latch (preventScroll) before `disabled` is applied. No `disabled` is ever set on a focused element. Deep links focus fig.el (tabIndex -1) after scrolling.
- Touch: every target is the 2.75rem (44 px) house size including the latch on phones and both radio rows; touch-action: manipulation on all buttons; no hover-only affordance; key hints never render on coarse pointers.
- Modifier-safe: the row handler returns early on altKey || ctrlKey || metaKey || shiftKey.
- No new global shortcuts, no keyboard traps: Tab always leaves the row; Escape is not bound.
- Contrast: latch text in --fg; key hint text in --fg on --x-panel; :disabled paddles at .35 are exempt as unfocusable disabled controls; aria-disabled ends dim by color only so their focus ring is full strength.
- Segmented legend reads "Steps" (stepper.js:12 says "States" today).
- Verify on VoiceOver macOS + Safari (explicit focus arms; latch name change), NVDA + Firefox (announcer on prose link; describedby on Tab), VoiceOver iOS (44 px targets, no hints), TalkBack.

## DOM sketch
```html
<!-- buttons mode, FREE face (boot, or after stepping off) -->
<div class="x-stepper" id="fig-x_steps">
  <div class="x-stepper-row" role="group" aria-label="Steps" data-face="free">
    <kbd class="x-key" aria-hidden="true">←</kbd>
    <button class="x-prev" type="button" aria-label="previous step" aria-describedby="fig-x_steps_cap" disabled>‹</button>
    <button class="x-latch" type="button" aria-pressed="false">        <!-- ::before = hollow pip -->
      <span class="x-invite">Step through 3 steps</span>
      <span class="x-counter"></span>                                  <!-- stacked; visibility:hidden in this face -->
    </button>
    <button class="x-next" type="button" aria-label="next step" aria-describedby="fig-x_steps_cap" disabled>›</button>
    <kbd class="x-key" aria-hidden="true">→</kbd>
  </div>
  <p class="x-caption" id="fig-x_steps_cap"></p>                       <!-- empty; min-height keeps one line -->
  <span class="x-sr" aria-live="polite" aria-atomic="true"></span>     <!-- announcer, emptied on step off -->
</div>

<!-- buttons mode, STEPPED face at step 2 of 3 (armed: focus on .x-next; key hints visible on fine pointers) -->
<div class="x-stepper" id="fig-x_steps">
  <div class="x-stepper-row" role="group" aria-label="Steps" data-face="stepped">
    <kbd class="x-key" aria-hidden="true">←</kbd>
    <button class="x-prev" type="button" aria-label="previous step" aria-describedby="fig-x_steps_cap">‹</button>
    <button class="x-latch" type="button" aria-pressed="true">         <!-- ::before = filled pip (border-width .35em) -->
      <span class="x-invite">Step through 3 steps</span>              <!-- visibility:hidden in this face -->
      <span class="x-counter">2 of 3 · quarter</span>                  <!-- label ?? name -->
    </button>
    <button class="x-next" type="button" aria-label="next step" aria-describedby="fig-x_steps_cap">›</button>   <!-- aria-disabled="true" at step 3 -->
    <kbd class="x-key" aria-hidden="true">→</kbd>
  </div>
  <p class="x-caption" id="fig-x_steps_cap">A quarter turn: the dot is straight up.</p>
  <span class="x-sr" aria-live="polite" aria-atomic="true">Step 2 of 3, quarter. A quarter turn: the dot is straight up.</span>
</div>

<!-- segmented mode: radio row, legend renamed, labels 2.75rem, label ?? name, announcer carries the caption only -->
<div class="x-stepper" id="fig-x_steps">
  <fieldset role="radiogroup" class="x-steps-seg"><legend>Steps</legend>
    <label><input type="radio" name="fig-x_steps" value="east"><span>East</span></label>…
  </fieldset>
  <p class="x-caption" id="fig-x_steps_cap"></p>
  <span class="x-sr" aria-live="polite" aria-atomic="true"></span>
</div>
```

## Edge cases
- Figure whose defaults equal step 1 (the dev page's fig-three, most article figures, likely the owner's noon figure) → Boots free: hollow pip, "Step through 3 steps", empty caption slot. The latch lands on step 1 with no motion (nearest.exact) and reveals its caption. Authors who want the step-1 sentence visible before any interaction put it in the figcaption. Deliberate removal of figure.js:418.
- Reader drags the slider exactly onto a step's values (a = 90) → Stays free (a 'user' set steps off; no auto-landing). nearest = quarter, exact, so the latch fills the pip and shows the caption without moving anything.
- Reader is between steps (a = 170, steps at 0/90/180) → Latch → half (180°), a 10° ease forward, counter "3 of 3 · half", › dimmed with aria-disabled. Ties in normalized distance go to the lower index.
- Nearest under multi-control steps → Sum of squared per-target differences, each normalized by its control's range (values lists by index / length, booleans and segmented 0/1); camera and drag targets are skipped; a step with no measurable targets is never nearest unless it is the only step; exact requires every measured target within 1e-6 (the activeState() rule at state.js:57).
- Latch pressed while stepped → Steps off: caption empties, pip hollows, paddles disable, figure unchanged, hash unchanged. A second press steps back in at the same step with no motion. Recoverable in one press.
- N = 1 → "Step through 1 step"; stepped face "1 of 1 · name" with both paddles aria-disabled; the latch is still the only way to see the caption.
- N = 2, 6, 8 (dev figures) → Identical faces; only digits change; the row keeps the free face's width.
- Long step name at phone width → The latch shrinks with the row (min-width: 0) and the counter ellipsizes; the announcer speaks the full string.
- Press › three times quickly, or hold → (OS key repeat), during an ease → Each press cancels the running transition and eases from the current interpolated values; hash and x-fig:state fire once, at the end.
- Non-governed toggle pressed mid-ease → The ease keeps running to the step's values; the toggle draws; the counter's promise is kept. fig.set cancels only in the step-off branch.
- Grab a governed drag handle without moving it → Steps off at pointerdown (`p.dragging` is set with source 'user' at figure.js:93 and `p` is governed). Stated, not hidden: a grab is intent to move.
- Play is running and the reader presses the latch → goto pauses Play, steps in at the step nearest the paused position; the corner button flips to Play.
- Play pressed while stepped under pause-all, or with the figure off screen → Steps off at once (fig.play clears activeState), so the stepper never sits stepped under a Pause button.
- Deep link at boot on a figure with autoplay: true, including a scene3d whose chunk mounts after route() → goto runs first; markMounted skips autoplay because fig.activeState is set; the figure lands stepped and stays. Autoplay is already ignored under reduced motion.
- hashchange to #fig-x=state while armed → Stepped face at that step; focus moves to fig.el (route() focuses it), disarming; the reader Tabs back into the row from the figure.
- Toggle a control the step does not set ("show the rim" at quarter) → Stays stepped, caption stays; the toggle just draws. Requires the governed test in fig.set.
- Safari mouse click on a paddle or the latch → The handler's explicit .focus() arms the row so key hints appear and arrows work; no ring, since the focus was pointer-originated.
- Focus is on › when Play is pressed (Safari left focus on › after the reader clicked Play) → fig.play → syncControls → stepper.sync(null) sees a paddle focused and moves focus to the latch (preventScroll) before disabling the paddles; focus never drops to body and the page does not scroll.
- Coarse pointer with a keyboard attached (iPad + keyboard) → Arrow keys work while armed; key hints stay hidden because the media query keys on the primary pointer. Accepted trade-off.
- Two steppers on one page → Only the row containing the focused button handles keys; each has its own announcer and caption id.
- Segmented mode after a prose link, then a slider nudge → Radio checks on the link (announcer: caption only), unchecks on step off; caption follows; no pip.
- steps: 'none' → Nothing mounts; deep links and prose links still step the figure in (activeState set) with no visible indicator, the author's choice.
- Reader steps off and copies the URL → The hash still names the step they left; kept, because a reload cannot restore a nudged position and returning to the last authored step is the useful outcome.
- prefers-reduced-motion → All gotos snap; no key-hint fade; faces switch instantly; nothing animates on its own.
- Deep link to an undeclared state → Ignored (existing compiled.states check); the page scrolls to the figure, which boots free; route() still focuses the figure.
- Forced colors (Windows high contrast) → Pip stays a ring or a solid disc because both are border; key hints keep their borders; aria-disabled paddles read in GrayText.
- fig.dispose() → .x-stepper is removed with the other nodes (figure.js:412); the keydown listener lives on the row, so nothing leaks.

## Decisions
- The paddles are inert in the free face; the latch ("Step through 3 steps") is the one door in, and it lands on the nearest step in one press. — The owner's complaint is exactly that › entered the tour. A labeled door says what the first press does; landing on a step in that press keeps touch to one tap and gives the paddles a defined "next" from the moment they light up. (dissent: Accessibility and the first-time reader would keep › as the entry from free, relabeled with its destination. Rejected: the paddle's meaning keeps shifting, and "ahead" is undefined for multi-control steps.)
- The center slot is one always-present toggle button, the latch, with aria-pressed and two stacked text faces; pressing it while stepped steps off. — The design-language verifier showed the pip borrowed the corner toggle's pressed/unpressed dot but sat on a non-pressable span, giving one glyph two meanings. Making the slot a real toggle completes the idiom, gives the owner an explicit hand-back, removes the entry focus handoff (focus never leaves the latch), and the grid-stacked spans hold the row's width across faces. The earlier rule "never by clicking the counter" is reversed. (dissent: The earlier panel held that stepping off without moving anything only makes the caption vanish; the visual designer may object that the stepped face is now a bordered pill rather than plain text. Recorded as an open question.)
- Boot is always free, even when the defaults equal a step; activeState means strictly "the stepper holds the figure" and is set only by goto. figure.js:418 goes; activeState() stays exported. — This is the owner's four-state model: uninteracted, then 1..N. The pip is honest: filled = the stepper is in control. (dissent: Accessibility, the editor and the first-time reader wanted a defaults-equal-step figure to boot "1 of 3". Mitigation: the latch lands on step 1 with no motion, and authors put the opening sentence in the figcaption.)
- Vocabulary: stepped / free for the modes, step in / step off for the transitions, latch for the center button, advance for Play's clock step. — "held" (DESIGN.md:988), "release" (:220, :850) and "tick" (Slider anatomy) are already taken by drags and sliders; "enter button" collides with the Enter key in the same table. None of the new words appear in Slider anatomy, the `arrow` layer kind, or the Play/Restart prose. (dissent: The design-language verifier proposed "start button"; rejected because "start" is Restart's word and the range's start. "door" was considered and kept only as prose ("the one door in").)
- Step off when a governed control moves (drag grab included), when Play is pressed (synchronously in fig.play), on Restart, or when the latch is pressed again. A non-governed control never steps off and never cancels a running ease. — Runtime verifier: advance() runs only while visible and not paused-all, so the old release could hang; the range reset in play() showed a stale counter for a frame; fig.set:190 cancelled before any governed test. Moving the clear to play() and scoping the cancel fixes all three. (dissent: The editor and the first-time reader wanted auto-landing when a drag ends exactly on a step; deferred.)
- Autoplay is skipped when the figure booted stepped (markMounted guards on !fig.activeState). — A scene3d mounts after route()'s deep-link goto, so autoplay's first advance would undo the link.
- No per-step pips in this pass. — Six small targets at 360 px repeat the counter; segmented mode, prose links and deep links give direct choice by name; and the measured headroom (~1.1 KB) leaves no room for ~200 B of optional chrome. (dissent: The visual designer and the editor wanted a row of pips.)
- Armed = DOM focus inside the row (:focus-within), forced with an explicit .focus({preventScroll:true}) on pointer activation; no JS mode flag. Escape is not bound. — Focus is what keyboard readers already have; Safari needs the explicit call; Tab and pointer-away disarm for free. blur() on Escape would send focus to body, and there is nothing to hand back since ↑ ↓ and Page keys were never taken.
- role=group with the latch and two paddle tab stops; aria-disabled at the ends dims by color-mix, not opacity. — aria-disabled keeps focus from dropping to body; the opacity rule would also fade the focus ring on a now-focusable element, so the ends dim text and border while the outline keeps full contrast. (dissent: The accessibility specialist proposed an APG spin button. With one always-present latch it is now a plausible later unification; recorded as an open question.)
- Keys: ← → Home End on the row, unmodified only; no ↑ ↓; no aria-keyshortcuts. — Left/Right conflict with nothing; Up/Down and Page keys stay with the page; modifiers stay with the browser; browse-mode readers never receive the arrows, so advertising them to AT was false.
- Key hints are real <kbd> elements, aria-hidden, absolutely positioned outside the paddles, shown on :focus-within under (hover: hover) and (pointer: fine), hidden under 40rem. — The owner asked for kbd items at the far edges; two elements cost ~40 B and never shift the row. (dissent: Pseudo-elements at zero JS are the fallback if the budget is hit.)
- The announcer is a persistent visually hidden live span with guarded writes; segmented mode writes the caption alone. The readout mirror is left as is. — A region toggled through display:none is often silent; the radio already speaks its name and position. The mirror's 300 ms debounce (figure.js:344) already collapses an ease to one line, so the earlier spec claim was corrected rather than the code changed.
- The counter, announcer and segmented labels show `label ?? name`; `label` is a new optional key on a state. — Three of five experts and the accessibility verifier wanted slugs like "s1" and "year-4" out of reader-facing text; ~40 B resolves it and keeps `name` for goto, hash and events.
- Faces are swapped by data-face on the row and visibility on the latch's spans, not the hidden attribute. — An author display value would override UA display:none; visibility:hidden also keeps the stacked span in layout for width and out of the accessible name.
- Phone height: .x-latch keeps 2.75rem inside the 40rem block, and CSS:130 raises both radio rows to 2.75rem. — Line 204 shrinks every .x-fig button to 2.5rem; one row must have one height, and raising only .x-steps-seg would leave .x-ctl-segmented at another height for the same pill idiom.
- Deep links focus the figure after scrolling (fig.el.tabIndex = -1 once; focus with preventScroll). — The hash matches no element id, so nothing moved the sequential focus start; a keyboard or screen-reader reader who followed a link began at the top of the document.
- The caption slot reserves one line (min-height 1.5em) and never display:none. — The figcaption no longer jumps on every nudge; a multi-line caption still shifts by its extra lines, accepted.
- The hash stays on the last stepped step after stepping off. — A reload cannot restore a nudged position; the last authored step is the useful landing. (dissent: The first-time reader suggested replaceState back to #fig-x for an honest URL.)
- DESIGN.md edits, beyond the new "Stepper anatomy" table beside "Slider anatomy": the Notice `steps` row (:525) reads "paddles and a latch (buttons), a radio row (segmented), or nothing (states stay addressable)"; the states table gains optional `label`; :828 "stepper buttons or radio row with `aria-live` output" becomes "stepper (paddles, latch, caption, a visually hidden announcer) or radio row"; :867 item 8 becomes "Play, Restart and manual input on a governed control step off; the stepper shows the free face, 'Step through N steps', with an empty caption slot"; the DOM sketch at :947–950 is replaced by this spec's; the Figure object section states that activeState is set only by goto and never computed from the scope; the Slider anatomy table gains an `increment` row ("the `step` key of a continuous slider, the distance one arrow press moves the knob") and its stop row reads `(max - min) / increment <= 40`. — Both verifiers listed passages the spec makes false; :460 already calls the key an increment, so only the anatomy table lags.
- Implementation notes: top-level names must be unique across the bundle (tools/build-runtime.mjs:121 refuses duplicates) and lib/core/state.js already owns `clamp` and `nearest`, so nearestState's helpers stay inside it; both focus handoffs live in stepper.sync() because every step-off reaches the stepper through syncControls(); dev/stepper.html:40 says "paddles" and its &focus=1 selector becomes `.x-stepper .x-latch, .x-stepper input`; the dev page keeps one figure whose defaults match no step so the free face is screenshotted. — Each was a place the earlier spec assumed freedom the code does not give.

## Size estimate
Measured now: `node tools/build-runtime.mjs` → dist/explainers-runtime.v1.js 129,162 B raw, 38,896 B gzip; the ceiling is 40,000 B (test/runtime.test.mjs:326 asserts `<= 40 * 1000`), so headroom is ~1.1 KB, not 2.1. Stylesheet 5.2 KB gzip of 8 KB. Estimate: stepper.js ~2.1 → ~3.6 KB raw (+~0.55 KB gz: latch with two spans and aria-pressed, data-face upkeep, disabled/aria-disabled upkeep, keydown with 4 keys and the modifier check, explicit pointer focus, step-off focus rescue in sync(), announcer with guarded writes and the segmented caption-only branch, two kbd, label ?? name, legend rename); nearestState({name, exact}) in state.js ~0.35 KB raw (+~0.15 KB gz); figure.js (drop :418 and the import, governed set built in goto and tested in set with the cancel scoped, clear in play(), markMounted guard) ~0.25 KB raw (+~0.12 KB gz); boot.js route() focus ~+0.03 KB gz. Total about +0.85 KB gz, landing near 39,750 B; hard cap +1.0 KB measured on the built bundle, checked by the existing test. CSS +~0.6 KB gz (latch stack, pip rule shared with the toggle, dim rules, key hints, caption min-height, 40rem overrides, segmented height), inside its room. Drop order if over: (1) Home/End (~80 B); (2) aria-describedby on the paddles (~50 B); (3) the kbd elements become ::before/::after on the row (~40 B); (4) nearestState replaced by `activeState(compiled, scope) ?? states[0].name`, which keeps exact-match → that step and otherwise starts at step 1 (~150 B; the between-steps backward jump returns, last resort); (5) the governed refinement (~80 B). Per-step pips (~200 B) would need a drop from this list before they could be added.

## Open questions
- Does the owner's noon figure boot with its defaults equal to noon? If so it opens "Step through 3 steps" with no caption until the first press; the opening sentence should move to the figcaption. Confirm this is wanted rather than boot-in-step for that figure.
- The latch is now a bordered pill in both faces and pressing it while stepped steps off (caption empties, figure unchanged). Is that the look and the hand-back the owner wants, or should the stepped face stay plain text with no door out?
- Should stepping off rewrite the hash to #fig-x (honest URL) or keep the last step (useful reload)? Spec says keep.
- Per-step pips as direct access: defer (budget says so today), or make room by dropping Home/End?
- Auto-landing when a drag ends exactly on a step's values: defer, or add on the slider's change event?
- Spinbutton (one tab stop, aria-valuetext on the latch) as a later unification of buttons and segmented modes, now that the latch is always present?
- Raising both radio rows to 2.75rem moves every existing segmented control by 4 px; accept, or keep the stepper's row alone at 2.75rem and live with two heights?

## Verifiers
- accessibility: not ok; problems 11, fixes 11
- runtime-constraints: not ok; problems 12, fixes 12
- design-language: not ok; problems 11, fixes 11