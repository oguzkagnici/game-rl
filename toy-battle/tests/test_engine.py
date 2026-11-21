"""Rules checks for the Toy Battle engine:  python tests/test_engine.py"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from toybattle.engine import A_BASE, A_DRAW, A_PLACE, A_SKIP, A_TYPE, MAXH, MB, NA, NT, Pool
from toybattle.terrains import NAMES, TERRAINS

P = Pool(1, seed=3)
KWAK, SKULLY, CAPN, JUMBO, HOOK, XB, STAR, ROXY = range(8)


def setup(terrain, board=None, racks=({}, {}), turn=0, reserve=(10, 10), disc=({}, {}), medals=(0, 0), pin=(0, 0)):
    """board: {base name: [(owner, type), ...] bottom first}.  The unseen pool gets whatever is left of 3 per type."""
    t = NAMES.index(terrain)
    names = [b["name"] for b in TERRAINS[t]["bases"]]
    a = np.zeros(len(P.raw(0)), np.int32)
    a[0], a[1], a[3], a[5], a[6], a[7], a[8], a[11], a[12], a[15] = t, turn, -1, medals[0], medals[1], reserve[0], reserve[1], pin[0], pin[1], 7
    used = np.zeros((2, NT), int)
    o = 16
    for name, stack in (board or {}).items():
        b = names.index(name)
        a[o + b] = len(stack)
        for k, (owner, typ) in enumerate(stack):
            a[o + MB + b * MAXH + k] = owner << 3 | typ
            used[owner, typ] += 1
    o += MB + MB * MAXH
    for p in (0, 1):
        for typ in range(NT):
            r, d = racks[p].get(typ, 0), disc[p].get(typ, 0)
            a[o + p * NT + typ] = r
            a[o + 2 * NT + p * NT + typ] = 3 - used[p, typ] - r - d
            a[o + 4 * NT + p * NT + typ] = d
    assert a.min() >= -1
    P.set_raw(0, a)
    return names


def legal():
    return set(np.nonzero(P.legal(0))[0].tolist())


def place(typ, slot):
    return A_PLACE + typ * 17 + slot


def top(names, name):
    s = P.state(0)["stacks"][names.index(name)]
    return s[-1] if s else None


def test_connection_and_cover():
    n = setup("Castle Field", {"d1": [(0, ROXY)], "c1": [(1, JUMBO)], "m2": [(1, KWAK)]}, ({HOOK: 1, CAPN: 1, KWAK: 1, ROXY: 1}, {}))
    L = legal()
    i = n.index
    assert place(CAPN, i("d1")) in L and place(CAPN, i("d2")) in L          # own base, base next to my H.Q.
    assert place(CAPN, i("c1")) not in L and place(ROXY, i("c1")) in L      # strictly stronger only
    assert place(HOOK, i("c1")) in L and place(KWAK, i("c1")) in L          # 4 > 3; the joker covers anything
    assert place(ROXY, i("a1")) not in L and place(HOOK, i("a1")) in L      # not connected; Hook jumps
    assert place(CAPN, i("m2")) not in L and place(HOOK, i("m2")) in L      # anything covers Kwak, if it can get there
    assert not any(a >= place(0, 0) and (a - A_PLACE) % 17 >= 15 for a in L)   # the enemy H.Q. is out of reach
    assert A_DRAW in L


def test_hq_capture_needs_connection():
    n = setup("Castle Field", {"d1": [(0, 1)], "c1": [(0, 2)], "m1": [(0, 3)], "b1": [(0, 5)]}, ({HOOK: 1, ROXY: 1}, {}))
    assert place(ROXY, 15) not in legal()
    P.step(0, place(ROXY, n.index("a1")))
    setup("Castle Field", {"d1": [(0, 1)], "c1": [(0, 2)], "m1": [(0, 3)], "b1": [(0, 5)], "a1": [(0, 6)]}, ({HOOK: 1}, {}))
    assert place(HOOK, 15) in legal()
    assert P.step(0, place(HOOK, 15)) == 0
    setup("Castle Field", {"a1": [(0, 1)]}, ({HOOK: 1}, {}))                 # a1 touches the red H.Q. but is cut off
    assert place(HOOK, 15) not in legal()


def test_regions_and_objective():
    n = setup("Castle Field", {"s3": [(0, 1)], "c1": [(0, 1)], "d1": [(0, 1)]}, ({ROXY: 2}, {}), medals=(5, 0))
    assert P.step(0, place(ROXY, n.index("m1"))) == -1                       # s3 c1 m1: 1 medal, then the special base
    s = P.state(0)
    assert s["medals0"] == 6 and s["phase"] == 0 and s["turn"] == 1          # m1 is a plain base: turn over
    setup("Castle Field", {"s3": [(0, 1)], "c1": [(0, 2)], "d1": [(0, 3)], "m2": [(0, 5)], "b1": [(1, 1)]}, ({ROXY: 2}, {}), medals=(4, 0))
    assert P.step(0, place(ROXY, n.index("m1"))) == -1                       # 1 medal only, b1 is red
    setup("Castle Field", {"s3": [(0, 1)], "c1": [(0, 2)], "d1": [(0, 3)], "m2": [(0, 5)], "b1": [(0, 6)]}, ({ROXY: 2}, {}), medals=(4, 0))
    assert P.step(0, place(ROXY, n.index("m1"))) == 0                        # two regions at once: 4 + 1 + 2 = 7


def test_medals_are_taken_once_and_kept():
    n = setup("Castle Field", {"s3": [(0, 1)], "c1": [(0, 1)], "d1": [(0, 1)], "d2": [(1, 7)], "c2": [(1, 7)]}, ({CAPN: 1}, {ROXY: 2}))
    P.step(0, place(CAPN, n.index("m1")))
    P.step(0, A_SKIP)
    assert P.state(0)["medals0"] == 1
    P.step(0, place(ROXY, n.index("m2")))
    P.step(0, A_DRAW)
    P.step(0, place(ROXY, n.index("c1")))                                    # red breaks the ring
    s = P.state(0)
    assert s["medals0"] == 1 and s["medals1"] == 0


def test_jumbo_and_capn_order():
    n = setup("Castle Field", {"d1": [(0, 1)], "c1": [(0, 1)], "m1": [(1, ROXY), (1, STAR)], "s3": [(1, 1)]}, ({CAPN: 1, JUMBO: 1}, {}))   # Jumbo will cover s3
    i = n.index
    P.step(0, place(CAPN, i("d2")))
    s = P.state(0)
    assert s["phase"] == 1 and s["turn"] == 0 and A_SKIP in legal()
    P.step(0, place(JUMBO, i("s3")))
    assert legal() == {A_SKIP, A_BASE + i("m1")}                             # only visible enemy troops next to Jumbo
    P.step(0, A_BASE + i("m1"))
    s = P.state(0)
    assert top(n, "m1") == (1, ROXY) and s["disc"][1][STAR] == 1
    assert s["phase"] == 3 and s["turn"] == 0                                # troop effects first, then the special base
    assert legal() == {A_SKIP, A_BASE + i("d1"), A_BASE + i("c1"), A_BASE + i("d2")}
    P.step(0, A_SKIP)
    assert P.state(0)["turn"] == 1


def test_skully_star_xb():
    setup("Caribbean Sea", {}, ({SKULLY: 1, STAR: 1, XB: 1}, {ROXY: 2}), reserve=(10, 10))
    P.step(0, place(SKULLY, 11))                                             # l, next to blue H.Q. 1
    s = P.state(0)
    assert s["rack"][0].sum() == 4 and s["reserve0"] == 8
    setup("Caribbean Sea", {}, ({STAR: 1, XB: 1}, {ROXY: 2}))
    P.step(0, place(XB, 11))
    s = P.state(0)
    assert s["rack"][1][ROXY] == 1 and s["disc"][1][ROXY] == 1
    setup("Caribbean Sea", {}, ({SKULLY: 1, ROXY: 3, STAR: 3}, {}))                  # 6 left on the rack after placing: draws 2
    P.step(0, place(SKULLY, 11))
    assert P.state(0)["rack"][0].sum() == 8
    setup("Caribbean Sea", {}, ({ROXY: 3, STAR: 3, HOOK: 2}, {}))
    assert A_DRAW not in legal()


def test_castle_recall():
    n = setup("Castle Field", {"d1": [(0, STAR)], "c1": [(1, 1), (0, HOOK)]}, ({ROXY: 1}, {}))
    i = n.index
    P.step(0, place(ROXY, i("s3")))
    assert legal() == {A_SKIP, A_BASE + i("d1"), A_BASE + i("c1")}           # not the troop just placed
    P.step(0, A_BASE + i("c1"))
    s = P.state(0)
    assert s["rack"][0][HOOK] == 1 and top(n, "c1") == (1, 1) and s["known"][0][HOOK] == 1 and s["turn"] == 1


def test_clouds_draw_and_cemetery():
    n = setup("City of Clouds", {"l5": [(0, 1)]}, ({ROXY: 1}, {}))
    P.step(0, place(ROXY, n.index("s4")))
    assert P.state(0)["rack"][0].sum() == 1 and P.state(0)["turn"] == 1
    n = setup("Cursed Cemetery", {"j": [(0, 1)]}, ({ROXY: 1}, {}), disc=({STAR: 1, KWAK: 2}, {}))
    P.step(0, place(ROXY, n.index("p3")))
    assert legal() == {A_SKIP, A_TYPE + STAR, A_TYPE + KWAK}
    P.step(0, A_TYPE + STAR)
    s = P.state(0)
    assert s["rack"][0][STAR] == 1 and s["disc"][0][STAR] == 0 and s["turn"] == 1


def test_jungle_eruption():
    n = setup("Volcanic Jungle", {"h": [(0, 1)], "e": [(0, 1)], "c": [(1, ROXY)], "a": [(1, 2)], "f": [(0, 3)]}, ({KWAK: 1}, {}))
    i = n.index
    P.step(0, place(KWAK, i("v1")))                                          # v1 touches a, e, c
    assert legal() == {A_SKIP, A_BASE + i("a"), A_BASE + i("c")}
    P.step(0, A_BASE + i("c"))
    assert legal() == {A_BASE + i("v1"), A_BASE + i("b"), A_BASE + i("f")}
    P.step(0, A_BASE + i("f"))                                               # lands on my Jumbo, ignoring strength
    assert top(n, "f") == (1, ROXY) and top(n, "c") is None and P.state(0)["turn"] == 1


def test_pool_gates():
    n = setup("Tropical Pool", {"b": [(0, 1)], "c3": [(0, 1)]}, ({KWAK: 1, SKULLY: 1, HOOK: 1, ROXY: 1}, {}))
    i = n.index
    L = legal()
    assert place(SKULLY, i("l4")) in L and place(ROXY, i("l4")) not in L and place(KWAK, i("l4")) in L     # gate 1/2
    assert place(ROXY, i("c2")) in L and place(HOOK, i("c2")) not in L                                      # gate 6/7
    assert place(HOOK, i("r3")) in L and place(HOOK, i("r1")) not in L                                      # Hook obeys gates
    n = setup("Tropical Pool", {"b": [(0, 1)], "c3": [(0, 2)], "c2": [(0, 7)], "c1": [(0, 3)], "t": [(0, 5)]}, ({SKULLY: 1, ROXY: 1}, {}))
    L = legal()
    assert place(ROXY, 15) in L and place(SKULLY, 15) not in L               # red H.Q. 1 is gated 6/7 ...
    assert place(SKULLY, 16) in L                                            # ... red H.Q. 2 is open


def test_station_shield():
    n = setup("Station Metal-X", {"i": [(0, 1)], "f": [(0, 1)]}, ({SKULLY: 1, HOOK: 1}, {}))
    i = n.index
    L = legal()
    assert place(HOOK, i("s2")) in L and place(HOOK, i("a")) in L
    setup("Station Metal-X", {"i": [(0, 1)]}, ({SKULLY: 1, HOOK: 1}, {}))
    assert place(HOOK, i("s2")) not in legal()                               # no jump onto a shielded base
    setup("Station Metal-X", {"i": [(0, 1)], "f": [(0, 1)]}, ({SKULLY: 1, HOOK: 1}, {}))
    P.step(0, place(SKULLY, i("s2")))
    assert P.state(0)["rack"][0].sum() == 1                                  # Skully's draw is not applied


def test_battlefield_sniper():
    n = setup("Battlefield", {"d1": [(0, 1)], "c1": [(0, 1)]}, ({ROXY: 1}, {STAR: 1}))
    P.step(0, place(ROXY, n.index("sb")))
    s = P.state(0)
    assert s["pin1"] == STAR + 1 and s["turn"] == 1
    assert legal() == {A_DRAW}                                               # the only troop is lying down
    P.step(0, A_DRAW)
    assert P.state(0)["pin1"] == 0


def test_stuck_player_ends_the_game():
    n = setup("Caribbean Sea", {}, ({ROXY: 1}, {}), reserve=(0, 0), medals=(1, 1))
    assert P.step(0, place(ROXY, 11)) == 0                                   # red cannot act: tie, red loses
    n = setup("Caribbean Sea", {}, ({ROXY: 1}, {}), reserve=(0, 0), medals=(1, 2))
    assert P.step(0, place(ROXY, 11)) == 1


def test_fuzz_conservation():
    rng = np.random.default_rng(1)
    for g in range(400):
        P.reset(0, g % 8, g % 2)
        while True:
            L = np.nonzero(P.legal(0))[0]
            assert len(L) > 0
            w = P.step(0, int(rng.choice(L)))
            if w >= 0:                             # a troop on the enemy H.Q. is on no base
                break
            s = P.state(0)
            for p in (0, 1):
                on_board = sum(o == p for st in s["stacks"] for o, _ in st)
                assert on_board + s["rack"][p].sum() + s["pool"][p].sum() + s["disc"][p].sum() == 24
                assert s["pool"][p].sum() == s[f"reserve{p}"] + 4 and s["rack"][p].sum() <= 8
                assert (s["known"][p] <= s["rack"][p]).all()
            assert s["medals0"] + s["medals1"] <= sum(r["medals"] for r in TERRAINS[g % 8]["regions"])


def test_features_hide_the_opponent_rack():
    rng = np.random.default_rng(2)
    for g in range(40):
        P.reset(0, g % 8, g % 2)
        for _ in range(int(rng.integers(1, 25))):
            L = np.nonzero(P.legal(0))[0]
            if P.step(0, int(rng.choice(L))) >= 0:
                break
        else:
            a = P.raw(0)
            f1 = P.features(0)
            o = 16 + MB + MB * MAXH
            me = int(a[1])
            op = 1 - me
            rack, pool, known = a[o + op * NT:o + (op + 1) * NT], a[o + 2 * NT + op * NT:o + 2 * NT + (op + 1) * NT], a[o + 6 * NT + op * NT:o + 6 * NT + (op + 1) * NT]
            for t in range(NT):                    # swap a hidden rack tile with a pool tile of another type
                for u in range(NT):
                    if t != u and rack[t] > known[t] and pool[u] > 0 and a[11 + op] == 0:
                        b = a.copy()
                        b[o + op * NT + t] -= 1; b[o + op * NT + u] += 1
                        b[o + 2 * NT + op * NT + t] += 1; b[o + 2 * NT + op * NT + u] -= 1
                        P.set_raw(0, b)
                        assert np.array_equal(P.features(0), f1) and np.array_equal(P.legal(0), (P.set_raw(0, a), P.legal(0))[1])
            P.set_raw(0, a)


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print("ok", t.__name__)
    print(f"{len(tests)} tests passed")
