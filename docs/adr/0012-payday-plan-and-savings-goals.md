# 12. A payday plan and savings goals

Status: accepted

## Context

[ADR 11](0011-budgets-and-dashboard.md) added a monthly limit per category. What I want is to spend less and save more, and the moment that matters is payday. I am paid fortnightly, on a Tuesday afternoon. I want a message the next morning that says how to split the pay, adjusted by what I really spent over the last fortnight, and I want savings goals to replace the budgets.

## Decision

- **A message at 08:00 NZ on the Wednesday after each pay,** every 14 days from a fixed anchor date. It is sent by the finance service right after the morning sync, so it sees the pay: Akahu stamps it 23:59:59 on pay day and the 00:05 sync has pulled it by then. The date of the last payday it covered is stored, so a restart or a second sync never repeats it, and a failed send is tried again at the next sync. If the pay is not in the data yet, the message says so and still shows the plan.
- **Plain code, no model, and it only suggests.** The numbers are arithmetic, and a model would add a path for text I did not write and a cost per message. Akahu is read-only for me and stays that way, so I make the transfers.
- **The split.** Rent and bills are a fixed amount and never change. Spending is what I spent in the 14 days ending on pay day, leaving out the categories that rent and bills sit in (Housing, Utilities and Insurance), Transfers and Investments. When spending is under my spending target, the difference is added to savings and investments in their usual ratio. When it is over, the message says by how much and shows the plan without the extra. Amounts are whole cents, and any rounding remainder goes to savings.
- **Settings live in the database,** set from the bot with `/payday set`: the pay, the rent and bills amount, the savings and investments amounts and the spending target. None of them is in the repo, an ADR or `.env`.
- **A goal** has a name, a target, an optional date, an amount saved so far that I update by hand with `/goal saved`, and an optional weight. The savings part of the plan is split by weight across the goals that have not reached their target, and a goal stops receiving money when it does.
- **Budgets are removed.** The table, the `/budget` commands, the alerts and the two sections go, and the dashboard role loses its grant on the table. One thing replaces them: a single meter for this fortnight's spending against the target, on the dashboard and in the briefing, with one alert at 80% and one at 100%.
- **The write surface stays small.** Settings and goals can be changed from my private chat only, with strict parsing like `/budget`. There are no MCP tools for them, so the write surface in [ADR 5](0005-finance-privacy.md) does not grow.

## Alternatives I did not take

- **Guessing goal progress from transfers into my savings account.** Transfers are one category that mixes everything I move between accounts, so the guess would often be wrong. Recording it by hand is exact.
- **Filling goals in priority order.** It is simpler, and a goal that never fills would starve the others. Weights default to equal.
- **A model writing the message.** The numbers must be exact, and payee text would reach a model that has a say in my money.
- **Moving the money automatically.** It needs payment access that a personal Akahu app does not give, and a wrong amount would be hard to undo.
- **Keeping budgets beside goals.** Two overlapping ways to say how much to spend, and I would read neither.
- **Settings in `.env`.** A restart for every change, and my pay in a file.
- **A message at 4pm on pay day.** The pay is not in my data until after midnight.

## Consequences

- The message is only as good as the data. If Akahu's refresh fails or times out the pay may not be seen, and the message says so. `/payday` shows the plan again once it is.
- "Saved so far" is what I tell the bot. A goal can drift from my real savings account until I correct it.
- Dropping the `budgets` table deletes the limits I set. The alert state goes with it.
- The pay schedule is an anchor date plus 14 days. If my pay changes, I change the anchor.
- Telegram already sees my totals. It will now also see my pay amount and my goal names, which I accept.
- The [threat model](../threat-model.md) has a new section E for the commands, the arithmetic, the schedule and the page, with the attack tests to run before this is deployed.
