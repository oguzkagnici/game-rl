# Dara, learned by self-play

An AlphaZero-style reinforcement-learning setup for [Dara](https://en.wikipedia.org/wiki/Dara_(game)),
the three-in-a-row game from Nigeria and Niger. A small neural network starts from random play and
improves only by playing against itself. No human games, no hand-written strategy.

## Play against it

- **In the browser:** open `web/dist/dara-standalone.html` (everything, including the network, is in that one file).
- **In a terminal:** `python play.py` (add `--second` to let the model start, `--sims 1600` to make it think harder).

## Rules implemented

Sources differ on details, so this is the exact ruleset the model was trained on:

- 5×6 board, 12 stones each. **Drop phase:** alternate placing stones on empty pits; no three in a row may be
  formed while dropping (the Niger rule).
- **Move phase:** alternate sliding one stone one pit orthogonally.
- A slide that makes **exactly three** in a row or column captures one enemy stone. Diagonals don't count.
  Enemy stones inside a three are protected unless all of them are. One capture per move.
- Four or more in a row is illegal.
- You lose with fewer than three stones or with no legal move.
- Added for training (traditional play has no such limit): after 200 actions the side with more stones wins;
  equal stones is a draw.

## How it works

```
        ┌────────────── self-play (256 games at once) ──────────────┐
        │  each move: MCTS guided by the current network             │
        │  record (position, search's move distribution, who won)    │
        └───────────────┬────────────────────────────────────────────┘
                        ▼
              replay buffer (recent positions)
                        ▼
        train network: policy → search distribution, value → result
                        ▼
               new network, back to self-play
```

| File | What it is |
| --- | --- |
| `dara/engine.cpp` | Rules and a batched PUCT tree search in C++. It never calls a network itself: `collect()` gathers one leaf per game into a batch, Python evaluates the batch, `apply()` expands and backs up. |
| `dara/engine.py` | ctypes wrapper (`Pool`), text notation, and the network-free heuristic evaluator used as a baseline. |
| `dara/model.py` | The network: 6 residual blocks × 64 channels over 10 input planes; policy head with 6 planes (drop / slide N,S,W,E / capture) = 180 actions; scalar value head. |
| `train.py` | The loop: self-play → train → evaluate → checkpoint. Resumes automatically. |
| `dara/arena.py` | Matches between agents (network, heuristic search, scripted, random). |
| `web/` | JavaScript port of the rules, search and network, plus the page that plays it. |
| `tests/` | Engine vs. a slow reference implementation; JS port vs. C++ and PyTorch; headless-browser run of the page. |

Details worth knowing:

- **Capture is its own action**, so the same player sometimes acts twice in a row. The search tracks who is
  to move at every node instead of assuming strict alternation.
- **Playout-cap randomisation** (from KataGo): 75% of self-play moves use a cheap 40-simulation search just to
  advance the game; 25% get a full 200-simulation search with exploration noise. Only full searches become policy
  targets; every position is a value target.
- **Value target** mixes the final result (70%) with the search's own root value (30%) to reduce noise.
- **Symmetry:** the board has 4 reflections; three quarters of every training batch is reflected.

## Results

One run: 3.0 hours on 4 CPU cores (no GPU), 51 iterations, 11,536 self-play games, 1.02 million positions.
Raw numbers are in `runs/main/log.jsonl` and `runs/main/ladder.jsonl`.

**Against fixed opponents during training** (network searching 100 simulations per move, 32 games per
opponent, score = wins + half of draws):

| Opponent | Start (iter 1) | 15 min (iter 3) | 1 hour (iter 15) | 3 hours (iter 51) |
| --- | --- | --- | --- | --- |
| Scripted bot that makes a three whenever it can | 50% | 97% | 100% | 100% |
| Search with a hand-written evaluator, 200 simulations | 19% | 86% | 100% | 100% |
| Search with a hand-written evaluator, 2,000 simulations | 5% | 50% | 100% | 100% |

**Final network against other opponents** (`python ladder.py`, network at 200 simulations):

| Opponent | Wins–losses–draws | Score |
| --- | --- | --- |
| Its own checkpoint at iteration 5 (0.4 h) | 48–0–0 | 100% |
| Its own checkpoint at iteration 10 (0.7 h) | 47–1–0 | 98% |
| Its own checkpoint at iteration 20 (1.2 h) | 41–4–3 | 89% |
| Its own checkpoint at iteration 30 (1.8 h) | 31–8–9 | 74% |
| Hand-written evaluator search, 5,000 simulations | 16–0–0 | 100% |
| Hand-written evaluator search, 2,000 simulations, **network using no search** (policy head's top move only) | 31–1–0 | 97% |

The network was still improving when the run stopped (74% against itself from an hour earlier), so more
training would make it stronger; `python train.py --hours N` continues from where it left off.

**Against outside bots** (network at 300 simulations per move, always moving first because both games give the human that seat):

| Opponent | Games | Result |
| --- | --- | --- |
| [arcadiagames.io Dara](https://arcadiagames.io/games/dara) bot (`node web/vs_arcadia.js`) | 12 | 12 wins, 0 losses; the network never lost a stone. 11 games ended with the bot unable to move. |
| [Daka Dara](https://fib.itch.io/daka-dara) built-in AI, Classic mode (`node web/vs_dakadara.js`) | 20 | 15 wins declared by the game, 0 losses, 4 stopped with the AI blockaded, 1 abandoned at 10 stones to 7 |

Daka Dara has no blockade rule (a blocked side passes), so the four blockades are not wins under its rules; the
network was trained with "no legal move = loss" and does not know how to finish such a game. The abandoned game hit
a fault in the game itself (a captured stone stayed in its internal board). Daka Dara is a Windows game; its web
core was run in headless Chromium, see the header of `web/vs_dakadara.js`.

**AlphaZero vs PPO vs DQN** (`python baselines.py dqn|ppo --hours 1.5`, then `python compare.py tournament`).
PPO and DQN use the same network body and environment but no search, and trained for 1.5 hours on 2 cores each
(3 core-hours against AlphaZero's 12, so this is not an equal-budget comparison). 32 games per pairing, first 4
actions random, score of the row player against the column player:

| | AZ + search | AZ | PPO + search | PPO | DQN | Scripted | Random |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AlphaZero + search (200) | · | 89% | 97% | 100% | 100% | 100% | 100% |
| AlphaZero, no search | 11% | · | 59% | 100% | 100% | 100% | 100% |
| PPO + search (200) | 3% | 41% | · | 97% | 100% | 100% | 100% |
| PPO | 0% | 0% | 3% | · | 75% | 100% | 100% |
| DQN | 0% | 0% | 0% | 25% | · | 91% | 100% |
| Scripted bot | 0% | 0% | 0% | 0% | 9% | · | 100% |

`python web/build_story.py` turns all of these result files into the learning-curve page `web/dist/story.html`.

Not measured: strength against human players. There is no rated Dara engine or human benchmark to compare with.

## Reproduce

```bash
pip install torch numpy          # plus g++ and, for the web tests, node
python tests/test_engine.py      # rules check
python train.py --hours 3        # writes runs/main/; rerun to continue training
python web/build.py              # rebuild the browser page from runs/main/latest.pt
python play.py
```

The engine compiles itself on first import (`g++ -O3 -march=native -fopenmp`).
