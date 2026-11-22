# Toy Battle, learned by self-play

One neural network that plays [Toy Battle](https://www.rprod.com/en/games/toy-battle) (Paolo Mori &
Alessandro Zucchini, Repos Production 2025) on all 8 terrains, trained from scratch by playing against
itself. Same recipe as the Dara project next door (`../dara`): tree search guided by a policy/value
network, with the network trained on the search's results.

```bash
pip install torch numpy            # plus g++
python tests/test_engine.py        # rules checks
python train.py --hours 6          # writes runs/main/; rerun to continue
```

## What is different from Dara

| | Dara | Toy Battle |
| --- | --- | --- |
| Board | one 5×6 grid | 8 different graphs of 12–15 bases |
| Hidden information | none | the opponent's rack, both reserves |
| Chance | none | every draw, XB-42, the Battlefield sniper |
| Network | ResNet over the grid | graph transformer over the bases, shared by all terrains |

**Hidden information and chance.** The network only ever sees what the player to move may know: the
board and every stack, its own rack, both discards, how many tiles each side holds, and which tiles of
each side have not been seen yet. Before a search, the engine deals the opponent a random rack from the
tiles the searching player cannot see, runs an ordinary search in that fully known world, and repeats
this for several deals; the move statistics are added up. Inside one deal, draws are fixed in advance.
This is the "determinization" approach to card-like games. Its known weakness is that within one deal
the search plays as if both sides could see everything, so it undervalues bluffing and hiding.

**One network for all terrains.** Each base is one token with features (who holds it, the stack, whether
it is connected to either H.Q., distance to both H.Q., medals at stake, which troops may go there), plus
one token for everything global. Bases have no position number; instead, attention gets a learned
bonus between bases joined by a path and between bases around the same region. Features are always from
the point of view of the player to move, so both colours and the mirrored halves of a terrain share
everything.

## Play against it

Open `web/dist/toybattle-standalone.html` in a browser (everything, including the network, is in that one
file). Pick a terrain, your colour, who starts and how long the model may think. The page runs a
JavaScript port of the engine, search and network (`web/toybattle.js`); `python web/build.py` rebuilds it
from `runs/main/latest.pt`. The model does not see your rack: it re-deals the tiles it cannot see before
every search, exactly as in training.

## Rules implemented

From the official rulebook and player aid. Troop = strength: Kwak (joker), Skully 1, Cap'n 2, Jumbo 3,
Hook 4, XB-42 5, Star 6, Roxy 7; three of each per player, 4 removed unseen, starting racks 3 and 4.

- Turn: draw 2 (rack limit 8), or place 1 troop, apply its effect, then the special base's effect.
- Placement: empty base, own base, or an enemy troop of strictly lower strength; the base must be
  linked to your H.Q. through bases you occupy. Only the top troop of a stack counts.
- Win: place a troop on the enemy H.Q., or reach the terrain's medal objective. A player who can
  neither draw nor place ends the game: most medals wins, the stuck player loses a tie.
- Regions: occupy every base around a region to take its medals for good.

Where the rulebook leaves room, this engine decides as follows:

