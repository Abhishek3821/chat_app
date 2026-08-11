# Soft-UI theme (neumorphic / skeuomorphic)

Two files, portable to any Tailwind v3 project:

| File | What it is |
|---|---|
| `soft-ui.css` | CSS variables (light + dark + 6 accents) and the `.neu-*` / surface classes |
| `soft-ui.preset.js` | Tailwind preset: colour tokens, shadows, radii, fonts, animations |

**They are two halves of one thing.** The preset's tokens (`bg-surface`, `shadow-soft`,
`bg-brand-gradient`) resolve through variables the CSS defines, so neither works alone.

Verified: compiles standalone with Tailwind 3.4 — 33 KB output, all classes, both
themes, all six accents.

---

## Install

```bash
npm i -D tailwindcss@^3.4 postcss autoprefixer
```

Copy the `theme/` folder into your project, then:

```js
// tailwind.config.js
module.exports = {
  presets: [require('./theme/soft-ui.preset.js')],
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
};
```

```css
/* your entry CSS — the import MUST come after the directives */
@tailwind base;
@tailwind components;
@tailwind utilities;
@import './theme/soft-ui.css';
```

> Vite handles that `@import` natively. With the plain PostCSS CLI you need
> `postcss-import`, or just paste the file's contents in place of the import.

Font (the preset expects it — swap the family in the preset if you'd rather not):

```html
<link rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap">
```

Then on `<html>`: `class="dark"` for dark mode, `data-accent="violet"` for an accent
(omit for the teal default).

---

## The whole idea in one line

Three states, one overhead light source:

```html
<div class="neu-raised bg-surface rounded-2xl p-4">extruded — cards, chips, panels</div>
<input class="neu-inset bg-surface-2 rounded-2xl px-4 py-3" />   <!-- pressed in — inputs, wells -->
<button class="neu-raised-sm neu-press bg-surface rounded-full p-3">sinks when held</button>
```

The trick that makes it read as one system: **nothing hard-codes a shadow.** Every
recipe derives from the same `--neu-*` variables, so dark mode and every accent
re-derive automatically instead of drifting per component.

## Cheat sheet

**Depth** · `neu-raised` `neu-raised-sm` `neu-raised-lg` · `neu-inset` `neu-inset-sm` ·
`neu-press` (sinks on click) · `neu-hover` (lifts on hover) · `neu-fill` (wash only) ·
`neu-on-accent` (for things sitting on a coloured fill)

**Surfaces** · `card` / `panel` (rounded + bordered + raised) · `panel-quiet` (flatter,
for dense lists) · `popover` (menus, modals, dropdowns) · `rail` + `rail-top` /
`rail-bottom` (full-height sidebars and headers)

**Accent** · `btn-accent` (glossy primary button) · `bg-brand-gradient` · `accent-text` ·
`ring-brand` (keyboard-only focus ring)

**Colour tokens** · `bg-surface` `bg-surface-2` `text-content` `text-content-muted`
`border-border` `bg-brand-500` … `text-brand-600 dark:text-brand-300`

**Extras** · `lit-canvas` (ambient page lighting) · `shimmer` (skeletons) ·
`scrollbar-thin` `no-scrollbar` · `pb-safe` `pt-safe` (iOS safe areas) ·
`shadow-soft` `shadow-soft-lg` `shadow-glow` `shadow-glow-lg`

## Recipes

```html
<!-- Selected vs unselected: depth carries the state, not just colour -->
<button class="neu-raised-sm neu-press bg-surface rounded-full px-4 py-2">Inactive</button>
<button class="bg-brand-gradient shadow-glow-lg rounded-full px-4 py-2 text-white">Active</button>

<!-- A toggle: recessed groove + raised knob. The most convincing single element. -->
<span class="neu-inset-sm relative h-6 w-11 rounded-full bg-surface-2">
  <span class="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-gradient-to-b
               from-white to-brand-50 shadow-glow-lg"></span>
</span>

<!-- Skeleton: a hole in the surface, not a grey block on top of it -->
<div class="shimmer neu-inset-sm h-4 w-40 rounded-lg bg-surface-2"></div>

<!-- Icon badge: press the icon into the panel -->
<span class="neu-inset grid h-10 w-10 place-items-center rounded-xl
             text-brand-600 dark:text-brand-300"><svg/></span>
```

---

## Five traps (all of these bit the source project)

**1. `neu-press` animates `transform`.** Never put it on an element that already has
a transform utility (`-translate-x-1/2`) or a framer-motion `whileTap` — transform is
replaced, not composed, so the element jumps sideways on click.

**2. `@layer components` classes are tree-shaken.** `card`, `neu-raised`, `btn-accent`
etc. are only emitted if Tailwind sees them in your `content` files. A class assembled
at runtime (`` `neu-${size}` ``) will silently not exist. Write full class names.

**3. `--accent-fill-2` must be a *deeper* ramp step, never lighter.** White text sits on
accent fills, so the far end of the gradient has to gain contrast. The
`[data-accent]` correction block near the bottom of the CSS exists for exactly this —
the warmer ramps (amber, cyan, emerald, rose) peak higher and fall under 4.5:1 at the
default step, so each drops one step. Don't delete it without re-checking contrast.

**4. `lit-canvas` belongs on a non-scrolling wrapper.** As the background of a scroll
container, its two large radial gradients repaint on every scroll frame.

**5. Don't remap Tailwind's built-in colours.** The source project pointed `cyan` at its
teal palette, and a "blue" read-receipt tick written as `text-cyan-200` rendered mint —
so a state change became invisible. The preset deliberately doesn't carry that over.
Keep `cyan` meaning cyan; put brand colours on `brand-*`.

## Making it yours

- **Different brand colour** — replace the ten `--brand-*` values in `:root`. Everything
  (buttons, active states, focus rings, the accent bloom) follows.
- **Softer or harder depth** — raise `--neu-lo-a` for deeper shadows, `--neu-hi-a` for a
  stronger highlight. These are the two dials that change the entire feel.
- **Flatter look** — drop `--neu-fill-hi-a` / `--neu-fill-lo-a` toward `0` to remove the
  extrusion wash while keeping the shadows.
- **Light-only or dark-only** — delete the `.dark` block (or the `:root` values and
  promote `.dark`'s). Everything else keeps working.
