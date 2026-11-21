"""Head-to-head matches between agents, many games in parallel.

An agent is a dict:
    {"kind": "mcts", "evaluator": fn, "sims": 200}   search guided by any evaluator
    {"kind": "policy", "evaluator": fn}              no search, best legal network output
    {"kind": "greedy"}                              makes a three when it can, else random
    {"kind": "random"}                               uniform random legal action
"""
import numpy as np

from .engine import Pool, heuristic_evaluator


def heuristic_agent(sims=200):
    return {"kind": "mcts", "evaluator": heuristic_evaluator, "sims": sims}


def play_match(a, b, games=32, seed=0, opening_plies=6, random_opening=0):
    """Returns (wins_a, wins_b, draws, mean_actions). Who moves first alternates.

    opening_plies: each agent samples from its own move distribution this early in the game.
    random_opening: the first N actions of every game are uniformly random for both sides
    (the same treatment for every kind of agent; use with opening_plies=0)."""
    rng = np.random.default_rng(seed)
    pool = Pool(games, seed=seed)
    agents = (a, b)
    seat = [(g % 2) for g in range(games)]        # seat[g] = which agent is player 0
    alive = list(range(games))
    count = [0] * games
    wins, draws, lengths = [0, 0], 0, []
    for g in alive:
        pool.reset(g)
    while alive:
        moves = {}
        for k in (0, 1):
            mine = [g for g in alive if (seat[g] ^ pool.turn(g)) == k]
            for g in [g for g in mine if count[g] < random_opening]:
                moves[g] = int(rng.choice(np.nonzero(pool.legal(g))[0]))
            mine = [g for g in mine if count[g] >= random_opening]
            ag = agents[k]
            if not mine:
                continue
            if ag["kind"] == "mcts":
                for g in mine:
                    pool.begin(g, ag["sims"])
                pool.run(ag["evaluator"])
                pool.finished()
                for g in mine:
                    visits, _ = pool.result(g)
                    if count[g] < opening_plies:  # a little variety in the openings
                        moves[g] = int(rng.choice(len(visits), p=visits / visits.sum()))
                    else:
                        moves[g] = int(visits.argmax())
            elif ag["kind"] == "policy":          # no search: best legal output of the network
                logits, _ = ag["evaluator"](np.stack([pool.features(g) for g in mine]))
                for j, g in enumerate(mine):
                    z = np.where(pool.legal(g) > 0, logits[j], -1e9).astype(np.float64)
                    if count[g] < opening_plies:
                        p = np.exp(z - z.max())
                        moves[g] = int(rng.choice(len(z), p=p / p.sum()))
                    else:
                        moves[g] = int(z.argmax())
            elif ag["kind"] == "greedy":
                for g in mine:
                    moves[g] = pool.greedy(g)
            else:
                for g in mine:
                    moves[g] = int(rng.choice(np.nonzero(pool.legal(g))[0]))
        still = []
        for g in alive:
            w = pool.step(g, moves[g])
            count[g] += 1
            if w < 0:
                still.append(g)
                continue
            lengths.append(count[g])
            if w == 2:
                draws += 1
            else:
                wins[seat[g] ^ w] += 1
        alive = still
    return wins[0], wins[1], draws, float(np.mean(lengths))
