// Toy Battle rules + batched PUCT tree search over sampled "what the opponent might hold" worlds.
//
// Troop type = strength: 0 Kwak (joker), 1 Skully, 2 Cap'n, 3 Jumbo, 4 Hook, 5 XB-42, 6 Star, 7 Roxy.
// Player 0 is Blue, player 1 is Red.  A tile is (owner << 3) | type.
//
// Actions (161):  0 draw two        1 skip an optional effect
//                 2 + type*17 + slot   place a troop; slot 0-14 = base, 15-16 = enemy H.Q.
//                 138 + base           pick a base (Jumbo target, troop to take back, troop to move, where to)
//                 153 + type           pick a troop type from the own discard (Cursed Cemetery)
//
// Hidden information.  A player's unseen own tiles (face-down reserve + the 4 boxed ones) are kept
// as one multiset `pool`: drawing a uniformly random tile from it has exactly the distribution of
// drawing from a shuffled reserve.  The opponent's rack is hidden; before each search the engine
// re-deals it from everything the searching player cannot see (determinize), and the search result
// is the sum over several such deals.  Inside one deal all chance (draws, XB-42, sniper) is fixed
// by the random state carried in the game state, so each tree is an ordinary deterministic game.
// Features only ever contain what the player to move may know.

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <random>
#include <vector>

