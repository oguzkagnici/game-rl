# Rebellion Field Manual

An unofficial, interactive guide for learning the board game *Star Wars: Rebellion* (base game).
Everything is a self-contained page with no build step to view it.

| Page | What it is |
| --- | --- |
| `index.html` | The Field Manual: the clock, the shape of a round, leaders as actions, playbooks, a decision trainer, a first-game companion and common rules mistakes. |
| `sparring.html` | The Sparring Drill: play a short coached match against a bot, as either side. |

## Field Manual

- **The clock**: why every Rebel reputation point is one round the Empire loses (interactive time track).
- **Shape of a round**: Assignment, Command and Refresh, each step with the rule and what to think about.
- **Leaders are actions**: a leader-budget planner, the pinning rule, and tempo ("the last word").
- **Playbooks** for both sides, plus a chart of why probe droids alone can't find the base in time.
- **Decision trainer**: nine situations per side, answered by a scripted opponent, each ending in a principle.
- **First-game companion**: per-round checklists and clock tracking to keep open next to the real board.
- **Pitfalls**: fourteen rules new players commonly get wrong.

`guide.html` is the same page without the document skeleton (the form the artifact viewer expects);
`index.html` is generated from it by wrapping it in `<!doctype html>…`.

## Sparring Drill

A small original two-player game that keeps Rebellion's strategic core and drops the rest: one side
hides a base and runs a time/reputation clock, the other hunts it with probe cards and troop landings.
Leaders are actions, missions can be opposed (the opposer wins ties), leaders pin their own units, units
leaving the base leak its location, and the base can relocate before the net closes. The clock starts at
time 1 and reputation 14, the same gap as Rebellion.

You play against a scripted bot. A coach steps in the first time each idea comes up (19 lessons, each
ending with how it carries over to the real game), warns before moves that leak or lose, and can show
what a veteran would do in your position, with the reason. A match takes about 15 minutes.

**Why it is not a digital Rebellion.** Rebellion is a commercial game, so the drill does not reproduce
its board, cards, characters or components. It uses an invented 20-system map, invented leaders and a
handful of simplified missions and objectives. The *Carry-over* table on the page lists how each drill
mechanic maps to the real game and what was left out (Death Star, action and tactic cards, unit types,
build queue, retreat, rescue).

**Why scripted bots and not AlphaZero like the rest of this repo.** The drill has hidden information
on both sides (base location, objectives, face-down missions) and a turn made of many small choices.
More importantly, the bot here exists to teach: it scores options with the same ideas the coach
explains and shows its reasoning in the log, which a trained network can't do. Self-play was still
useful for tuning: `drill/selfplay.js` plays bot-against-bot games, which set the starting reputation
and probe rate.

```
node drill/selfplay.js 500                    # veteran vs veteran
node drill/selfplay.js 400 recruit veteran    # Insurgents at recruit level
```

Current numbers (500 games, veteran vs veteran): Insurgents win 58%, games last 7–9 rounds, about one
relocation and 3.7 objectives per game.

### Files

```
drill/engine.js    rules, hidden-information views, what the hunter can deduce (works in Node and the browser)
drill/bots.js      both scripted opponents; the coach's suggestions use the same functions
drill/lessons.js   coach lessons and their triggers
drill/app.js       page controller: map, rail, records, bot pacing
drill/page.html    page template (styles and markup)
drill/build.py     inlines the scripts: writes sparring.html (full document) and sparring-artifact.html (artifact form)
drill/selfplay.js  bot-vs-bot balance runs
```

After editing anything under `drill/`, run `python3 drill/build.py`.

Rules follow the Learn to Play booklet by Fantasy Flight Games. Star Wars: Rebellion is © Fantasy
Flight Games and Lucasfilm Ltd.; this project is not affiliated with either.
