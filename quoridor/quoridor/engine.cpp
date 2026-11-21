// Quoridor rules + batched PUCT Monte-Carlo tree search.
//
// The search never calls a neural network itself.  Instead it runs many
// independent searches ("slots") in lock-step:
//
//   qp_collect()  walks every active tree down to a leaf and writes that
//                 leaf's feature planes into one big batch;
//   qp_apply()    takes the evaluator's (policy logits, value) for the batch,
//                 expands the leaves and backs the values up.
//
// Python sits in the middle and evaluates the batch with whatever it likes
// (a PyTorch net, a hand-written heuristic, ...).
//
// Board: 9x9 cells, cell = r*9+c.  Player 0 starts at row 8 and wins on row 0;
// player 1 starts at row 0 and wins on row 8.  Wall slots form an 8x8 grid,
// slot (r,c) sits at the corner shared by cells (r,c),(r,c+1),(r+1,c),(r+1,c+1).
//
// Actions (absolute): 0..80 move pawn to that cell, 81..144 horizontal wall at
// slot a-81, 145..208 vertical wall at slot a-145.
// The network always sees the board from the side to move ("canonical": the
// mover walks towards row 0); for player 1 that is a vertical flip.

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <random>
#include <vector>

namespace {

const int N = 9, NC = 81, NA = 209, NP = 10, FEAT = NP * NC;
enum { DN = 1, DS = 2, DW = 4, DE = 8 };
const int DR[4] = {-1, 1, 0, 0}, DCc[4] = {0, 0, -1, 1};

struct State {
    uint64_t hw = 0, vw = 0;
    uint8_t pos[2] = {76, 4};
    uint8_t walls[2] = {10, 10};
    uint8_t turn = 0;
    int8_t winner = -1;
    uint16_t ply = 0;
};

inline bool H(const State& s, int r, int c) {
    return r >= 0 && r < 8 && c >= 0 && c < 8 && ((s.hw >> (r * 8 + c)) & 1);
}
inline bool V(const State& s, int r, int c) {
    return r >= 0 && r < 8 && c >= 0 && c < 8 && ((s.vw >> (r * 8 + c)) & 1);
}

// adj[cell] = bitmask of directions a pawn can step in (ignoring pawns).
void build_adj(const State& s, uint8_t* adj) {
    for (int r = 0; r < N; r++)
        for (int c = 0; c < N; c++) {
            uint8_t m = 0;
            if (r > 0 && !H(s, r - 1, c) && !H(s, r - 1, c - 1)) m |= DN;
            if (r < 8 && !H(s, r, c) && !H(s, r, c - 1)) m |= DS;
            if (c > 0 && !V(s, r, c - 1) && !V(s, r - 1, c - 1)) m |= DW;
            if (c < 8 && !V(s, r, c) && !V(s, r - 1, c)) m |= DE;
            adj[r * N + c] = m;
        }
}

const int8_t UNREACH = 99;

// Distance from every cell to player p's goal row.
void dist_map(const uint8_t* adj, int p, int8_t* d) {
    uint8_t q[NC];
    int qh = 0, qt = 0;
    memset(d, UNREACH, NC);
    int gr = p == 0 ? 0 : 8;
    for (int c = 0; c < N; c++) { d[gr * N + c] = 0; q[qt++] = gr * N + c; }
    while (qh < qt) {
        int u = q[qh++], r = u / N, c = u % N;
        for (int k = 0; k < 4; k++)
            if (adj[u] & (1 << k)) {
                int v = (r + DR[k]) * N + c + DCc[k];
                if (d[v] == UNREACH) { d[v] = d[u] + 1; q[qt++] = v; }
            }
    }
}

bool reachable(const uint8_t* adj, int from, int p) {
    uint8_t q[NC];
    bool seen[NC] = {false};
    int qh = 0, qt = 0, gr = p == 0 ? 0 : 8;
    q[qt++] = from; seen[from] = true;
    while (qh < qt) {
        int u = q[qh++], r = u / N, c = u % N;
        if (r == gr) return true;
        for (int k = 0; k < 4; k++)
            if (adj[u] & (1 << k)) {
                int v = (r + DR[k]) * N + c + DCc[k];
                if (!seen[v]) { seen[v] = true; q[qt++] = v; }
            }
    }
    return false;
}

int pawn_moves(const State& s, const uint8_t* adj, int* out) {
    int n = 0, me = s.pos[s.turn], opp = s.pos[1 - s.turn];
    for (int k = 0; k < 4; k++) {
        if (!(adj[me] & (1 << k))) continue;
        int v = me + DR[k] * N + DCc[k];
        if (v != opp) { out[n++] = v; continue; }
        if (adj[opp] & (1 << k)) {                 // straight jump
            out[n++] = opp + DR[k] * N + DCc[k];
        } else {                                   // wall/edge behind: diagonal
            for (int e = 0; e < 4; e++) {
                if ((e >> 1) == (k >> 1)) continue;  // same axis
                if (adj[opp] & (1 << e)) out[n++] = opp + DR[e] * N + DCc[e];
            }
        }
    }
    return n;
}

// Which (cell, direction) steps does a wall remove?
inline void wall_cuts(bool horiz, int r, int c, int cells[4], uint8_t dirs[4]) {
    if (horiz) {
        cells[0] = r * N + c; cells[1] = r * N + c + 1; dirs[0] = dirs[1] = DS;
        cells[2] = (r + 1) * N + c; cells[3] = (r + 1) * N + c + 1; dirs[2] = dirs[3] = DN;
    } else {
        cells[0] = r * N + c; cells[1] = (r + 1) * N + c; dirs[0] = dirs[1] = DE;
        cells[2] = r * N + c + 1; cells[3] = (r + 1) * N + c + 1; dirs[2] = dirs[3] = DW;
    }
}

// Fills out[] with absolute action ids, returns count.
int legal_actions(const State& s, int* out) {
    if (s.winner >= 0) return 0;
    uint8_t adj[NC];
    build_adj(s, adj);
    int n = pawn_moves(s, adj, out);
    if (s.walls[s.turn] == 0) return n;

    // One shortest path per player.  A wall that does not cut that path
    // cannot disconnect the player, so only path-cutting walls need a BFS.
    uint8_t onpath[2][NC];
    memset(onpath, 0, sizeof(onpath));
    for (int p = 0; p < 2; p++) {
        int8_t d[NC];
        dist_map(adj, p, d);
        int u = s.pos[p];
        while (d[u] > 0) {
            for (int k = 0; k < 4; k++)
                if (adj[u] & (1 << k)) {
                    int v = u + DR[k] * N + DCc[k];
                    if (d[v] == d[u] - 1) {
                        onpath[p][u] |= (1 << k);
                        onpath[p][v] |= (1 << (k ^ 1));
                        u = v;
                        break;
                    }
                }
        }
    }
    uint64_t occ = s.hw | s.vw;
    for (int horiz = 1; horiz >= 0; horiz--)
        for (int r = 0; r < 8; r++)
            for (int c = 0; c < 8; c++) {
                if ((occ >> (r * 8 + c)) & 1) continue;
                if (horiz) { if (H(s, r, c - 1) || H(s, r, c + 1)) continue; }
                else       { if (V(s, r - 1, c) || V(s, r + 1, c)) continue; }
                int cells[4]; uint8_t dirs[4];
                wall_cuts(horiz, r, c, cells, dirs);
                bool ok = true;
                for (int p = 0; p < 2 && ok; p++) {
                    bool cut = false;
                    for (int i = 0; i < 4; i++) cut |= (onpath[p][cells[i]] & dirs[i]) != 0;
                    if (!cut) continue;
                    uint8_t a2[NC];
                    memcpy(a2, adj, NC);
                    for (int i = 0; i < 4; i++) a2[cells[i]] &= ~dirs[i];
                    ok = reachable(a2, s.pos[p], p);
                }
                if (ok) out[n++] = (horiz ? 81 : 145) + r * 8 + c;
            }
    return n;
}

void apply_action(State& s, int a) {
    if (a < 81) {
        s.pos[s.turn] = a;
        if ((s.turn == 0 && a / N == 0) || (s.turn == 1 && a / N == 8)) s.winner = s.turn;
    } else if (a < 145) {
        s.hw |= 1ULL << (a - 81); s.walls[s.turn]--;
    } else {
        s.vw |= 1ULL << (a - 145); s.walls[s.turn]--;
    }
    s.turn ^= 1;
    s.ply++;
}

// Absolute <-> canonical action (an involution).
inline int canon(int a, int turn) {
    if (turn == 0) return a;
    if (a < 81) return (8 - a / N) * N + a % N;
    int base = a < 145 ? 81 : 145, sl = a - base;
    return base + (7 - sl / 8) * 8 + sl % 8;
}

void features(const State& s, float* f, int* dists = nullptr) {
    memset(f, 0, sizeof(float) * FEAT);
    uint8_t adj[NC];
    build_adj(s, adj);
    int me = s.turn, op = 1 - me;
    bool flip = me == 1;
    int8_t dm[2][NC];
    dist_map(adj, 0, dm[0]);
    dist_map(adj, 1, dm[1]);
    auto cc = [&](int cell) { return flip ? (8 - cell / N) * N + cell % N : cell; };
    f[0 * NC + cc(s.pos[me])] = 1;
    f[1 * NC + cc(s.pos[op])] = 1;
    for (int r = 0; r < 8; r++)
        for (int c = 0; c < 8; c++) {
            int rr = flip ? 7 - r : r;
            if ((s.hw >> (r * 8 + c)) & 1) f[2 * NC + rr * N + c] = 1;
            if ((s.vw >> (r * 8 + c)) & 1) f[3 * NC + rr * N + c] = 1;
        }
    float dme = dm[me][s.pos[me]] / 20.0f, dop = dm[op][s.pos[op]] / 20.0f;
    for (int i = 0; i < NC; i++) {
        f[4 * NC + i] = s.walls[me] / 10.0f;
        f[5 * NC + i] = s.walls[op] / 10.0f;
        f[6 * NC + cc(i)] = std::min<int>(dm[me][i], 60) / 20.0f;
        f[7 * NC + cc(i)] = std::min<int>(dm[op][i], 60) / 20.0f;
        f[8 * NC + i] = dme;
        f[9 * NC + i] = dop;
    }
    if (dists) { dists[0] = dm[0][s.pos[0]]; dists[1] = dm[1][s.pos[1]]; }
}

// ---------------------------------------------------------------- search --

struct Edge { int16_t a; float p; int32_t n; float w; int32_t child; };
struct Node { State s; int32_t n = 0; float w = 0; int32_t e0 = -1; int16_t ne = 0; };

struct Slot {
    State game;
    std::vector<Node> nodes;
    std::vector<Edge> edges;
    std::vector<int32_t> path;   // edge indices root->leaf
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

void backup(Slot& t, float v) {  // v: value for the player to move at the leaf
    // Node sums are from that node's mover's view, edge sums from the view
    // of the player who chose the edge.
    t.nodes[t.leaf].n++; t.nodes[t.leaf].w += v;
    for (int i = (int)t.path.size() - 1; i >= 0; i--) {
        v = -v;
        Edge& e = t.edges[t.path[i]];
        e.n++; e.w += v;
        int parent = i == 0 ? 0 : t.edges[t.path[i - 1]].child;
        t.nodes[parent].n++; t.nodes[parent].w += v;
    }
    t.done++;
}

// Descend until a leaf that needs the evaluator (returns true) or the
// simulation budget is used up (returns false).
bool descend(const Pool& P, Slot& t) {
    while (t.done < t.target) {
        t.path.clear();
        int node = 0;
        while (true) {
            Node& nd = t.nodes[node];
            if (nd.s.winner >= 0) {            // terminal: mover already lost
                t.leaf = node; backup(t, -1.0f); break;
            }
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
            t.path.push_back(best);
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
    for (int i = 0; i < n; i++) { pr[i] = logits[canon(acts[i], nd.s.turn)]; mx = std::max(mx, pr[i]); }
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

// Returns winner (0/1) or -1 if the game goes on.
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

// out: pos0,pos1,walls0,walls1,turn,winner,ply,dist0,dist1 then 64 h, 64 v.
void qp_state(void* p, int i, int* out) {
    const State& s = ((Pool*)p)->slots[i].game;
    float f[FEAT]; int d[2];
    features(s, f, d);
    int o[9] = {s.pos[0], s.pos[1], s.walls[0], s.walls[1], s.turn, s.winner, s.ply, d[0], d[1]};
    memcpy(out, o, sizeof(o));
    for (int k = 0; k < 64; k++) { out[9 + k] = (s.hw >> k) & 1; out[73 + k] = (s.vw >> k) & 1; }
}

void qp_features(void* p, int i, float* f) { features(((Pool*)p)->slots[i].game, f); }

// Pawn move that follows the shortest path (baseline bot).
int qp_greedy(void* p, int i) {
    const State& s = ((Pool*)p)->slots[i].game;
    uint8_t adj[NC]; int8_t d[NC]; int mv[8];
    build_adj(s, adj);
    dist_map(adj, s.turn, d);
    int n = pawn_moves(s, adj, mv), best = mv[0];
    for (int k = 1; k < n; k++) if (d[mv[k]] < d[best]) best = mv[k];
    return best;
}

void qp_begin(void* p, int i, int sims, float noise_eps, float noise_alpha) {
    Slot& t = ((Pool*)p)->slots[i];
    t.nodes.clear(); t.edges.clear(); t.path.clear();
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
    #pragma omp parallel for schedule(dynamic, 8)
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

// Root visit counts and mean action values (root player's view), indexed by
// absolute action, or canonical action if canonical != 0.  Returns root value.
float qp_result(void* p, int i, float* visits, float* q, int canonical) {
    const Slot& t = ((Pool*)p)->slots[i];
    const Node& r = t.nodes[0];
    memset(visits, 0, sizeof(float) * NA);
    if (q) memset(q, 0, sizeof(float) * NA);
    for (int k = 0; k < r.ne; k++) {
        const Edge& e = t.edges[r.e0 + k];
        int a = canonical ? canon(e.a, r.s.turn) : e.a;
        visits[a] = (float)e.n;
        if (q) q[a] = e.n > 0 ? e.w / e.n : 0.0f;
    }
    return r.n > 0 ? r.w / r.n : 0.0f;
}

int qp_canon(int a, int turn) { return canon(a, turn); }

}  // extern "C"
