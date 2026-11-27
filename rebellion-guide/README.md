# Rebellion Field Manual

An unofficial, interactive guide for learning the board game *Star Wars: Rebellion* (base game).
Open `index.html` in a browser; it is a single self-contained page with no build step.

What it covers:

- **The clock**: why every Rebel reputation point is one round the Empire loses (interactive time track).
- **Shape of a round**: Assignment, Command and Refresh, each step with the rule and what to think about.
- **Leaders are actions**: a leader-budget planner, the pinning rule, and tempo ("the last word").
- **Playbooks** for both sides, plus a chart of why probe droids alone can't find the base in time.
- **Decision trainer**: nine situations per side, answered by a scripted opponent, each ending in a principle.
- **First-game companion**: per-round checklists and clock tracking to keep open next to the real board.
- **Pitfalls**: fourteen rules new players commonly get wrong.

`guide.html` is the same page without the document skeleton (the form the artifact viewer expects);
`index.html` is generated from it by wrapping it in `<!doctype html>…`.

## Why there is no playable bot

A playable digital version of Rebellion would be a recreation of a commercial game, so this guide
teaches with scenarios and a companion for the physical game instead. An AlphaZero-style agent like
the others in this repo would also be a poor fit: Rebellion has hidden information on both sides
(base location, objectives, missions, probe cards), card-driven effects and an action space far larger
than Dara or Toy Battle.

Rules follow the Learn to Play booklet by Fantasy Flight Games. Star Wars: Rebellion is © Fantasy
Flight Games and Lucasfilm Ltd.; this project is not affiliated with either.
