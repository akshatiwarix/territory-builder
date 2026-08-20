# Territory Builder — how it works, in plain English

No code in this one. If you have ever been handed a territory plan and had to defend it to the people it took accounts away from, this is written for you.

## The problem, in one paragraph

Every year someone divides the account list among the reps and puts a number on a slide: *balanced to within 4%*. Nobody can check that number, nobody knows what it cost to get there, and nobody knows whether 4% was hard or free. This tool exists to print the three or four numbers that go missing when that slide gets made.

## 1. A territory plan is not an assignment, it is a change

There is always a book on the ground. Every account that moves takes something with it: a relationship the rep built over two years, a deal that was about to close, context that does not transfer through a CRM record.

So this tool never shows you a carve on its own. It shows you the **diff** — who loses what, and specifically how much **open pipeline changes hands mid-deal**. On the demo data, the default plan moves 1,337 accounts and $4.47M of live pipeline.

Why dollars rather than accounts? Because moving four hundred accounts nobody has called in a year is nearly free, and moving one account in late-stage negotiation is not. A tool that counts accounts will happily trade the second for the first, and that is precisely how a territory plan gets overruled in the room.

## 2. Some of the imbalance was never available

Here is the part every commercial tool leaves out.

Territories are built by handing out **groups** of accounts, not individual accounts — because a territory has to be describable ("you own Manufacturing in the West"), not a list of 240 account IDs that nobody can maintain. And a group cannot be split down the middle.

So if one group is very large, somebody has to take it whole, and that person's book is bigger than everyone else's no matter how clever your software is. That excess is a property of your account list. It is not the tool's failure, and chasing it wastes real churn on something that was never reachable.

The tool computes that unreachable amount up front, by arithmetic, before it tries anything. Then it reports **three numbers instead of two**:

- **the floor** — proven unreachable below this
- **what the plan achieved**
- **the gap between them, labelled unknown**

On the demo data the potential floor is 6.7% and the plan achieves 6.7%. There is nothing left to optimize; that residual is your account list.

The word "unknown" is deliberate. The tool does not know whether a better plan exists in that gap. Calling it "near-optimal" would be inventing a claim it cannot support.

## 3. Some of it is your own rules, and the tool says which

Constraints have prices. "Never move an account with a deal past negotiation" is an entirely sensible rule, and on the demo data it single-handedly forces **51.5%** pipeline imbalance — one rep is mid-quarter with an outsized share of the open deals, and the rule freezes them in place.

The tool computes the floor again with each rule switched off and reports the difference. So you can say, out loud, in the room: *"protection is costing us fifty-one points of pipeline imbalance and we chose that on purpose"* — instead of finding out in a hallway six weeks later.

A rule can also cost **nothing**. If your account list was already forcing that much residual, the rule is not charged for it. Saying so is more useful than billing a constraint for something it did not do.

## 4. Readable rules and balanced books pull against each other

This is the tradeoff nobody names, and the tool makes you look at it.

You choose how finely to cut. Cut only by industry, and every rep gets a one-line territory they can recite from memory — and the best possible plan is **107% imbalanced**. Cut by industry, region, segment and company size, and you can balance perfectly — with a thirty-two-line rule nobody will ever read, let alone maintain when new accounts arrive.

| how you cut | rule length | best possible imbalance |
|---|---|---|
| industry | 1 line | 107% |
| + region | 4 lines | 26% |
| + segment | 11 lines | 6.7% |
| + company size | 32 lines | 0% |

Neither end is right. The point is that this is a *choice*, and it should be made by a person who can see both columns.

## 5. You are balancing on an estimate, so the answer is a range

Nobody balances on revenue. You balance on *estimated* potential — a model's guess, with error bars that never make it onto the slide.

So the tool wobbles every estimate inside its own stated error and re-scores the plan two hundred times. That 6.7% turns out to be anywhere from **4.4% to 14.0%**.

Then it does the harder version: it re-runs the whole plan sixty-four times under those wobbles and checks how many accounts keep the same owner. The answer is **39%**.

Read that again. Move the estimates around inside the error the vendor already admits to, and six accounts in ten end up with a different rep. The plan on the screen is one sample from a distribution of plans, and every tool in this category reports the single sample with a straight face.

There is a related number: how often the *same rep* is the one carrying too much. At the default setting, 59% of the time. So the sentence "this rep is overloaded" is not yet a finding.

**And it gets stranger.** The finer you cut, the *worse* the stability. Cut coarsely and the plan is forced — there is only one sensible answer, and it reproduces 100% of the time. Cut finely and everything is reachable, so nothing forces the choice between one plan and another, and re-running gives you a different plan. Balance and reproducibility pull against each other, and that only shows up if you look.

## 6. Some churn was never optional either

Building this turned up something I had assumed away.

The existing book was carved by geography years ago, and then split between two reps per region by nothing in particular. That means no *rule* can reproduce it — some groups contain accounts belonging to different reps, and a group goes to one rep.

So before the tool expresses a single preference, before any balance is bought, **11% of all open pipeline has already changed hands**. That is the price of moving to a rule-based territory model at all, and it has nothing to do with the plan you chose.

## 7. It refuses rather than quietly ignoring you

Ask for something the model cannot honour — "rep-05 never sells Enterprise" when you are cutting only by industry — and it stops and tells you which control to change.

The first version of this code did the normal thing and ignored it. A test caught 56 plans handing Enterprise accounts to reps forbidden from selling to them. A rule you set that quietly did nothing is worse than an error message, because you will find out from the CRM instead of from the plan.

## What it will not tell you

- Whether the plan is optimal. It has a floor, a result, and an honest gap.
- Whether the relationship-equity weighting is right. It is made up, it is stated where you can see it, and you are meant to disagree with it.
- A single "balance score". The objectives genuinely conflict, and collapsing them would be choosing on your behalf and hiding it.

## Try it

**[territory-builder-akshat-tiwarix.vercel.app](https://territory-builder-akshat-tiwarix.vercel.app)** — opens on a plan, nothing to sign up for. Drag the weights and watch the frontier; drop the granularity to L1 and watch the floor explode; turn late-stage protection off and watch what it was costing.
