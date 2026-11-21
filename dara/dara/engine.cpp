// Dara rules + batched PUCT Monte-Carlo tree search.
//
// The search never calls a neural network itself.  It runs many independent
// searches ("slots") in lock-step:
//
//   qp_collect()  walks every active tree down to a leaf and writes that
//                 leaf's feature planes into one big batch;
//   qp_apply()    takes the evaluator's (policy logits, value) for the batch,
//                 expands the leaves and backs the values up.
//
// Python sits in the middle and evaluates the batch with whatever it likes
// (a PyTorch net, a hand-written heuristic, ...).
//
// Board: 5 rows x 6 columns, cell = r*6+c.  12 stones per player.
// Phases: DROP (place a stone), MOVE (slide one step orthogonally), CAPTURE
// (the mover just made a three and now removes an enemy stone - the same
// player acts twice in a row, so the search tracks who moves at every node).
//
// Actions: 0..29      drop on cell
//          30..149    move: 30 + dir*30 + from-cell, dir 0=N(r-1) 1=S 2=W 3=E
//          150..179   capture the enemy stone on cell
// Features are always from the side to move, so no board flipping is needed.

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <random>
#include <vector>

namespace {

const int R = 5, C = 6, NC = 30, NA = 180, NP = 10, FEAT = NP * NC;
const int MAX_PLY = 200;
const int DR[4] = {-1, 1, 0, 0}, DCc[4] = {0, 0, -1, 1};
enum { DROP = 0, MOVE = 1, CAPTURE = 2 };

struct State {
    uint32_t b[2] = {0, 0};
    uint8_t hand[2] = {12, 12};
    uint8_t turn = 0, phase = DROP;
    int8_t winner = -1;          // -1 running, 0/1 winner, 2 draw
    uint16_t ply = 0;
};

inline bool has(uint32_t m, int r, int c) {
    return r >= 0 && r < R && c >= 0 && c < C && ((m >> (r * C + c)) & 1);
}
// Length of the run of stones through cell x (which must be set) on one axis.
inline int run(uint32_t m, int x, int dr, int dc) {
    int r = x / C, c = x % C, n = 1;
    for (int k = 1; has(m, r + k * dr, c + k * dc); k++) n++;
    for (int k = 1; has(m, r - k * dr, c - k * dc); k++) n++;
    return n;
}
inline int longest(uint32_t m, int x) { return std::max(run(m, x, 0, 1), run(m, x, 1, 0)); }
inline bool in_three(uint32_t m, int x) { return run(m, x, 0, 1) == 3 || run(m, x, 1, 0) == 3; }

int legal_actions(const State& s, int* out) {
    if (s.winner >= 0) return 0;
    int n = 0, me = s.turn, op = 1 - me;
    uint32_t occ = s.b[0] | s.b[1];
    if (s.phase == DROP) {
        // no threes may be formed while dropping; relax only if forced
        for (int limit = 2; limit <= 30 && n == 0; limit += (limit == 3 ? 27 : 1))
            for (int x = 0; x < NC; x++)
                if (!((occ >> x) & 1) && longest(s.b[me] | (1u << x), x) <= limit) out[n++] = x;
    } else if (s.phase == MOVE) {
        for (int x = 0; x < NC; x++) {
            if (!((s.b[me] >> x) & 1)) continue;
            for (int d = 0; d < 4; d++) {
                int r = x / C + DR[d], c = x % C + DCc[d];
                if (r < 0 || r >= R || c < 0 || c >= C) continue;
                int y = r * C + c;
                if ((occ >> y) & 1) continue;
                if (longest((s.b[me] ^ (1u << x)) | (1u << y), y) >= 4) continue;
                out[n++] = 30 + d * 30 + x;
            }
        }
    } else {
        for (int x = 0; x < NC; x++)
            if (((s.b[op] >> x) & 1) && !in_three(s.b[op], x)) out[n++] = 150 + x;
        if (n == 0)   // every enemy stone is protected: any may be taken
            for (int x = 0; x < NC; x++)
                if ((s.b[op] >> x) & 1) out[n++] = 150 + x;
    }
    return n;
}

void end_turn(State& s) {
    s.turn ^= 1;
    if (s.winner >= 0) return;
    if (s.phase == MOVE) {
        int tmp[NA];
        if (legal_actions(s, tmp) == 0) { s.winner = 1 - s.turn; return; }
    }
    if (s.ply >= MAX_PLY) {
        int a = __builtin_popcount(s.b[0]), b = __builtin_popcount(s.b[1]);
        s.winner = a > b ? 0 : b > a ? 1 : 2;
    }
}

void apply_action(State& s, int a) {
    int me = s.turn, op = 1 - me;
    s.ply++;
    if (a < 30) {
        s.b[me] |= 1u << a;
        s.hand[me]--;
        if (s.hand[0] == 0 && s.hand[1] == 0) s.phase = MOVE;
        end_turn(s);
    } else if (a < 150) {
        int d = (a - 30) / 30, x = (a - 30) % 30;
        int y = (x / C + DR[d]) * C + x % C + DCc[d];
        s.b[me] = (s.b[me] ^ (1u << x)) | (1u << y);
        if (in_three(s.b[me], y)) s.phase = CAPTURE;   // same player continues
        else end_turn(s);
    } else {
        s.b[op] &= ~(1u << (a - 150));
        s.phase = MOVE;
        if (__builtin_popcount(s.b[op]) < 3) s.winner = me;
        end_turn(s);
    }
}

void features(const State& s, float* f) {
    memset(f, 0, sizeof(float) * FEAT);
    int me = s.turn, op = 1 - me;
    float nme = __builtin_popcount(s.b[me]) / 12.0f, nop = __builtin_popcount(s.b[op]) / 12.0f;
    for (int i = 0; i < NC; i++) {
        f[0 * NC + i] = (s.b[me] >> i) & 1;
        f[1 * NC + i] = (s.b[op] >> i) & 1;
        f[(2 + s.phase) * NC + i] = 1;
        f[5 * NC + i] = s.hand[me] / 12.0f;
        f[6 * NC + i] = s.hand[op] / 12.0f;
        f[7 * NC + i] = nme;
        f[8 * NC + i] = nop;
        f[9 * NC + i] = s.ply / (float)MAX_PLY;
    }
}

// Value of a finished game for the player to move in `s`.
inline float terminal_value(const State& s) {
    return s.winner == 2 ? 0.0f : (s.winner == s.turn ? 1.0f : -1.0f);
}

// ---------------------------------------------------------------- search --

struct Edge { int16_t a; float p; int32_t n; float w; int32_t child; };
struct Node { State s; int32_t n = 0; float w = 0; int32_t e0 = -1; int16_t ne = 0; };

struct Slot {
    State game;
    std::vector<Node> nodes;
    std::vector<Edge> edges;
    std::vector<int32_t> path;   // edge indices root->leaf
    std::vector<int32_t> pnodes; // node each edge was chosen at
    int target = 0, done = 0, leaf = -1;
    bool waiting = false;        // leaf sent out for evaluation
    bool reported = true;        // completion already handed to python
    float noise_eps = 0, noise_alpha = 0.3f;
    std::mt19937 rng;
};

struct Pool {
    std::vector<Slot> slots;
    std::vector<int> pending;    // slots waiting for an evaluation, batch order
    float cpuct = 1.5f, fpu = 0.25f;
};

// v: value for the player to move at the leaf.  Node sums are kept from that
// node's mover's view, edge sums from the view of the player choosing the edge.
void backup(Slot& t, float v) {
    int tl = t.nodes[t.leaf].s.turn;
    t.nodes[t.leaf].n++; t.nodes[t.leaf].w += v;
    for (int i = (int)t.path.size() - 1; i >= 0; i--) {
        Node& par = t.nodes[t.pnodes[i]];
        float pv = par.s.turn == tl ? v : -v;
        Edge& e = t.edges[t.path[i]];
        e.n++; e.w += pv;
        par.n++; par.w += pv;
    }
    t.done++;
}

// Descend until a leaf that needs the evaluator (returns true) or the
// simulation budget is used up (returns false).
bool descend(const Pool& P, Slot& t) {
    while (t.done < t.target) {
        t.path.clear(); t.pnodes.clear();
        int node = 0;
        while (true) {
            Node& nd = t.nodes[node];
            if (nd.s.winner >= 0) { t.leaf = node; backup(t, terminal_value(nd.s)); break; }
            if (nd.e0 < 0) { t.leaf = node; return true; }
            float sq = std::sqrt((float)std::max(nd.n, 1));
            float fpu_q = (nd.n > 0 ? nd.w / nd.n : 0.0f) - P.fpu;
            int best = -1; float bs = -1e30f;
            for (int i = 0; i < nd.ne; i++) {
                const Edge& e = t.edges[nd.e0 + i];
                float q = e.n > 0 ? e.w / e.n : fpu_q;
                float sc = q + P.cpuct * e.p * sq / (1 + e.n);
                if (sc > bs) { bs = sc; best = nd.e0 + i; }
            }
            t.path.push_back(best); t.pnodes.push_back(node);
            if (t.edges[best].child < 0) {
                Node ch; ch.s = t.nodes[node].s;
                apply_action(ch.s, t.edges[best].a);
                t.edges[best].child = (int32_t)t.nodes.size();
                t.nodes.push_back(ch);
            }
            node = t.edges[best].child;
        }
    }
    return false;
}

void expand(Slot& t, const float* logits, float value) {
    Node& nd = t.nodes[t.leaf];
    int acts[NA];
    int n = legal_actions(nd.s, acts);
    float pr[NA], mx = -1e30f, sum = 0;
    for (int i = 0; i < n; i++) { pr[i] = logits[acts[i]]; mx = std::max(mx, pr[i]); }
    for (int i = 0; i < n; i++) { pr[i] = std::exp(pr[i] - mx); sum += pr[i]; }
    for (int i = 0; i < n; i++) pr[i] /= sum;
    if (t.leaf == 0 && t.noise_eps > 0) {
        std::gamma_distribution<float> g(t.noise_alpha, 1.0f);
        float nz[NA], ns = 0;
        for (int i = 0; i < n; i++) { nz[i] = g(t.rng) + 1e-10f; ns += nz[i]; }
        for (int i = 0; i < n; i++) pr[i] = (1 - t.noise_eps) * pr[i] + t.noise_eps * nz[i] / ns;
    }
    nd.e0 = (int32_t)t.edges.size(); nd.ne = (int16_t)n;
    for (int i = 0; i < n; i++) t.edges.push_back({(int16_t)acts[i], pr[i], 0, 0.0f, -1});
    backup(t, value);
}

}  // namespace