| Question | Decision |
| --- | --- |
| "You may" effects | Effects with a target (Cap'n, Jumbo, Castle Field, Volcanic Jungle, Cursed Cemetery) can be skipped. Effects without one (Skully, Star, XB-42, City of Clouds, Battlefield) always happen. |
| Kwak on Tropical Pool gates | Allowed (the gates show the duck). |
| Hook on Station Metal-X special bases | Needs a normal connection: its jump is an effect, and effects are off there. |
| Volcanic Jungle move | The moved troop may land on any adjacent base, on top of whatever is there. |
| Battlefield | The pinned troop is chosen at random; one troop at a time. |
| Both players complete a region at once | The player to move is served first. |
| Castle Field loops | A game is stopped after 200 turns: most medals wins, else a draw. |
| Stacks | At most 12 tiles on a base. |

## Where the maps come from

`toybattle/terrains.py` holds the 8 terrains as graphs (bases, paths, H.Q., regions and medals). They were
taken from the transcription in [zorgluf/GrosBill, pull request 23](https://github.com/zorgluf/GrosBill/pull/23),
not read off the boards here. That project notes that the medal counts for **Volcanic Jungle** and
**Caribbean Sea** come from a third-party source and should be checked against the physical boards.
No board art is used.

## Files

```
toybattle/terrains.py   the 8 terrains
toybattle/engine.cpp    rules, features, batched search over several deals
toybattle/engine.py     Python wrapper, hand-written evaluator
toybattle/model.py      the network
toybattle/arena.py      matches between agents, spread evenly over terrains, colours and first move
train.py                self-play training loop
ladder.py               newest checkpoint against earlier ones
web/toybattle.js        JavaScript port of rules, features, search and network
web/template.html       the playable page; web/build.py and web/export.py assemble it
tests/test_engine.py    rules checks
tests/test_web.py       JavaScript port against the C++ engine and PyTorch, position by position
tests/browser_*.js      headless-browser runs of the page on all 8 terrains
```

## Results

One run: 6.3 hours on 4 CPU cores (no GPU), 128 rounds, about 75,000 self-play games, 2.48 million
positions. Raw numbers: `runs/main/log.jsonl`, `runs/main/ladder.jsonl`. The final network is
`runs/main/latest.pt` (round 128).

**Against fixed opponents during training.** Every third round the network (searching 4 deals × 40
simulations) plays 64 games, 8 per terrain, against each of:

- a scripted bot that looks one move ahead (wins if it can, else best medal balance, most bases, shortest way to the enemy H.Q.),
- the same search with a hand-written evaluation instead of a network, at 4 × 200 and 4 × 800 simulations.

For scale, the baselines among themselves: scripted bot vs random 256–0; hand-written search 4 × 200 vs
scripted bot 39–25; 4 × 800 vs scripted bot 53–11.

| Round | Hours | Scripted bot | Hand-written search 4 × 200 | Hand-written search 4 × 800 | Network alone (no search) vs scripted bot |
| --- | --- | --- | --- | --- | --- |
| 1 | 0.05 | 23% | 36% | 14% | 0% |
| 3 | 0.15 | 77% | 73% | 72% | 41% |
| 6 | 0.3 | 97% | 95% | 92% | 69% |
| 12 | 0.5 | 97% | 97% | 94% | 95% |
| 24 | 1.0 | 100% | 98% | 98% | 98% |
| 36 | 1.5 | 100% | 100% | 100% | 100% |
| 93 | 4.4 | 100% | 100% | 100% | 98% |
| 126 | 6.2 | 100% | 100% | 98% | 100% |

These opponents stop being informative after about round 9.

**Against its own earlier checkpoints** (`python ladder.py --new 125 --vs 90 110 55 --games 256`; 128 games per row for round 55, 256 for the others; both sides
search 4 deals × 40 simulations; games spread evenly over the 8 terrains, colours and first move):

| Newer | Older | Wins–losses | Score |
| --- | --- | --- | --- |
| Round 55 | Round 5 | 115–13 | 90% |
| Round 55 | Round 15 | 97–31 | 76% |
| Round 55 | Round 25 | 85–43 | 66% |
| Round 55 | Round 35 | 65–63 | 51% |
| Round 55 | Round 45 | 69–59 | 54% |
| Round 90 | Round 35 | 174–82 | 68% |
| Round 90 | Round 55 | 159–97 | 62% |
| Round 90 | Round 75 | 143–113 | 56% |
| Round 125 | Round 55 | 166–90 | 65% |
| Round 125 | Round 90 | 139–117 | 54% |
| Round 125 | Round 110 | 122–134 | 48% |

Progress flattened between rounds 35 and 55 with the default settings (learning rate 0.001, full search
4 × 50). From round 58 the run used `--lr 3e-4 --full-sims 100 --fast-sims 30`, after which it improved
again up to about round 90–110. Round 125 is no better than round 110 and only slightly ahead of round 90
(54%, within the ±6 point margin of 256 games), so this network size and search budget have probably given
most of what they can. Per-terrain results are in `ladder.jsonl`; at 16–32 games per terrain they vary from
match to match and no terrain is consistently weak.

In self-play the first player wins about 50% of games and Blue about 50%.

Not measured: strength against human players or against any outside Toy Battle program.

## Experiments after the first model

All matches: 256 games spread over the 8 terrains, both sides searching 4 deals × 40 simulations unless
stated; about ±6 points of noise. "Current model" is `runs/main/latest.pt` (96×4 network, round 128).
Raw results are in `runs/league.jsonl`, `runs/main/search_test.jsonl` and `runs/main/belief_test.jsonl`.

### More search (`search_test.py`)

| Stronger side searches | Score vs 4 × 40 (128 games) |
|---|---|
| 4 deals × 160 simulations | 52% |
| 16 deals × 40 simulations | 55% |

Four times the search buys almost nothing, so search depth is not the limit.

### Hidden information (`toybattle/belief.py`, `match.py --a-belief / --a-oracle`)

The plain search re-deals the opponent's rack uniformly at random.  Two alternatives, same network:

| Deals come from | Score vs plain search | Tiles wrong per guess |
|---|---|---|
| uniform re-deals (plain) | 50% | 2.3 |
| belief, 64 particles, 10% uniform, temperature 2 | 60% | 1.3 |
| belief, 128 particles, 5% uniform, temperature 2 | 64% | 1.1 |
| belief, 128 particles, 0% uniform, temperature 3 | 64% | 0.9 |
| the opponent's true rack (oracle: a cheat, the ceiling) | 67% | 0 |

The belief is a particle filter: after each opponent action every particle (a possible rack) is weighted by
the policy network's probability of that action from that rack, follows the action with its hidden draws
sampled, and the set is resampled.  No retraining is needed.  It recovers most of what perfect knowledge of
the rack would give.

### Larger network (`runs/big`, 128×6, 864k parameters)

Warm-started on the current model's replay buffer, then its own self-play.

| Round | Hours | Score vs current model |
|---|---|---|
| 10 | 1.5 | 38% |
| 18 | 3.1 | 46% |
| 28 | 4.5 | 44% |
| 40 | 6.3 | 49% |

With belief tracking on both sides, round 40 scores 48% against the current model.  At equal training time
the larger network is level with the smaller one, not ahead.
