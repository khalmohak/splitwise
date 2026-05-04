# Splitwise Client Project Rules

These are the default product and implementation rules for this app.

## Product Direction

- This is a frontend-heavy product. The UI should feel closer to a native mobile app than a desktop website.
- Design for mobile browsers first. Desktop is an enhancement layer, not the primary layout target.
- The first usable screen is the login flow. New features should extend from authenticated app screens after that.

## UX Rules

- Build for a phone viewport first, using a baseline around `375px` wide before scaling up.
- Keep each primary screen usable within one viewport on mobile whenever possible.
- Minimize scrolling. If a screen grows tall, compress secondary content before adding more vertical sections.
- Keep one clear primary action per screen.
- Touch targets should be comfortable on phones: aim for at least `44x44px`.
- Form controls should use at least `16px` text on mobile to avoid browser zoom and improve legibility.
- Navigation and actions should feel app-like: clear hierarchy, strong active states, and low cognitive load.

## Responsive Rules

- Start with the mobile layout, then enhance for tablet and desktop with more space, not more complexity.
- Avoid layouts that depend on hover, dense toolbars, or tiny text.
- Desktop should preserve the same flow and interaction model as mobile.

## Performance Rules

- Perceived speed matters as much as raw speed. Screens should feel instant even on average mobile networks.
- Keep bundles lean. Avoid adding dependencies unless they materially reduce complexity or improve UX.
- Prefer local state updates, optimistic UI, and lightweight transitions over blocking spinners.
- Do not ship large images, heavy animations, or unnecessary client-side libraries.

## Caching Rules

- Treat caching as a default behavior for read-heavy data.
- Use stale-while-revalidate patterns for balances, groups, and recent expenses so the UI can render cached data first.
- Persist critical session state and lightweight user data where appropriate so reloads feel fast.
- Never make the user wait on a full refetch if cached data is available and still usable.

## UI System Rules

- Reuse the Tailwind design tokens defined in [tailwind.config.js](/Users/mohak/Workspace/splitwise/client/tailwind.config.js).
- Prefer semantic tokens like `bg-surface-base`, `text-app-muted`, and `bg-accent-forest` over raw values.
- Keep visual hierarchy consistent:
  `rounded-panel` for full containers,
  `rounded-card` for cards and primary controls,
  `rounded-tile` for nested stats and small modules.

## Delivery Rules

- Every new screen should be tested mentally against mobile first:
  Can a user complete the main action quickly with one hand on a phone?
- Default to building the smallest complete version first, then layer detail only if it improves clarity.
- If a feature risks turning a screen into a long dashboard, split it into smaller states or screens instead.
