"""ctypes wrapper around the C++ Quoridor engine (engine.cpp)."""
import ctypes
import os
import subprocess

import numpy as np

NA = 209          # 81 pawn destinations + 64 horizontal + 64 vertical walls
NP = 10           # feature planes
MAX_PLY = 150     # self-play / arena games are adjudicated after this many plies

_dir = os.path.dirname(os.path.abspath(__file__))
_so = os.path.join(_dir, "libquoridor.so")
_src = os.path.join(_dir, "engine.cpp")


def build(force=False):
    if force or not os.path.exists(_so) or os.path.getmtime(_so) < os.path.getmtime(_src):
        subprocess.check_call(["g++", "-O3", "-march=native", "-fopenmp", "-shared",
                               "-fPIC", "-o", _so, _src])


build()
_lib = ctypes.CDLL(_so)
_f32 = np.ctypeslib.ndpointer(np.float32, flags="C_CONTIGUOUS")
_i32 = np.ctypeslib.ndpointer(np.int32, flags="C_CONTIGUOUS")
_u8 = np.ctypeslib.ndpointer(np.uint8, flags="C_CONTIGUOUS")
_vp, _i, _f = ctypes.c_void_p, ctypes.c_int, ctypes.c_float
for name, res, args in [
    ("qp_new", _vp, [_i, ctypes.c_uint64]), ("qp_free", None, [_vp]),
    ("qp_set_params", None, [_vp, _f, _f]), ("qp_reset", None, [_vp, _i]),
    ("qp_step", _i, [_vp, _i, _i]), ("qp_legal", _i, [_vp, _i, _u8]),
    ("qp_state", None, [_vp, _i, _i32]), ("qp_features", None, [_vp, _i, _f32]),
    ("qp_greedy", _i, [_vp, _i]), ("qp_begin", None, [_vp, _i, _i, _f, _f]),
    ("qp_collect", _i, [_vp, _f32]), ("qp_apply", None, [_vp, _f32, _f32]),
    ("qp_finished", _i, [_vp, _i32]),
    ("qp_result", _f, [_vp, _i, _f32, ctypes.c_void_p, _i]),
    ("qp_canon", _i, [_i, _i]),
]:
    fn = getattr(_lib, name)
    fn.restype, fn.argtypes = res, args


class Pool:
    """`n` independent games, each with its own search tree, advanced in lock-step."""

    def __init__(self, n, seed=0, cpuct=1.5, fpu=0.25):
        self.n = n
        self._p = _lib.qp_new(n, seed)
        _lib.qp_set_params(self._p, cpuct, fpu)
        self.feats = np.zeros((n, NP, 9, 9), np.float32)
        self._fin = np.zeros(n, np.int32)

    def __del__(self):
        if getattr(self, "_p", None):
            _lib.qp_free(self._p)
            self._p = None

    # --- game state -------------------------------------------------------
    def reset(self, i):
        _lib.qp_reset(self._p, i)

    def step(self, i, action):
        return _lib.qp_step(self._p, i, int(action))

    def legal(self, i):
        mask = np.zeros(NA, np.uint8)
        _lib.qp_legal(self._p, i, mask)
        return mask

    def state(self, i):
        b = np.zeros(137, np.int32)
        _lib.qp_state(self._p, i, b)
        keys = ["pos0", "pos1", "walls0", "walls1", "turn", "winner", "ply", "dist0", "dist1"]
        d = {k: int(v) for k, v in zip(keys, b[:9])}
        d["h"], d["v"] = b[9:73].reshape(8, 8), b[73:137].reshape(8, 8)
        return d

    def features(self, i):
        f = np.zeros((NP, 9, 9), np.float32)
        _lib.qp_features(self._p, i, f)
        return f

    def greedy(self, i):
        return _lib.qp_greedy(self._p, i)

    # --- search -----------------------------------------------------------
    def begin(self, i, sims, noise_eps=0.0, noise_alpha=0.3):
        _lib.qp_begin(self._p, i, sims, noise_eps, noise_alpha)

    def collect(self):
        return _lib.qp_collect(self._p, self.feats)

    def apply(self, logits, values):
        _lib.qp_apply(self._p, np.ascontiguousarray(logits, np.float32),
                      np.ascontiguousarray(values, np.float32))

    def finished(self):
        m = _lib.qp_finished(self._p, self._fin)
        return self._fin[:m].tolist()

    def result(self, i, canonical=False, with_q=False):
        visits = np.zeros(NA, np.float32)
        q = np.zeros(NA, np.float32) if with_q else None
        v = _lib.qp_result(self._p, i, visits, q.ctypes.data if with_q else None, int(canonical))
        return (visits, v, q) if with_q else (visits, v)

    def run(self, evaluator):
        """Run all searches started with begin() to completion."""
        while True:
            m = self.collect()
            if m == 0:
                return
            logits, values = evaluator(self.feats[:m])
            self.apply(logits, values)


def canon(action, turn):
    return _lib.qp_canon(int(action), int(turn))


def heuristic_evaluator(feats):
    """No learning: uniform move priors, value from the shortest-path race."""
    my_d, op_d = feats[:, 8, 0, 0] * 20, feats[:, 9, 0, 0] * 20
    # the side to move is effectively one step ahead
    value = np.tanh(0.35 * (op_d - my_d + 0.5)).astype(np.float32)
    return np.zeros((len(feats), NA), np.float32), value


# --- text helpers -----------------------------------------------------------
COLS = "abcdefghi"


def action_str(a):
    """Standard-ish notation: e2 = pawn to e2; e3h / e3v = wall at slot e3."""
    if a < 81:
        return f"{COLS[a % 9]}{9 - a // 9}"
    s = a - 81 if a < 145 else a - 145
    return f"{COLS[s % 8]}{8 - s // 8}{'h' if a < 145 else 'v'}"


def parse_action(text):
    text = text.strip().lower()
    try:
        c, r = COLS.index(text[0]), int(text[1])
        if len(text) == 2:
            return (9 - r) * 9 + c
        if len(text) == 3 and text[2] in "hv" and c < 8 and 1 <= r <= 8:
            return (81 if text[2] == "h" else 145) + (8 - r) * 8 + c
    except (ValueError, IndexError):
        pass
    return None


def render(st):
    """ASCII board. X = player 0 (moves up, wins on rank 9), O = player 1."""
    h, v = st["h"], st["v"]
    lines = []
    for r in range(9):
        row = f"{9 - r} "
        for c in range(9):
            ch = "X" if st["pos0"] == r * 9 + c else "O" if st["pos1"] == r * 9 + c else "."
            row += f" {ch} "
            if c < 8:
                wall = (r < 8 and v[r, c]) or (r > 0 and v[r - 1, c])
                row += "|" if wall else " "
        lines.append(row)
        if r < 8:
            row = "  "
            for c in range(9):
                wall = (c < 8 and h[r, c]) or (c > 0 and h[r, c - 1])
                row += "---" if wall else "   "
                if c < 8:
                    row += "+" if (h[r, c] or v[r, c]) else " "
            lines.append(row)
    lines.append("   " + "   ".join(COLS))
    lines.append(f"X walls: {st['walls0']} (path {st['dist0']})   "
                 f"O walls: {st['walls1']} (path {st['dist1']})")
    return "\n".join(lines)