namespace {

const int MB = 15, MR = 14, NT = 8, NA = 161, MAXH = 12, MAXTURN = 200, MAXPLACED = 6;
const int A_DRAW = 0, A_SKIP = 1, A_PLACE = 2, A_BASE = 138, A_TYPE = 153;
const int FB = 48, FG = 96, FEAT = MB * FB + FG;
enum { MAIN, EXTRA, JUMBO, RECALL, ERUPT_SRC, ERUPT_DST, EXHUME };
enum { E_NONE, E_RECALL, E_GATE, E_DRAW, E_ERUPT, E_EXHUME, E_SHIELD, E_SNIPER };

struct Terrain {
    int nb, effect, objective, nreg;
    uint16_t adj[MB]; uint8_t special[MB], gate[MB];
    int nhq[2]; uint16_t hqadj[2][2]; uint8_t hqgate[2][2];
    uint16_t reg[MR]; uint8_t regmed[MR];
    uint8_t dist[2][MB]; uint16_t allhq[2];
};
Terrain TER[8];

struct State {
    uint8_t ter = 0, turn = 0, phase = MAIN;
    int8_t winner = -1;                 // -1 running, 0/1 winner, 2 draw
    uint8_t h[MB] = {0};
    uint8_t st[MB][MAXH];
    uint8_t rack[2][NT] = {{0}}, pool[2][NT] = {{0}}, disc[2][NT] = {{0}}, known[2][NT] = {{0}};
    uint8_t reserve[2] = {0, 0}, medals[2] = {0, 0}, pin[2] = {0, 0};   // pin = type + 1
    uint8_t placed[MAXPLACED], nplaced = 0, qi = 0, src = 0;
    uint16_t taken = 0, nturn = 0;
    uint32_t rng = 1;
};

inline uint32_t rnd(State& s) { s.rng ^= s.rng << 13; s.rng ^= s.rng >> 17; s.rng ^= s.rng << 5; return s.rng; }
inline int owner(const State& s, int b) { return s.h[b] ? s.st[b][s.h[b] - 1] >> 3 : -1; }
inline int type(const State& s, int b) { return s.st[b][s.h[b] - 1] & 7; }
inline int total(const uint8_t* c) { int n = 0; for (int t = 0; t < NT; t++) n += c[t]; return n; }
inline bool covers(int mine, int theirs) { return mine == 0 || theirs == 0 || mine > theirs; }
inline uint16_t occupied(const State& s, int p) {
    uint16_t m = 0;
    for (int b = 0; b < TER[s.ter].nb; b++) if (owner(s, b) == p) m |= 1 << b;
    return m;
}
// conn = bases p occupies that are linked to one of p's H.Q.; range = bases p may place on.
void reach(const State& s, int p, uint16_t& conn, uint16_t& range) {
    const Terrain& T = TER[s.ter];
    uint16_t occ = occupied(s, p), front = T.allhq[p] & occ;
    conn = 0; range = T.allhq[p];
    while (front) {
        int b = __builtin_ctz(front); front &= front - 1;
        conn |= 1 << b; range |= T.adj[b];
        front |= T.adj[b] & occ & ~conn;
    }
}
inline bool can_place(const State& s, int p, int t, int b, uint16_t range) {
    const Terrain& T = TER[s.ter];
    if (s.h[b] >= MAXH || !((T.gate[b] >> t) & 1)) return false;
    int o = owner(s, b);
    if (o == 1 - p && !covers(t, type(s, b))) return false;
    if ((range >> b) & 1) return true;
    return t == 4 && !(T.effect == E_SHIELD && T.special[b]);     // Hook jumps, unless its effect is shielded
}
inline int available(const State& s, int p, int t) { return s.rack[p][t] - (s.pin[p] == t + 1); }

int placements(const State& s, int* out) {
    const Terrain& T = TER[s.ter];
    int me = s.turn, n = 0;
    uint16_t conn, range;
    reach(s, me, conn, range);
    for (int t = 0; t < NT; t++) {
        if (available(s, me, t) <= 0) continue;
        for (int b = 0; b < T.nb; b++) if (can_place(s, me, t, b, range)) out[n++] = A_PLACE + t * 17 + b;
        for (int k = 0; k < T.nhq[1 - me]; k++)
            if ((T.hqadj[1 - me][k] & conn) && ((T.hqgate[1 - me][k] >> t) & 1)) out[n++] = A_PLACE + t * 17 + 15 + k;
    }
    return n;
}
inline bool can_draw(const State& s, int p) { return s.reserve[p] > 0 && total(s.rack[p]) < 8; }

int legal_actions(const State& s, int* out) {
    if (s.winner >= 0) return 0;
    const Terrain& T = TER[s.ter];
    int me = s.turn, n = 0;
    switch (s.phase) {
    case MAIN:
        if (can_draw(s, me)) out[n++] = A_DRAW;
        n += placements(s, out + n);
        break;
    case EXTRA:
        out[n++] = A_SKIP;
        n += placements(s, out + n);
        break;
    case JUMBO: case ERUPT_SRC:
        out[n++] = A_SKIP;
        for (int b = 0; b < T.nb; b++)
            if (((T.adj[s.src] >> b) & 1) && owner(s, b) == 1 - me) {
                bool ok = s.phase == JUMBO;
                for (int c = 0; c < T.nb && !ok; c++) ok = ((T.adj[b] >> c) & 1) && s.h[c] < MAXH;
                if (ok) out[n++] = A_BASE + b;
            }
        break;
    case RECALL:
        out[n++] = A_SKIP;
        for (int b = 0; b < T.nb; b++) if (b != s.src && owner(s, b) == me) out[n++] = A_BASE + b;
        break;
    case ERUPT_DST:
        for (int b = 0; b < T.nb; b++) if (((T.adj[s.src] >> b) & 1) && s.h[b] < MAXH) out[n++] = A_BASE + b;
        break;
    case EXHUME:
        out[n++] = A_SKIP;
        for (int t = 0; t < NT; t++) if (s.disc[me][t]) out[n++] = A_TYPE + t;
        break;
    }
    return n;
}

int pick(State& s, const uint8_t* counts) {       // a uniformly random tile of a multiset
    int n = total(counts);
    int r = rnd(s) % n;
    for (int t = 0; t < NT; t++) { if (r < counts[t]) return t; r -= counts[t]; }
    return 0;
}
void draw(State& s, int p, int n) {
    for (int k = 0; k < n && can_draw(s, p); k++) {
        int t = pick(s, s.pool[p]);
        s.pool[p][t]--; s.rack[p][t]++; s.reserve[p]--;
    }
}
void lose_from_rack(State& s, int p, int t) {
    s.rack[p][t]--;
    if (s.known[p][t] > s.rack[p][t]) s.known[p][t] = s.rack[p][t];
    if (s.pin[p] == t + 1 && s.rack[p][t] == 0) s.pin[p] = 0;
}

// Checked after every change of the board, the player to move first.
void check_regions(State& s) {
    const Terrain& T = TER[s.ter];
    for (int k = 0; k < 2; k++) {
        int p = k ? 1 - s.turn : s.turn;
        uint16_t occ = occupied(s, p);
        for (int r = 0; r < T.nreg; r++)
            if (!((s.taken >> r) & 1) && (T.reg[r] & occ) == T.reg[r]) { s.taken |= 1 << r; s.medals[p] += T.regmed[r]; }
        if (s.winner < 0 && s.medals[p] >= T.objective) s.winner = p;
    }
}

void end_turn(State& s) {
    s.pin[s.turn] = 0;
    s.phase = MAIN; s.nplaced = s.qi = 0;
    s.turn ^= 1; s.nturn++;
    int a = s.medals[0], b = s.medals[1];
    if (s.nturn >= MAXTURN) { s.winner = a > b ? 0 : b > a ? 1 : 2; return; }
    int tmp[NA];
    if (legal_actions(s, tmp) == 0)       // cannot draw or place: most medals wins, the stuck player loses a tie
        s.winner = a > b ? 0 : b > a ? 1 : 1 - s.turn;
}

// Special bases of this turn, in placement order, after all troop effects.
void advance(State& s) {
    const Terrain& T = TER[s.ter];
    int me = s.turn, op = 1 - me;
    s.phase = MAIN;
    while (s.qi < s.nplaced) {
        int b = s.placed[s.qi++];
        if (!T.special[b] || owner(s, b) != me) continue;
        int tmp[NA];
        switch (T.effect) {
        case E_DRAW: draw(s, me, 1); break;
        case E_RECALL: case E_ERUPT: case E_EXHUME:
            if (T.effect != E_ERUPT && total(s.rack[me]) >= 8) break;
            s.phase = T.effect == E_RECALL ? RECALL : T.effect == E_ERUPT ? ERUPT_SRC : EXHUME; s.src = b;
            if (legal_actions(s, tmp) > 1) return;
            s.phase = MAIN;
            break;
        case E_SNIPER:
            if (!s.pin[op] && total(s.rack[op]) > 0) s.pin[op] = pick(s, s.rack[op]) + 1;
            break;
        }
    }
    end_turn(s);
}

void place(State& s, int t, int slot) {
    const Terrain& T = TER[s.ter];
    int me = s.turn, op = 1 - me;
    lose_from_rack(s, me, t);
    if (slot >= 15) { s.winner = me; return; }
    s.st[slot][s.h[slot]++] = (me << 3) | t;
    if (s.nplaced < MAXPLACED) s.placed[s.nplaced++] = slot;
    check_regions(s);
    if (s.winner >= 0) return;
    if (!(T.effect == E_SHIELD && T.special[slot])) {
        int tmp[NA];
        switch (t) {
        case 1: draw(s, me, 2); break;
        case 6: draw(s, me, 1); break;
        case 5:
            if (total(s.rack[op]) > 0) { int x = pick(s, s.rack[op]); lose_from_rack(s, op, x); s.disc[op][x]++; }
            break;
        case 2: case 3:
            s.phase = t == 2 ? EXTRA : JUMBO; s.src = slot;
            if (legal_actions(s, tmp) > 1) return;
            break;
        }
    }
    advance(s);
}

void apply_action(State& s, int a) {
    int me = s.turn, op = 1 - me;
    if (a == A_DRAW) { draw(s, me, 2); end_turn(s); return; }
    if (a == A_SKIP) { advance(s); return; }
    if (a < A_BASE) { place(s, (a - A_PLACE) / 17, (a - A_PLACE) % 17); return; }
    if (a >= A_TYPE) {
        int t = a - A_TYPE;
        s.disc[me][t]--; s.rack[me][t]++; s.known[me][t]++;
        advance(s); return;
    }
    int b = a - A_BASE;
    if (s.phase == ERUPT_SRC) { s.src = b; s.phase = ERUPT_DST; return; }
    if (s.phase == JUMBO) { s.disc[op][type(s, b)]++; s.h[b]--; }
    else if (s.phase == RECALL) { int t = type(s, b); s.h[b]--; s.rack[me][t]++; s.known[me][t]++; }
    else { s.st[b][s.h[b]++] = s.st[s.src][s.h[s.src] - 1]; s.h[s.src]--; }
    check_regions(s);
    if (s.winner < 0) advance(s);
}

void new_game(State& s, int ter, int first, uint32_t seed) {
    s = State();
    s.ter = ter; s.turn = first; s.rng = seed * 2654435761u + 12345u;
    if (!s.rng) s.rng = 1;
    for (int k = 0; k < 8; k++) rnd(s);
    for (int p = 0; p < 2; p++) {
        for (int t = 0; t < NT; t++) s.pool[p][t] = 3;
        s.reserve[p] = 20;
        draw(s, p, p == first ? 3 : 4);
    }
}

// Re-deal everything `pov` cannot see: the opponent's rack (and which of its troops is pinned).
void determinize(State& s, int pov, std::mt19937& g) {
    int op = 1 - pov, n = total(s.rack[op]) - total(s.known[op]);
    s.rng = g() | 1;
    for (int t = 0; t < NT; t++) { s.pool[op][t] += s.rack[op][t] - s.known[op][t]; s.rack[op][t] = s.known[op][t]; }
    for (int k = 0; k < n; k++) { int t = pick(s, s.pool[op]); s.pool[op][t]--; s.rack[op][t]++; }
    if (s.pin[op]) s.pin[op] = pick(s, s.rack[op]) + 1;
}

void features(const State& s, float* f) {
    memset(f, 0, sizeof(float) * FEAT);
    const Terrain& T = TER[s.ter];
    int me = s.turn, op = 1 - me;
    uint16_t conn[2], range[2], occ[2];
    reach(s, me, conn[0], range[0]); reach(s, op, conn[1], range[1]);
    occ[0] = occupied(s, me); occ[1] = occupied(s, op);
    float gain[2][MB] = {{0}}, open[MB] = {0};
    for (int r = 0; r < T.nreg; r++) {
        if ((s.taken >> r) & 1) continue;
        for (int b = 0; b < T.nb; b++) {
            if (!((T.reg[r] >> b) & 1)) continue;
            open[b] += T.regmed[r];
            uint16_t rest = T.reg[r] & ~(1 << b);
            for (int k = 0; k < 2; k++) if ((rest & occ[k]) == rest) gain[k][b] += T.regmed[r];
        }
    }
    for (int b = 0; b < T.nb; b++) {
        float* x = f + b * FB;
        int o = owner(s, b);
        x[0] = 1; x[1] = T.special[b];
        if (o < 0) x[4] = 1;
        else {
            x[o == me ? 2 : 3] = 1; x[5 + type(s, b)] = 1;
            x[13] = s.h[b] / 4.0f;
            if (s.h[b] > 1) { int u = s.st[b][s.h[b] - 2]; x[(u >> 3) == me ? 14 : 15] = 1; x[16] = (u & 7) / 7.0f; }
            for (int i = 0; i < s.h[b]; i++) x[(s.st[b][i] >> 3) == me ? 17 : 18] += 0.25f;
        }
        for (int k = 0; k < 2; k++) {
            int p = k ? op : me;
            x[19 + k] = (conn[k] >> b) & 1; x[21 + k] = (range[k] >> b) & 1;
            x[23 + k] = (T.allhq[p] >> b) & 1; x[25 + k] = T.dist[p][b] / 6.0f;
            x[35 + k] = gain[k][b] / 3.0f;
        }
        for (int t = 0; t < NT; t++) { x[27 + t] = (T.gate[b] >> t) & 1; x[40 + t] = can_place(s, me, t, b, range[0]); }
        x[37] = open[b] / 6.0f;
        x[38] = s.phase != MAIN && s.phase != EXHUME && s.src == b;
        for (int i = s.qi; i < s.nplaced; i++) if (s.placed[i] == b && T.special[b]) x[39] = 1;
    }
    float* g = f + MB * FB;
    g[s.ter] = 1; g[8 + s.phase] = 1;
    g[15] = s.medals[me] / 8.0f; g[16] = s.medals[op] / 8.0f; g[17] = T.objective / 8.0f;
    g[18] = total(s.rack[me]) / 8.0f; g[19] = total(s.rack[op]) / 8.0f;
    g[20] = s.reserve[me] / 20.0f; g[21] = s.reserve[op] / 20.0f;
    for (int t = 0; t < NT; t++) {
        g[22 + t] = s.rack[me][t] / 3.0f; g[38 + t] = s.disc[me][t] / 3.0f; g[46 + t] = s.disc[op][t] / 3.0f;
        g[54 + t] = s.pool[me][t] / 3.0f; g[62 + t] = (s.rack[op][t] + s.pool[op][t]) / 3.0f;
        g[70 + t] = s.known[op][t] / 3.0f;
    }
    if (s.pin[me]) g[30 + s.pin[me] - 1] = 1;
    g[78] = s.nturn / (float)MAXTURN; g[79] = can_draw(s, me);
    for (int k = 0; k < T.nhq[op]; k++) g[80 + k] = (T.hqadj[op][k] & conn[0]) != 0;
    g[82] = s.pin[op] != 0; g[83] = T.nhq[me] == 2; g[84] = T.nhq[op] == 2;
    g[85] = (s.medals[me] - s.medals[op]) / (float)T.objective;
    g[86] = __builtin_popcount(occ[0]) / 15.0f; g[87] = __builtin_popcount(occ[1]) / 15.0f;
    for (int k = 0; k < T.nhq[me]; k++) g[88 + k] = (T.hqadj[me][k] & conn[1]) != 0;   // my H.Q. under threat
}

inline float terminal_value(const State& s) { return s.winner == 2 ? 0.0f : (s.winner == s.turn ? 1.0f : -1.0f); }

// ---------------------------------------------------------------- search --

struct Edge { int16_t a; float p; int32_t n; float w; int32_t child; };
struct Node { State s; int32_t n = 0; float w = 0; int32_t e0 = -1; int16_t ne = 0; };

struct Slot {
    State game;
    std::vector<Node> nodes;
    std::vector<Edge> edges;
    std::vector<int32_t> path, pnodes;
    int target = 0, done = 0, leaf = -1, deals = 0;
    bool waiting = false, reported = true;
    float noise_eps = 0, noise_alpha = 0.3f;
    float visits[NA], qsum[NA], vsum; int vn;      // summed over the deals of this search
    std::vector<State> preset;                     // if set: the deals to search, instead of random re-deals
    std::mt19937 rng;
};

struct Pool {
    std::vector<Slot> slots;
    std::vector<int> pending;
    float cpuct = 1.5f, fpu = 0.25f;
};

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

void start_deal(Slot& t) {
    t.nodes.clear(); t.edges.clear(); t.path.clear(); t.pnodes.clear();
    Node root; root.s = t.game;
    if (t.preset.empty()) determinize(root.s, t.game.turn, t.rng);
    else { root.s = t.preset[(t.deals - 1) % t.preset.size()]; root.s.rng = t.rng() | 1; }   // future chance stays unknown
    t.nodes.push_back(root);
    t.done = 0;
}
void bank_deal(Slot& t) {
    const Node& r = t.nodes[0];
    for (int k = 0; k < r.ne; k++) {
        const Edge& e = t.edges[r.e0 + k];
        t.visits[e.a] += e.n; t.qsum[e.a] += e.w;
    }
    t.vsum += r.w; t.vn += r.n;
}

}  // namespace

