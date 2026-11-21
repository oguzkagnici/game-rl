"""Rule checks for the C++ engine against a slow, obviously-correct Python model."""
import os
import random
import sys
from collections import deque

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from quoridor.engine import NA, Pool, canon, heuristic_evaluator, parse_action


class Ref:
    """Straightforward reference implementation of the rules."""

    def __init__(self):
        self.pos, self.walls, self.turn = [(8, 4), (0, 4)], [10, 10], 0
        self.h, self.v = set(), set()

    def blocked(self, r, c, dr, dc):
        nr, nc = r + dr, c + dc
        if not (0 <= nr < 9 and 0 <= nc < 9):
            return True
        if dr:
            rr = min(r, nr)
            return (rr, c) in self.h or (rr, c - 1) in self.h
        cc = min(c, nc)
        return (r, cc) in self.v or (r - 1, cc) in self.v

    def has_path(self, p):
        goal, seen, q = (0 if p == 0 else 8), {self.pos[p]}, deque([self.pos[p]])
        while q:
            r, c = q.popleft()
            if r == goal:
                return True
            for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                if not self.blocked(r, c, dr, dc) and (r + dr, c + dc) not in seen:
                    seen.add((r + dr, c + dc))
                    q.append((r + dr, c + dc))
        return False

    def legal(self):
        out = set()
        (r, c), opp = self.pos[self.turn], self.pos[1 - self.turn]
        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            if self.blocked(r, c, dr, dc):
                continue
            n = (r + dr, c + dc)
            if n != opp:
                out.add(n[0] * 9 + n[1])
            elif not self.blocked(n[0], n[1], dr, dc):
                out.add((n[0] + dr) * 9 + n[1] + dc)
            else:
                for er, ec in ((dc, dr), (-dc, -dr)):
                    if not self.blocked(n[0], n[1], er, ec):
                        out.add((n[0] + er) * 9 + n[1] + ec)
        if self.walls[self.turn]:
            for r in range(8):
                for c in range(8):
                    if (r, c) in self.h or (r, c) in self.v:
                        continue
                    if (r, c - 1) not in self.h and (r, c + 1) not in self.h:
                        self.h.add((r, c))
                        if self.has_path(0) and self.has_path(1):
                            out.add(81 + r * 8 + c)
                        self.h.discard((r, c))
                    if (r - 1, c) not in self.v and (r + 1, c) not in self.v:
                        self.v.add((r, c))
                        if self.has_path(0) and self.has_path(1):
                            out.add(145 + r * 8 + c)
                        self.v.discard((r, c))
        return out

    def step(self, a):
        if a < 81:
            self.pos[self.turn] = (a // 9, a % 9)
        else:
            s = a - 81 if a < 145 else a - 145
            (self.h if a < 145 else self.v).add((s // 8, s % 8))
            self.walls[self.turn] -= 1
        self.turn ^= 1


def test_random_games_match_reference(games=150, seed=1):
    rng = random.Random(seed)
    pool = Pool(1)
    positions = 0
    for g in range(games):
        pool.reset(0)
        ref = Ref()
        wall_bias = rng.choice([0.2, 0.6, 0.9])
        for ply in range(300):
            got = set(np.nonzero(pool.legal(0))[0].tolist())
            want = ref.legal()
            assert got == want, (g, ply, sorted(got ^ want))
            positions += 1
            walls = [a for a in got if a >= 81]
            pawn = [a for a in got if a < 81]
            a = rng.choice(walls) if walls and rng.random() < wall_bias else rng.choice(pawn)
            ref.step(a)
            if pool.step(0, a) >= 0:
                assert ref.pos[1 - ref.turn][0] == (0 if ref.turn == 1 else 8)
                break
    print(f"ok: {positions} positions agree with the reference rules")


def test_jumps():
    pool = Pool(1)
    pool.reset(0)
    for mv in ["e2", "e8", "e3", "e7", "e4", "e6", "e5"]:   # pawns face to face
        pool.step(0, parse_action(mv))
    legal = pool.legal(0)                                    # O on e6 to move, X on e5
    assert legal[parse_action("e4")] and not legal[parse_action("e5")]
    assert not legal[parse_action("d5")] and not legal[parse_action("f5")]
    pool.step(0, parse_action("a1h"))                        # O wastes a wall
    pool.step(0, parse_action("e6h"))                        # X walls behind O
    pool.step(0, parse_action("a3h"))
    legal = pool.legal(0)                                    # X to move: diagonal jumps
    assert legal[parse_action("d6")] and legal[parse_action("f6")]
    assert not legal[parse_action("e7")]
    print("ok: jump rules")


def test_canonical_is_involution():
    for a in range(NA):
        assert canon(canon(a, 1), 1) == a and canon(a, 0) == a
    print("ok: canonical mapping")


def test_search_finds_win():
    pool = Pool(1)
    pool.reset(0)
    for mv in ["e2", "d9", "e3", "c9", "e4", "b9", "e5", "a9", "e6", "a8", "e7", "a7", "e8", "a6"]:
        pool.step(0, parse_action(mv))
    pool.begin(0, 200)
    pool.run(heuristic_evaluator)
    visits, value = pool.result(0)
    assert int(visits.argmax()) == parse_action("e9"), int(visits.argmax())
    assert value > 0.5
    print("ok: search finds the winning move, value", round(float(value), 2))


if __name__ == "__main__":
    test_canonical_is_involution()
    test_jumps()
    test_search_finds_win()
    test_random_games_match_reference()
