# 13. Pending charges beside the settled spending

Status: accepted

## Context

My bank data is a day or two behind what I spend. Akahu lists a card purchase only once the bank has settled it, and a purchase can stay pending for several days. On 16 October the briefing said I had spent nothing the day before, and my bank app showed four pending charges. A fortnight meter that misses them is not much use for the thing I built it for, which is seeing how I am tracking against my spending target.

Akahu serves pending charges from a separate endpoint. Its documentation says they have no id, no category and less detail than settled ones, that they are not stable (the date or description can change), and that the local copy should be rebuilt on every fetch.

## Decision

- **A separate table, replaced whole on every sync.** `pending_transactions` holds a date, an amount, a type, a category and when it was fetched. Nothing is matched against the settled transactions: a charge that settles drops out of this table and appears in that one. This avoids any matching on data Akahu says changes.
- **The description is stored masked and used only for my rules.** A pending charge has no category, so my own rules are applied to it (longest pattern wins, no model) to keep rent and bills out of the estimate. The text is masked and cut to 300 characters before it is stored, it is never shown or sent anywhere, and the dashboard role has a column grant that leaves it out.
- **Four fields, never `meta`.** The client reads the date, description, amount and type. `meta` can hold account numbers and is not parsed, as for settled transactions. The response is capped at 1,000 items.
- **An estimate, shown beside the settled figure.** The briefing and the dashboard lead with settled plus pending, worded as "about", and write the split out. The settled figure is never changed by it.
- **Alerts and the payday plan stay on settled spending.** Pending numbers can change, and an alert cannot be taken back. The plan suggests transfers, so it should not move on unstable numbers.
- **A stale list is left out.** If the pending list is older than 26 hours, because the fetch has been failing, it is not shown. A failed fetch is logged and leaves the old rows, and never fails the sync.

## Alternatives I did not take

- **Storing pending charges in the transactions table.** It needs matching a pending charge to its settled copy with no shared id, on data that changes. A wrong match counts a charge twice or loses one.
- **Counting pending charges in the alerts and the plan.** More current, but a charge that disappears or changes after an alert has already gone out cannot be recalled.
- **Storing only the amount.** Simpler and no outside text at all, but rent and transfers would count as spending until they settle, and one large pending charge could swing the meter.
- **Letting the model categorise pending charges.** It would send unstable text to the API for a number that is only an estimate.

## Consequences

- The estimate can run high. A pending charge no rule matches counts as spending, so a payment that Haiku would later categorise as a transfer is included until it settles. A card hold, such as a pump authorisation, can vanish and was never spending.
- I have not proved that Akahu never lists a charge as pending and settled at the same time. I checked the four charges I had once and none matched a settled one.
- A new outside input exists: the pending response. It is validated with zod, capped and timed out, and covered by section E of the [threat model](../threat-model.md).
- The dashboard role has a column grant on one more table, and a test runs the meter's pending query as that role, because a query that reads the description would work as me and fail there.
