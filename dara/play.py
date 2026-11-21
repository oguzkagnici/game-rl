"""Play Dara against the trained network in the terminal.

    python play.py                       # you move first (X)
    python play.py --second --sims 1600  # model moves first, thinks harder

Moves:  c3   drop a stone on c3
        c3n  slide the stone on c3 north (n/s/w/e; north is up the board)
        xc3  capture the enemy stone on c3 (after you make a three)
"""
import argparse

import numpy as np

from dara import model as M
from dara.engine import PHASES, Pool, action_str, parse_action, render


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="runs/main/latest.pt")
    ap.add_argument("--sims", type=int, default=800, help="search simulations per model move")
    ap.add_argument("--second", action="store_true", help="let the model move first")
    args = ap.parse_args()

    net, ck = M.load(args.model)
    evaluator = M.NetEvaluator(net)
    pool = Pool(1)
    pool.reset(0)
    human = 1 if args.second else 0
    print(f"Model from iteration {ck.get('iteration', '?')}. You are {'XO'[human]}.\n")
    winner = -1
    while winner < 0:
        st = pool.state(0)
        print(render(st), "\n")
        legal = pool.legal(0)
        if st["turn"] == human:
            a = None
            while a is None or not legal[a]:
                text = input(f"your {PHASES[st['phase']]} > ")
                if text.strip() in ("q", "quit"):
                    return
                a = parse_action(text)
                if a is None or not legal[a]:
                    a = None
                    print("  not legal. options:",
                          " ".join(action_str(x) for x in np.nonzero(legal)[0]))
        else:
            pool.begin(0, args.sims)
            pool.run(evaluator)
            visits, value = pool.result(0)
            a = int(visits.argmax())
            print(f"model plays {action_str(a)}   (its winning chances: {50 * (value + 1):.0f}%)\n")
        winner = pool.step(0, a)
    print(render(pool.state(0)))
    print("Draw." if winner == 2 else "You win!" if winner == human else "The model wins.")


if __name__ == "__main__":
    main()
