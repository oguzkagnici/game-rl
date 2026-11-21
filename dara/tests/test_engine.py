"""Rule checks for the C++ engine against a slow, obviously-correct Python model."""
import os
import random
import sys

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dara import model as M
from dara.engine import MAX_PLY, NA, Pool, heuristic_evaluator, parse_action

R, C = 5, 6
STEP = [(-1, 0), (1, 0), (0, -1), (0, 1)]


class Ref:
    """Straightforward reference implementation of the rules."""

    def __init__(self):
        self.board = {}                      # (r, c) -> player
        self.hand, self.turn, self.phase, self.ply, self.winner = [12, 12], 0, 0, 0, -1

    def runs(self, cells, r, c):
        out = []
        for dr, dc in ((0, 1), (1, 0)):
            n, k = 1, 1
            while (r + k * dr, c + k * dc) in cells:
                n, k = n + 1, k + 1
            k = 1
            while (r - k * dr, c - k * dc) in cells:
                n, k = n + 1, k + 1
            out.append(n)
        return out

    def stones(self, p):
        return {x for x, q in self.board.items() if q == p}

    def legal(self):
        if self.winner >= 0:
            return set()
        me, out = self.stones(self.turn), set()
        if self.phase == 0:
            empties = [(r, c) for r in range(R) for c in range(C) if (r, c) not in self.board]
            for limit in (2, 3, 99):
                out = {r * C + c for r, c in empties if max(self.runs(me | {(r, c)}, r, c)) <= limit}
                if out:
                    break
        elif self.phase == 1:
            for (r, c) in me:
                for d, (dr, dc) in enumerate(STEP):
                    y = (r + dr, c + dc)
                    if not (0 <= y[0] < R and 0 <= y[1] < C) or y in self.board:
                        continue
                    if max(self.runs((me - {(r, c)}) | {y}, *y)) < 4:
                        out.add(30 + d * 30 + r * C + c)
        else:
            opp = self.stones(1 - self.turn)
            free = {x for x in opp if 3 not in self.runs(opp, *x)}
            out = {150 + r * C + c for r, c in (free or opp)}
        return out

    def end_turn(self):
        self.turn ^= 1
        if self.winner >= 0:
            return
        if self.phase == 1 and not self.legal():
            self.winner = 1 - self.turn
        elif self.ply >= MAX_PLY:
            a, b = len(self.stones(0)), len(self.stones(1))
            self.winner = 0 if a > b else 1 if b > a else 2

    def step(self, a):
        self.ply += 1
        if a < 30:
            self.board[divmod(a, C)] = self.turn
            self.hand[self.turn] -= 1
            if self.hand == [0, 0]:
                self.phase = 1
            self.end_turn()
        elif a < 150:
            d, x = divmod(a - 30, 30)
            r, c = divmod(x, C)
            y = (r + STEP[d][0], c + STEP[d][1])
            del self.board[(r, c)]
            self.board[y] = self.turn
            if 3 in self.runs(self.stones(self.turn), *y):
                self.phase = 2
            else:
                self.end_turn()
        else:
            del self.board[divmod(a - 150, C)]
            self.phase = 1
            if len(self.stones(1 - self.turn)) < 3:
                self.winner = self.turn
            self.end_turn()


def test_random_games_match_reference(games=400, seed=1):
    rng = random.Random(seed)
    pool = Pool(1)
    positions, results, captures = 0, [0, 0, 0], 0
    for g in range(games):
        pool.reset(0)
        ref = Ref()
        greedy = rng.random() < 0.5
        while True:
            got = set(np.nonzero(pool.legal(0))[0].tolist())
            assert got == ref.legal(), (g, ref.ply, sorted(got ^ ref.legal()))
            st = pool.state(0)
            assert (st["turn"], st["phase"], st["ply"]) == (ref.turn, ref.phase, ref.ply)
            positions += 1
            a = pool.greedy(0) if greedy else rng.choice(sorted(got))
            assert a in got
            captures += a >= 150
            ref.step(a)
            w = pool.step(0, a)
            assert w == ref.winner, (g, ref.ply, w, ref.winner)
            if w >= 0:
                results[w] += 1
                break
    print(f"ok: {positions} positions agree with the reference rules "
          f"(results p0/p1/draw {results}, {captures} captures)")


def test_symmetries():
    rng = np.random.default_rng(0)
    for k, (dims, perm) in enumerate(M.SYMMETRIES):
        pool = Pool(2)
        for g in range(20):
            pool.reset(0), pool.reset(1)
            while True:
                f0 = torch.from_numpy(pool.features(0))[None]
                f1 = torch.from_numpy(pool.features(1))[None]
                leg0 = torch.from_numpy(pool.legal(0).astype(np.float32))[None]
                tf, tl = M.transform(f0, leg0, k)
                assert torch.equal(tf, f1)
                assert torch.equal(tl[0], torch.from_numpy(pool.legal(1).astype(np.float32)))
                a = int(rng.choice(np.nonzero(pool.legal(0))[0]))
                w = pool.step(0, a)
                assert pool.step(1, int(perm[a])) == w
                if w >= 0:
                    break
    print("ok: board symmetries")


def test_search_finds_capture(trials=20):
    """Wherever a slide makes a three, the search should prefer such a slide."""
    rng = np.random.default_rng(3)
    pool, probe = Pool(1), Pool(1)
    found = hits = 0
    while found < trials:
        pool.reset(0)
        history = []
        while True:
            legal = np.nonzero(pool.legal(0))[0]
            st = pool.state(0)
            if st["phase"] == 1:
                def captures(a):
                    probe.reset(0)
                    for h in history:
                        probe.step(0, h)
                    probe.step(0, a)
                    return probe.state(0)["phase"] == 2
                good = {int(a) for a in legal if captures(a)}
                if good:
                    pool.begin(0, 400)
                    pool.run(heuristic_evaluator)
                    visits, _ = pool.result(0)
                    found += 1
                    hits += int(visits.argmax()) in good
                    break
            a = int(rng.choice(legal))
            history.append(a)
            if pool.step(0, a) >= 0:
                break
    assert hits >= 0.9 * trials, hits
    print(f"ok: search takes the capturing slide in {hits}/{trials} positions")


if __name__ == "__main__":
    test_symmetries()
    test_search_finds_capture()
    test_random_games_match_reference()
