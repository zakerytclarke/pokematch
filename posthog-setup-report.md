<wizard-report>
# PostHog post-wizard report

The wizard has completed a full PostHog analytics integration for PokéMatch — a Pokémon TCG swipe app with a Thompson Sampling recommendation engine. PostHog was initialized via the HTML snippet in `index.html` (placed in `<head>` before any other scripts), and 10 custom events were instrumented across the core user interaction surfaces in `index.js`.

## Events instrumented

| Event name | Description | File |
|---|---|---|
| `pack_opened` | User rips open a booster pack to reveal 10 cards | `index.js` |
| `card_swiped` | User swipes a card with a like, dislike, or superlike action | `index.js` |
| `card_inspected` | User opens the card detail inspector modal to view card info and pricing | `index.js` |
| `card_removed_from_binder` | User removes a card from their binder collection | `index.js` |
| `superlike_toggled` | User toggles a card's super like status inside the binder | `index.js` |
| `swipe_history_reset` | User clears all swipe history and preferences from settings | `index.js` |
| `card_catalog_reset` | User resets the full local card catalog, triggering a re-download | `index.js` |
| `next_pack_started` | User clicks to open the next pack after finishing all 10 cards | `index.js` |
| `binder_filtered` | User applies a filter or search query to their card binder | `index.js` |
| `tcgplayer_link_clicked` | User clicks the TCGPlayer link to view a card's market listing | `index.js` |

## Next steps

We've built a dashboard and insights in PostHog to monitor user behavior:

- [Analytics basics (wizard) dashboard](https://us.posthog.com/project/489390/dashboard/1771191)
- [Card Swipes Over Time](https://us.posthog.com/project/489390/insights/IdDVTLy6) — swipe volume broken down by like/dislike/superlike
- [Packs Opened Over Time](https://us.posthog.com/project/489390/insights/vUcGQvzG) — daily pack opening with pack type breakdown
- [Card Inspection Rate](https://us.posthog.com/project/489390/insights/JFNoztnd) — card inspections vs total swipes (engagement depth)
- [Churn Signals: Collection Resets](https://us.posthog.com/project/489390/insights/YVcOLUiV) — swipe history and catalog resets as frustration indicators
- [Pack Open → Card Swipe → Next Pack](https://us.posthog.com/project/489390/insights/0Ty7qEZs) — core engagement loop volume over time

## Verify before merging

- [ ] Run a full production build (the wizard only verified the files it touched) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST` to `.env.example` and any onboarding documentation so collaborators know what values to set.

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-javascript_web/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
