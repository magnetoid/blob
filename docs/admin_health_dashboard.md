# Admin Health Dashboard

The **Health** page in the instance console is now an interactive operations dashboard.

## What it does

- Refreshes health metrics automatically without a full page reload.
- Uses the existing signed-in WebSocket connection to trigger faster refreshes when live activity happens.
- Lets you choose a refresh interval up to every `2s`.
- Builds a short-term trend history for key metrics:
  - queue depth
  - live sockets
  - people online
  - message count
  - stored files
- Supports drill-down from summary metrics into detailed reports.
- Combines recent logs and audit entries into one activity feed.
- Lets each person:
  - reorder widgets
  - resize widgets
  - hide widgets
  - restore hidden widgets
- Persists dashboard layout in browser storage on the current device.

## How to use it

1. Open `Admin -> Health`.
2. Pick the refresh interval from the toolbar.
3. Click any summary metric card to focus it.
4. Use the trend widget to:
   - switch metrics
   - zoom the time window
   - pan older/newer
   - click a bar to filter the activity feed from that point forward
5. Use **Open detailed report** in the detail widget to jump to the most relevant console page.

## Mobile and touch

- Chart panning supports swipe gestures.
- Dashboard controls use touch-friendly hit targets.
- Widgets collapse to a single-column layout on narrower screens.

## Accessibility

- All interactive chart bars and widget controls are keyboard reachable.
- Toggle states use `aria-pressed` where appropriate.
- The dashboard announces refresh status and the currently focused chart point via live text.

## Validation targets

This implementation supports the requested workflow improvements, but the following still require a real user-testing pass outside the codebase:

- `30%` reduction in time-to-insight
- `25%` increase in dashboard engagement
- cross-browser / cross-device certification of a `100%` pass rate on core scenarios

Those targets should be validated with observed task timings and browser/device test matrices during QA.
