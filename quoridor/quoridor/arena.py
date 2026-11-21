"""Head-to-head matches between agents, many games in parallel.

An agent is a dict:
    {"kind": "mcts", "evaluator": fn, "sims": 200}   search guided by any evaluator
    {"kind": "greedy"}                               always walks the shortest path
    {"kind": "random"}                               uniform random legal move
"""
import numpy as np

from .engine import MAX_PLY, Pool, heuristic_evaluator


def heuristic_agent(sims=200):
    return {"kind": "mcts", "evaluator": heuristic_evaluator, "sims": sims}


def adjudicate(st):
    """Winner of an unfinished game: whoever is ahead in the shortest-path race."""
    margin = st["dist1"] - st["dist0"] + (0.5 if st["turn"] == 0 else -0.5)
    return 0 if margin > 0 else 1


def play_match(a, b, games=32, seed=0, opening_plies=4):
    """Returns (wins_a, wins_b, mean_plies). Colours alternate between games."""
    rng = np.random.default_rng(seed)
    pool = Pool(games, seed=seed)
    agents = (a, b)
    seat = [(g % 2) for g in range(games)]        # seat[g] = which agent is player 0
    alive = list(range(games))
    wins, plies = [0, 0], []
    for g in alive:
        pool.reset(g)
    ply = 0
    while alive:
        turn = ply % 2
        moves = {}
        for k in (0, 1):
            mine = [g for g in alive if (seat[g] ^ turn) == k]
            ag = agents[k]
            if not mine:
                continue
            if ag["kind"] == "mcts":
                for g in mine:
                    pool.begin(g, ag["sims"])
                pool.run(ag["evaluator"])
                for g in mine:
                    pool.finished()
                    visits, _ = pool.result(g)
                    if ply < opening_plies:       # a little variety in the openings
                        moves[g] = int(rng.choice(len(visits), p=visits / visits.sum()))
                    else:
                        moves[g] = int(visits.argmax())
            elif ag["kind"] == "greedy":
                for g in mine:
                    moves[g] = pool.greedy(g)
            else:
                for g in mine:
                    moves[g] = int(rng.choice(np.nonzero(pool.legal(g))[0]))
        ply += 1
        still = []
        for g in alive:
            w = pool.step(g, moves[g])
            if w < 0 and ply >= MAX_PLY:
                w = adjudicate(pool.state(g))
            if w >= 0:
                wins[seat[g] ^ w] += 1
                plies.append(ply)
            else:
                still.append(g)
        alive = still
    return wins[0], wins[1], float(np.mean(plies))
