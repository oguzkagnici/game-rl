"""Head-to-head matches between agents, many games in parallel, spread evenly over the terrains.

An agent is a dict:
    {"kind": "mcts", "evaluator": fn, "sims": 50, "deals": 4}   search: `sims` simulations in each of `deals` deals
                                                                + "oracle": True searches the true hidden tiles (a cheat, for measuring)
                                                                + "belief": {...} deals come from a belief over the opponent's rack (belief.py)
    {"kind": "policy", "evaluator": fn}                         no search, best legal network output
    {"kind": "greedy"}                                          one-move-ahead scripted bot
    {"kind": "random"}                                          uniform random legal action
"""
import numpy as np

from .engine import Pool, heuristic_evaluator


def heuristic_agent(sims=50, deals=4):
    return {"kind": "mcts", "evaluator": heuristic_evaluator, "sims": sims, "deals": deals}


def play_match(a, b, games=64, seed=0, terrains=range(8), by_terrain=False):
    """Returns (wins_a, wins_b, draws, mean_turns).  Game g is played on terrains[(g // 4) % len]; over each
    block of 4 games both agents get each colour twice and the first move twice."""
    rng = np.random.default_rng(seed)
    pool = Pool(games, seed=seed + 1)
    agents = (a, b)
    terrains = list(terrains)
    ter = [terrains[(g // 4) % len(terrains)] for g in range(games)]
    seat = [g % 2 for g in range(games)]              # seat[g] = which agent is player 0 (Blue)
    alive = list(range(games))
    wins, draws, lengths = [0, 0], 0, []
    per = {t: [0, 0, 0] for t in terrains}
    for g in alive:
        pool.reset(g, ter[g], (g // 2) % 2)
    beliefs = [None, None]
    for k in (0, 1):
        if agents[k].get("belief") is not None:
            from .belief import Belief
            beliefs[k] = Belief(games, agents[k]["evaluator"], seed=seed + 11 + k, **agents[k]["belief"])
    while alive:
        moves = {}
        for k in (0, 1):
            mine = [g for g in alive if (seat[g] ^ pool.turn(g)) == k]
            ag = agents[k]
            if not mine:
                continue
            if ag["kind"] == "mcts":
                for g in mine:
                    raw = pool.raw(g)
                    pool.preset(g, raw if ag.get("oracle") else
                                beliefs[k].deals(g, raw, seat[g] ^ k, ag.get("deals", 1)) if beliefs[k] else None)
                    pool.begin(g, ag["sims"], ag.get("deals", 1))
                pool.run(ag["evaluator"])
                pool.finished()
                for g in mine:
                    moves[g] = int(pool.result(g)[0].argmax())
            elif ag["kind"] == "policy":
                logits, _ = ag["evaluator"](np.stack([pool.features(g) for g in mine]))
                for j, g in enumerate(mine):
                    moves[g] = int(np.where(pool.legal(g) > 0, logits[j], -1e9).argmax())
            elif ag["kind"] == "greedy":
                for g in mine:
                    moves[g] = pool.greedy(g)
            else:
                for g in mine:
                    moves[g] = int(rng.choice(np.nonzero(pool.legal(g))[0]))
        still = []
        before = {g: pool.raw(g) for g in alive} if any(beliefs) else {}
        for g in alive:
            w = pool.step(g, moves[g])
            if w < 0:
                still.append(g)
                continue
            lengths.append(pool.state(g)["nturn"])
            if w == 2:
                draws += 1
                per[ter[g]][2] += 1
            else:
                wins[seat[g] ^ w] += 1
                per[ter[g]][seat[g] ^ w] += 1
        for k in (0, 1):
            if beliefs[k]:
                beliefs[k].update([(g, seat[g] ^ k, before[g], moves[g], pool.raw(g)) for g in alive])
        alive = still
    for k in (0, 1):
        if beliefs[k]:
            agents[k]["belief_stats"] = beliefs[k].stats
    out = (wins[0], wins[1], draws, float(np.mean(lengths)))
    return out + (per,) if by_terrain else out