extern "C" {

int tb_sizes(int* out) { out[0] = NA; out[1] = FB; out[2] = FG; out[3] = MAXTURN; out[4] = MAXH; return 0; }

void tb_set_terrain(int k, const int* a) {
    Terrain& T = TER[k];
    T.nb = a[0]; T.effect = a[1]; T.objective = a[2]; T.nreg = a[3];
    a += 4;
    for (int i = 0; i < MB; i++) { T.adj[i] = a[0]; T.special[i] = a[1]; T.gate[i] = a[2]; a += 3; }
    for (int p = 0; p < 2; p++) {
        T.nhq[p] = *a++; T.allhq[p] = 0;
        for (int j = 0; j < 2; j++) { T.hqadj[p][j] = a[0]; T.hqgate[p][j] = a[1]; T.allhq[p] |= a[0]; a += 2; }
    }
    for (int i = 0; i < MR; i++) { T.reg[i] = a[0]; T.regmed[i] = a[1]; a += 2; }
    for (int p = 0; p < 2; p++) {           // paths from each base to the nearest H.Q. of p
        for (int b = 0; b < MB; b++) T.dist[p][b] = (T.allhq[p] >> b) & 1 ? 1 : 99;
        for (int it = 0; it < MB; it++)
            for (int b = 0; b < T.nb; b++)
                for (int c = 0; c < T.nb; c++)
                    if (((T.adj[b] >> c) & 1) && T.dist[p][c] + 1 < T.dist[p][b]) T.dist[p][b] = T.dist[p][c] + 1;
    }
}

void* tb_new(int n, uint64_t seed) {
    Pool* P = new Pool;
    P->slots.resize(n);
    for (int i = 0; i < n; i++) P->slots[i].rng.seed(seed * 1000003ULL + i);
    return P;
}
void tb_free(void* p) { delete (Pool*)p; }
void tb_set_params(void* p, float cpuct, float fpu) { ((Pool*)p)->cpuct = cpuct; ((Pool*)p)->fpu = fpu; }
void tb_reset(void* p, int i, int ter, int first) {
    Slot& t = ((Pool*)p)->slots[i];
    new_game(t.game, ter, first, t.rng());
}
int tb_step(void* p, int i, int a) {
    State& s = ((Pool*)p)->slots[i].game;
    apply_action(s, a);
    return s.winner;
}
int tb_legal(void* p, int i, uint8_t* mask) {
    int acts[NA];
    int n = legal_actions(((Pool*)p)->slots[i].game, acts);
    memset(mask, 0, NA);
    for (int k = 0; k < n; k++) mask[acts[k]] = 1;
    return n;
}
int tb_turn(void* p, int i) { return ((Pool*)p)->slots[i].game.turn; }
void tb_features(void* p, int i, float* f) { features(((Pool*)p)->slots[i].game, f); }

// Whole state as int32, and back (tests, the play script, the web export).
const int DUMP = 16 + MB + MB * MAXH + 8 * NT + MAXPLACED;
int tb_dump_size() { return DUMP; }
void tb_get(void* p, int i, int* o) {
    const State& s = ((Pool*)p)->slots[i].game;
    int head[16] = {s.ter, s.turn, s.phase, s.winner, s.nturn, s.medals[0], s.medals[1], s.reserve[0], s.reserve[1],
                    s.taken, s.src, s.pin[0], s.pin[1], s.nplaced, s.qi, (int)s.rng};
    memcpy(o, head, sizeof(head)); o += 16;
    for (int b = 0; b < MB; b++) *o++ = s.h[b];
    for (int b = 0; b < MB; b++) for (int k = 0; k < MAXH; k++) *o++ = k < s.h[b] ? s.st[b][k] : 0;
    for (int q = 0; q < 2; q++) for (int t = 0; t < NT; t++) *o++ = s.rack[q][t];
    for (int q = 0; q < 2; q++) for (int t = 0; t < NT; t++) *o++ = s.pool[q][t];
    for (int q = 0; q < 2; q++) for (int t = 0; t < NT; t++) *o++ = s.disc[q][t];
    for (int q = 0; q < 2; q++) for (int t = 0; t < NT; t++) *o++ = s.known[q][t];
    for (int k = 0; k < MAXPLACED; k++) *o++ = k < s.nplaced ? s.placed[k] : 0;
}
void from_dump(State& s, const int* o) {
    s = State();
    s.ter = o[0]; s.turn = o[1]; s.phase = o[2]; s.winner = o[3]; s.nturn = o[4]; s.medals[0] = o[5]; s.medals[1] = o[6];
    s.reserve[0] = o[7]; s.reserve[1] = o[8]; s.taken = o[9]; s.src = o[10]; s.pin[0] = o[11]; s.pin[1] = o[12];
    s.nplaced = o[13]; s.qi = o[14]; s.rng = (uint32_t)o[15] ? (uint32_t)o[15] : 1; o += 16;
    for (int b = 0; b < MB; b++) s.h[b] = *o++;
    for (int b = 0; b < MB; b++) for (int k = 0; k < MAXH; k++) s.st[b][k] = *o++;
    for (int q = 0; q < 2; q++) for (int t = 0; t < NT; t++) s.rack[q][t] = *o++;
    for (int q = 0; q < 2; q++) for (int t = 0; t < NT; t++) s.pool[q][t] = *o++;
    for (int q = 0; q < 2; q++) for (int t = 0; t < NT; t++) s.disc[q][t] = *o++;
    for (int q = 0; q < 2; q++) for (int t = 0; t < NT; t++) s.known[q][t] = *o++;
    for (int k = 0; k < MAXPLACED; k++) s.placed[k] = *o++;
}
void tb_set(void* p, int i, const int* o) { from_dump(((Pool*)p)->slots[i].game, o); }
// The next searches of game i use these n states (dumps as in tb_get) as their deals; n = 0 goes back to random re-deals.
void tb_preset(void* p, int i, const int* dumps, int n) {
    Slot& t = ((Pool*)p)->slots[i];
    t.preset.resize(n);
    for (int k = 0; k < n; k++) from_dump(t.preset[k], dumps + (size_t)k * DUMP);
}

// One-move-ahead bot: win if possible, else the action that leaves the best medal balance, then the
// most bases held and the shortest way to the enemy H.Q.; ties at random.  It does not peek at draws.
int tb_greedy(void* p, int i) {
    Slot& t = ((Pool*)p)->slots[i];
    int acts[NA], best[NA], nb = 0;
    int n = legal_actions(t.game, acts), me = t.game.turn;
    float bs = -1e30f;
    for (int k = 0; k < n; k++) {
        State s = t.game;
        s.rng = t.rng() | 1;
        apply_action(s, acts[k]);
        float sc;
        if (s.winner == me) sc = 1e6f;
        else if (s.winner == 1 - me) sc = -1e6f;
        else {
            const Terrain& T = TER[s.ter];
            uint16_t conn, range, mine = occupied(s, me), theirs = occupied(s, 1 - me);
            reach(s, me, conn, range);
            int d = 9;
            for (int b = 0; b < T.nb; b++) if ((conn >> b) & 1) d = std::min(d, (int)T.dist[1 - me][b]);
            sc = 100.0f * (s.medals[me] - s.medals[1 - me]) + 3.0f * (__builtin_popcount(mine) - __builtin_popcount(theirs)) - 2.0f * d
                 + 0.5f * total(s.rack[me]);
        }
        if (sc > bs) { bs = sc; nb = 0; }
        if (sc >= bs) best[nb++] = acts[k];
    }
    return best[t.rng() % nb];
}

// sims simulations in each of `deals` re-deals of the hidden tiles.
void tb_begin(void* p, int i, int sims, int deals, float noise_eps, float noise_alpha) {
    Slot& t = ((Pool*)p)->slots[i];
    t.target = sims; t.deals = deals; t.waiting = false; t.reported = false;
    t.noise_eps = noise_eps; t.noise_alpha = noise_alpha;
    memset(t.visits, 0, sizeof(t.visits)); memset(t.qsum, 0, sizeof(t.qsum)); t.vsum = 0; t.vn = 0;
    start_deal(t);
}

int tb_collect(void* p, float* feats) {
    Pool& P = *(Pool*)p;
    int n = (int)P.slots.size();
    #pragma omp parallel for schedule(dynamic, 8)
    for (int i = 0; i < n; i++) {
        Slot& t = P.slots[i];
        while (t.deals > 0 && !t.waiting) {
            t.waiting = descend(P, t);
            if (t.waiting) break;
            bank_deal(t);
            if (--t.deals > 0) start_deal(t);
        }
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

void tb_apply(void* p, const float* logits, const float* values) {
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

int tb_finished(void* p, int* out) {
    Pool& P = *(Pool*)p;
    int m = 0;
    for (int i = 0; i < (int)P.slots.size(); i++) {
        Slot& t = P.slots[i];
        if (!t.reported && t.deals == 0 && !t.waiting) { t.reported = true; out[m++] = i; }
    }
    return m;
}

float tb_result(void* p, int i, float* visits, float* q) {
    const Slot& t = ((Pool*)p)->slots[i];
    memcpy(visits, t.visits, sizeof(t.visits));
    if (q) for (int a = 0; a < NA; a++) q[a] = t.visits[a] > 0 ? t.qsum[a] / t.visits[a] : 0.0f;
    return t.vn > 0 ? t.vsum / t.vn : 0.0f;
}

}  // extern "C"