extern "C" {

void* qp_new(int n, uint64_t seed) {
    Pool* P = new Pool;
    P->slots.resize(n);
    for (int i = 0; i < n; i++) P->slots[i].rng.seed(seed * 1000003ULL + i);
    return P;
}
void qp_free(void* p) { delete (Pool*)p; }
void qp_set_params(void* p, float cpuct, float fpu) { ((Pool*)p)->cpuct = cpuct; ((Pool*)p)->fpu = fpu; }
void qp_reset(void* p, int i) { ((Pool*)p)->slots[i].game = State(); }

// Returns -1 while the game goes on, else 0/1 = winner, 2 = draw.
int qp_step(void* p, int i, int a) {
    State& s = ((Pool*)p)->slots[i].game;
    apply_action(s, a);
    return s.winner;
}

int qp_legal(void* p, int i, uint8_t* mask) {
    int acts[NA];
    int n = legal_actions(((Pool*)p)->slots[i].game, acts);
    memset(mask, 0, NA);
    for (int k = 0; k < n; k++) mask[acts[k]] = 1;
    return n;
}

int qp_turn(void* p, int i) { return ((Pool*)p)->slots[i].game.turn; }

// out: turn, phase, winner, ply, hand0, hand1, then 30 cells (0 empty, 1 = player 0, 2 = player 1)
void qp_state(void* p, int i, int* out) {
    const State& s = ((Pool*)p)->slots[i].game;
    int o[6] = {s.turn, s.phase, s.winner, s.ply, s.hand[0], s.hand[1]};
    memcpy(out, o, sizeof(o));
    for (int k = 0; k < NC; k++) out[6 + k] = ((s.b[0] >> k) & 1) + 2 * ((s.b[1] >> k) & 1);
}

void qp_features(void* p, int i, float* f) { features(((Pool*)p)->slots[i].game, f); }

// Baseline bot: make a three if possible, otherwise a random legal action.
int qp_greedy(void* p, int i) {
    Slot& t = ((Pool*)p)->slots[i];
    int acts[NA], good[NA], ng = 0;
    int n = legal_actions(t.game, acts);
    for (int k = 0; k < n; k++) {
        State s = t.game;
        apply_action(s, acts[k]);
        if (s.phase == CAPTURE || s.winner == t.game.turn) good[ng++] = acts[k];
    }
    if (ng) return good[t.rng() % ng];
    return acts[t.rng() % n];
}

void qp_begin(void* p, int i, int sims, float noise_eps, float noise_alpha) {
    Slot& t = ((Pool*)p)->slots[i];
    t.nodes.clear(); t.edges.clear(); t.path.clear(); t.pnodes.clear();
    Node root; root.s = t.game;
    t.nodes.push_back(root);
    t.target = sims; t.done = 0; t.waiting = false; t.reported = false;
    t.noise_eps = noise_eps; t.noise_alpha = noise_alpha;
}

// Writes leaf features for every slot that needs an evaluation; returns count.
int qp_collect(void* p, float* feats) {
    Pool& P = *(Pool*)p;
    int n = (int)P.slots.size();
    #pragma omp parallel for schedule(dynamic, 8)
    for (int i = 0; i < n; i++) {
        Slot& t = P.slots[i];
        if (t.done < t.target && !t.waiting) t.waiting = descend(P, t);
    }
    P.pending.clear();
    for (int i = 0; i < n; i++) if (P.slots[i].waiting) P.pending.push_back(i);
    int m = (int)P.pending.size();
    for (int k = 0; k < m; k++) {
        Slot& t = P.slots[P.pending[k]];
        features(t.nodes[t.leaf].s, feats + (size_t)k * FEAT);
    }
    return m;
}

void qp_apply(void* p, const float* logits, const float* values) {
    Pool& P = *(Pool*)p;
    int m = (int)P.pending.size();
    #pragma omp parallel for schedule(dynamic, 8)
    for (int k = 0; k < m; k++) {
        Slot& t = P.slots[P.pending[k]];
        expand(t, logits + (size_t)k * NA, values[k]);
        t.waiting = false;
    }
    P.pending.clear();
}

// Slots whose search just completed (each reported once).
int qp_finished(void* p, int* out) {
    Pool& P = *(Pool*)p;
    int m = 0;
    for (int i = 0; i < (int)P.slots.size(); i++) {
        Slot& t = P.slots[i];
        if (!t.reported && t.done >= t.target && !t.waiting) { t.reported = true; out[m++] = i; }
    }
    return m;
}

// Root visit counts and mean action values (root player's view) per action.
// Returns the root value.
float qp_result(void* p, int i, float* visits, float* q) {
    const Slot& t = ((Pool*)p)->slots[i];
    const Node& r = t.nodes[0];
    memset(visits, 0, sizeof(float) * NA);
    if (q) memset(q, 0, sizeof(float) * NA);
    for (int k = 0; k < r.ne; k++) {
        const Edge& e = t.edges[r.e0 + k];
        visits[e.a] = (float)e.n;
        if (q) q[e.a] = e.n > 0 ? e.w / e.n : 0.0f;
    }
    return r.n > 0 ? r.w / r.n : 0.0f;
}

}  // extern "C"
