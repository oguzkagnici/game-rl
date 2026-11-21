# game-rl

Board-game agents trained from scratch by self-play, on 4 CPU cores and no GPU. Each game has its own
folder with a rules engine in C++, a training loop in PyTorch, tests, logs and trained weights.

| Folder | Game | Status | Headline result |
| --- | --- | --- | --- |
| [`dara/`](dara/README.md) | [Dara](https://en.wikipedia.org/wiki/Dara_(game)), 5×6 three-in-a-row game | Finished: 3 hours of training | 12–0 against the arcadiagames.io bot; 15 wins, 0 losses in 20 games against Daka Dara's AI |
| [`toy-battle/`](toy-battle/README.md) | [Toy Battle](https://www.rprod.com/en/games/toy-battle), all 8 terrains with one network | Finished: 6.3 hours of training | 98–100% against the scripted bot and hand-written search; 65% against its own checkpoint from 4 hours earlier |
| [`quoridor/`](quoridor/README.md) | Quoridor | Engine and training loop only, never trained | none |

## The approach

All three use the AlphaZero recipe:

1. A network takes a position and outputs a **policy** (how promising each move looks) and a **value**
   (who is likely to win).
2. A tree search (PUCT MCTS) uses the network to look ahead and produces a better move choice than the
   network alone.
3. The agent plays games against itself with that search. The network is then trained to predict the
   search's move choice and the game's final result, and the loop repeats.

The engines run many games at once and never call the network themselves: `collect()` gathers one search
leaf per game into a batch, Python evaluates the batch, `apply()` puts the results back into the trees.

## Algorithms tried

| Algorithm | Where | Outcome |
| --- | --- | --- |
| AlphaZero (search + policy/value network) | `dara/train.py`, `toy-battle/train.py`, `quoridor/train.py` | The main method for every game |
| PPO (policy gradient, self-play, no search) | `dara/baselines.py ppo` | Beats the scripted bot 100%, loses to AlphaZero + search 3% to 97% even when given the same search |
| DQN (Q-learning, self-play, no search) | `dara/baselines.py dqn` | Weakest of the three: 25% against PPO, 0% against AlphaZero |
| Hand-written evaluation inside the same search | `*/engine.py` (`heuristic_evaluator`) | Baseline; the networks pass it within the first 15–30 minutes |
| Scripted one-move-ahead bots, random play | in each engine / arena | Baselines |

PPO and DQN had 3 core-hours each against AlphaZero's 12, so the Dara comparison is not at equal budget.
The full 7-way table is in the [Dara README](dara/README.md#results).

What Toy Battle needed beyond Dara:

- **Hidden information and chance** (racks, draws): the search deals the opponent a random rack from the
  tiles it cannot see, searches that fully known world, and sums the results over several deals.
- **Eight different boards:** a graph transformer with one token per base and no position numbers, so the
  same weights play every terrain.

## Layout of each game folder

```
<game>/engine.cpp     rules + batched tree search
<game>/engine.py      Python wrapper, hand-written evaluator
<game>/model.py       network
<game>/arena.py       matches between agents
train.py              self-play training loop (resumes from runs/main)
ladder.py             newest checkpoint against earlier ones
tests/                rules checks
runs/                 logs, results and checkpoints
```

Dara additionally has `baselines.py` (PPO, DQN), `compare.py` (tournament), `play.py` (terminal play) and
`web/` (a browser port of the engine and network, the playable page, the learning-curve page, and the
drivers used to play the two outside bots).

## Run it

```bash
pip install torch numpy                # plus g++; node + playwright only for dara/web tests and bot drivers
cd dara                                # or toy-battle, quoridor
python tests/test_engine.py
python train.py --hours 3
```

Engines compile themselves on first import. Self-play buffers are not in the repository (hundreds of MB),
so a resumed run starts with the saved network and an empty buffer.

## Sources and limits

- Toy Battle rules come from the publisher's rulebook and player aid. The terrain graphs come from the
  transcription in [zorgluf/GrosBill pull request 23](https://github.com/zorgluf/GrosBill/pull/23)
  (GPL-3.0); the medal counts for Volcanic Jungle and Caribbean Sea are unverified. No game art is included.
  Toy Battle is a commercial game by Repos Production; this is an unofficial research project.
- Dara rule variants differ between sources; the exact ruleset is in the Dara README.
- Nothing here has been measured against human players.
