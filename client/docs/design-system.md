# Splitwise Client Design System

This app keeps the current homepage visual language as the baseline system: warm neutral backgrounds, dense dark text, soft green for positive actions, and coral for warning or debt states.

The design system lives in [tailwind.config.js](/Users/mohak/Workspace/splitwise/client/tailwind.config.js). Use Tailwind utilities directly in JSX. Do not create separate component styling in CSS files.

## Tokens

Defined in [tailwind.config.js](/Users/mohak/Workspace/splitwise/client/tailwind.config.js).

### Colors

- `bg-app-bg`: default page background.
- `bg-app-bg-warm`: warmer highlight background used inside gradients or hero areas.
- `text-app-text`: primary body and heading color.
- `text-app-muted`: lower-emphasis body copy.
- `border-app-border`: default border color when opacity modifiers are not enough.
- `bg-surface-base`: white card surface.
- `bg-surface-soft`: sand-tinted secondary surface.
- `bg-surface-inverted`: dark surface for contrast panels.
- `bg-accent-forest` / `text-accent-forest`: primary action and positive emphasis.
- `bg-accent-lime` / `text-accent-lime`: bright supporting accent.
- `bg-accent-coral` / `text-accent-coral`: warning or debt accent.
- `text-status-success`, `text-status-danger`, `text-status-neutral`: semantic balance states.

### Typography

- `font-sans`: `"Avenir Next"` first, then system fallbacks.
- `text-hero`: homepage hero scale with tight tracking for large headlines.
- `tracking-label`: spaced uppercase label styling for section headings.
- `tracking-tag`: slightly tighter version for compact metadata.

### Radius

- `rounded-pill`: chips, filters, compact action buttons.
- `rounded-tile`: small stat tiles inside larger panels.
- `rounded-card`: cards, list rows, and primary buttons.
- `rounded-panel`: large containers and hero shells.

### Elevation

- `shadow-card`: lighter default card shadow.
- `shadow-soft`: heavier spotlight shadow for hero and featured panels.
- `backdrop-blur-chrome`: glass effect for translucent containers.

## Notes

- Use `letterSpacing` in Tailwind config for `tracking-*` utilities. A `tracking` key in the config does not generate classes.
- For non-standard alpha values, prefer bracket syntax such as `bg-white/[0.08]` and `border-white/[0.12]`.
- Keep token names flat and semantic, like `bg-app-bg`, `text-app-muted`, and `bg-accent-lime`.
- The only stylesheet should stay minimal and contain Tailwind directives only.

## Usage Rules

- Default to semantic tokens like `text-app-muted` and `bg-surface-base` instead of raw hex values.
- Use `accent-forest` for the primary CTA and positive money states.
- Use `accent-coral` or `status-danger` for amounts owed, warnings, or destructive actions.
- Reserve `surface-inverted` for compact emphasis blocks, not whole-page backgrounds.
- Keep panels on `rounded-panel`, nested cards on `rounded-card`, and inner stats on `rounded-tile` so the hierarchy stays consistent.
- Build screens with Tailwind utility classes in the component, not custom CSS selectors.

## Example

```jsx
<section className="rounded-panel bg-surface-base p-6 shadow-soft">
  <p className="text-sm uppercase tracking-label text-app-text/45">Group summary</p>
  <h2 className="mt-2 text-2xl font-semibold text-app-text">Apartment crew</h2>
  <button className="mt-6 rounded-card bg-accent-forest px-5 py-3 text-sm font-semibold text-white">
    Add expense
  </button>
</section>
```
