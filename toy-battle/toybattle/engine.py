"""ctypes wrapper around the C++ Toy Battle engine (engine.cpp)."""
import ctypes
import os
import subprocess

import numpy as np

from .terrains import MB, NAMES, NT, TERRAINS, TROOPS, packed

NA = 161
A_DRAW, A_SKIP, A_PLACE, A_BASE, A_TYPE = 0, 1, 2, 138, 153
FB, FG = 48, 96
FEAT = MB * FB + FG
MAXH = 12
PHASES = ("main", "extra troop", "jumbo", "take back", "eruption: which troop", "eruption: where to", "cemetery")

_dir = os.path.dirname(os.path.abspath(__file__))
_so = os.path.join(_dir, "libtoybattle.so")
_src = os.path.join(_dir, "engine.cpp")


def build(force=False):
    if force or not os.path.exists(_so) or os.path.getmtime(_so) < os.path.getmtime(_src):
        subprocess.check_call(["g++", "-O3", "-march=native", "-fopenmp", "-shared", "-fPIC", "-o", _so, _src])


build()
_lib = ctypes.CDLL(_so)
_f32 = np.ctypeslib.ndpointer(np.float32, flags="C_CONTIGUOUS")
_i32 = np.ctypeslib.ndpointer(np.int32, flags="C_CONTIGUOUS")
_u8 = np.ctypeslib.ndpointer(np.uint8, flags="C_CONTIGUOUS")
_vp, _i, _f = ctypes.c_void_p, ctypes.c_int, ctypes.c_float
for name, res, args in [
    ("tb_sizes", _i, [_i32]), ("tb_set_terrain", None, [_i, _i32]), ("tb_dump_size", _i, []),
    ("tb_new", _vp, [_i, ctypes.c_uint64]), ("tb_free", None, [_vp]),
    ("tb_set_params", None, [_vp, _f, _f]), ("tb_reset", None, [_vp, _i, _i, _i]),
    ("tb_step", _i, [_vp, _i, _i]), ("tb_legal", _i, [_vp, _i, _u8]), ("tb_turn", _i, [_vp, _i]),
    ("tb_features", None, [_vp, _i, _f32]), ("tb_get", None, [_vp, _i, _i32]), ("tb_set", None, [_vp, _i, _i32]),
    ("tb_greedy", _i, [_vp, _i]), ("tb_begin", None, [_vp, _i, _i, _i, _f, _f]),
    ("tb_collect", _i, [_vp, _f32]), ("tb_apply", None, [_vp, _f32, _f32]), ("tb_finished", _i, [_vp, _i32]),
    ("tb_result", _f, [_vp, _i, _f32, ctypes.c_void_p]),
]:
    fn = getattr(_lib, name)
    fn.restype, fn.argtypes = res, args

_sz = np.zeros(8, np.int32)
_lib.tb_sizes(_sz)
assert (_sz[0], _sz[1], _sz[2], _sz[4]) == (NA, FB, FG, MAXH)
MAXTURN = int(_sz[3])
for _k, _t in enumerate(TERRAINS):
    _lib.tb_set_terrain(_k, packed(_t))
DUMP = _lib.tb_dump_size()
_HEAD = ["ter", "turn", "phase", "winner", "nturn", "medals0", "medals1", "reserve0", "reserve1", "taken", "src",
         "pin0", "pin1", "nplaced", "qi", "rng"]


class Pool:
    """`n` independent games, each with its own search, advanced in lock-step."""

    def __init__(self, n, seed=0, cpuct=1.5, fpu=0.25):
        self.n = n
        self._p = _lib.tb_new(n, seed)
        _lib.tb_set_params(self._p, cpuct, fpu)
        self.feats = np.zeros((n, FEAT), np.float32)
        self._fin = np.zeros(n, np.int32)

    def __del__(self):
        if getattr(self, "_p", None):
            _lib.tb_free(self._p)
            self._p = None

    def reset(self, i, terrain, first):
        _lib.tb_reset(self._p, i, int(terrain), int(first))

    def step(self, i, action):
        """-1 while the game continues, 0/1 for a winner, 2 for a draw (turn limit)."""
        return _lib.tb_step(self._p, i, int(action))

    def legal(self, i):
        mask = np.zeros(NA, np.uint8)
        _lib.tb_legal(self._p, i, mask)
        return mask

    def turn(self, i):
        return _lib.tb_turn(self._p, i)

    def features(self, i):
        f = np.zeros(FEAT, np.float32)
        _lib.tb_features(self._p, i, f)
        return f

    def raw(self, i):
        a = np.zeros(DUMP, np.int32)
        _lib.tb_get(self._p, i, a)
        return a

    def set_raw(self, i, a):
        _lib.tb_set(self._p, i, np.ascontiguousarray(a, np.int32))

    def state(self, i):
        a = self.raw(i)
        d = {k: int(v) for k, v in zip(_HEAD, a[:16])}
        o = 16
        h = a[o:o + MB]; o += MB
        st = a[o:o + MB * MAXH].reshape(MB, MAXH); o += MB * MAXH
        d["stacks"] = [[(int(x) >> 3, int(x) & 7) for x in st[b, :h[b]]] for b in range(MB)]   # (owner, type), bottom first
        for key in ("rack", "pool", "disc", "known"):
            d[key] = a[o:o + 2 * NT].reshape(2, NT).copy(); o += 2 * NT
        d["placed"] = a[o:o + d["nplaced"]].tolist()
        return d

    def greedy(self, i):
        return _lib.tb_greedy(self._p, i)

    def begin(self, i, sims, deals=1, noise_eps=0.0, noise_alpha=0.4):
        _lib.tb_begin(self._p, i, sims, deals, noise_eps, noise_alpha)

    def collect(self):
        return _lib.tb_collect(self._p, self.feats)

    def apply(self, logits, values):
        _lib.tb_apply(self._p, np.ascontiguousarray(logits, np.float32), np.ascontiguousarray(values, np.float32))

    def finished(self):
        m = _lib.tb_finished(self._p, self._fin)
        return self._fin[:m].tolist()

    def result(self, i, with_q=False):
        visits = np.zeros(NA, np.float32)
        q = np.zeros(NA, np.float32) if with_q else None
        v = _lib.tb_result(self._p, i, visits, q.ctypes.data if with_q else None)
        return (visits, v, q) if with_q else (visits, v)

    def run(self, evaluator):
        while True:
            m = self.collect()
            if m == 0:
                return
            self.apply(*evaluator(self.feats[:m]))


G = MB * FB      # offset of the global features


def heuristic_evaluator(feats):
    """No learning: uniform priors; value from the medal balance, bases held and H.Q. threats."""
    g = feats[:, G:]
    v = 2.0 * g[:, 85] + 1.5 * (g[:, 86] - g[:, 87]) + 0.6 * (g[:, 80] + g[:, 81]) - 0.6 * (g[:, 88] + g[:, 89])
    return np.zeros((len(feats), NA), np.float32), np.tanh(v).astype(np.float32)


def action_str(a, terrain=None):
    names = [b["name"] for b in TERRAINS[terrain]["bases"]] if terrain is not None else [str(i) for i in range(MB)]
    if a == A_DRAW:
        return "draw"
    if a == A_SKIP:
        return "skip"
    if a < A_BASE:
        t, s = divmod(a - A_PLACE, 17)
        return f"{TROOPS[t]} -> " + (names[s] if s < 15 else f"enemy HQ{s - 14}")
    if a < A_TYPE:
        return f"pick {names[a - A_BASE]}"
    return f"take back {TROOPS[a - A_TYPE]}"
