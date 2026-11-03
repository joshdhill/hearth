"""Plan a long seamless loop through a short clip (a "video texture").

D is the frame-to-frame difference matrix of the clip. The plan is a list of runs
(first, jump_at, jump_to, cost): play frames first..jump_at-1, then blend over K frames
from jump_at.. into jump_to.., and the next run starts at jump_to + K. The last run jumps
into the start of the first, so the result loops.

Rules that keep it from looking like a loop:
  - a jump is only made where a half-second window of both places looks alike;
  - every place we land must lead on to another good jump (dead ends are pruned first,
    so the walk can never get stuck replaying the end of the clip);
  - recently shown footage is avoided, so the same flames don't come back for a while;
  - footage the clip itself repeats (some stock clips are already looped) counts as the
    same footage.
"""
import random
import numpy as np


class Planner:
    def __init__(self, D, fps, blend_s=0.5, gap_s=3.0, min_s=4.0, max_s=20.0, pct=2.5):
        D = np.asarray(D, np.float32)
        self.N = N = len(D)
        self.fps = fps
        self.K = K = max(4, int(round(fps * blend_s)))
        self.M = M = N - K
        Wc = np.zeros((M, M), np.float32)
        for k in range(K + 1):
            Wc += D[k:k + M, k:k + M]
        Wc /= K + 1
        self.Wc = Wc
        self.step = float(np.mean(np.diagonal(D, 1)))
        self.GAP = GAP = int(fps * gap_s)
        idx = np.arange(M)
        far = np.abs(idx[:, None] - idx[None, :]) > GAP

        # footage the clip repeats: long windows that match almost exactly
        self.dup_thr = 0.3 * self.step
        dup = (Wc < self.dup_thr) & far
        canon = np.arange(N)
        for i in range(M):
            js = np.nonzero(dup[i, :i])[0]
            if len(js):
                canon[i] = canon[js[0]]
        self.canon = canon
        self.unique_s = len(np.unique(canon[:M])) / fps
        self.repeat_frac = float((canon[:M] != np.arange(M)).mean())

        # good joins: the best few percent of real (non-duplicate) matches
        cand = far & ~dup
        self.THR = float(np.percentile(Wc[cand], pct))
        self.good = (Wc <= self.THR) & cand
        self.MIN, self.MAX = int(fps * min_s), int(fps * max_s)

        # prune dead ends: a landing frame j is alive if from j+K there's a good jump,
        # within MIN..MAX frames, into another alive landing frame with room to play
        alive = np.zeros(M, bool)
        alive[:max(0, M - self.MIN - K - 1)] = True
        for _ in range(200):
            reach = (self.good & alive[None, :]).any(1)              # frame i can jump somewhere alive
            cs = np.concatenate([[0], np.cumsum(reach)])
            new = np.zeros(M, bool)
            for j in range(M):
                a, b = j + K + self.MIN, min(j + K + self.MAX, M)
                new[j] = alive[j] and a < b and cs[b] - cs[a] > 0
            if (new == alive).all():
                break
            alive = new
        self.alive = alive
        self.ok = self.good & alive[None, :]

        # the largest group of landing frames that can all reach each other: a walk that stays
        # inside it can always get anywhere in it and back (some clips drift, e.g. the fire
        # grows, so early and late footage don't join)
        C = np.vstack([np.zeros((1, M), np.int32), np.cumsum(self.ok, axis=0, dtype=np.int32)])
        a = np.clip(np.arange(M) + K + self.MIN, 0, M)
        b = np.clip(np.arange(M) + K + self.MAX, 0, M)
        A = ((C[b] - C[a]) > 0) & alive[:, None] & alive[None, :]
        del C
        AT = np.ascontiguousarray(A.T)

        def reach(s, G):
            seen = np.zeros(M, bool); seen[s] = True
            front = seen.copy()
            while front.any():
                nxt = G[front].any(0) & ~seen
                seen |= nxt; front = nxt
            return seen

        best = np.zeros(M, bool)
        for s in np.nonzero(alive)[0][::max(1, int(fps // 2))]:
            if best[s]:
                continue
            comp = reach(s, A) & reach(s, AT)
            if comp.sum() > best.sum():
                best = comp
        self.comp = best
        self.ok &= best[None, :]
        # footage a walk inside the group can show
        play = np.zeros(self.N, bool)
        for j in np.nonzero(best)[0]:
            play[j + K: min(j + K + self.MAX, M)] = True
        self.usable_s = len(np.unique(canon[play])) / fps

    # -------------------------------------------------------------------------------------
    def plan(self, target_s, seed, fresh_s=None):
        K, M, fps = self.K, self.M, self.fps
        rng = random.Random(seed)
        if self.comp.sum() < 2:
            raise SystemExit('no usable joins in this clip')
        fresh = fresh_s if fresh_s is not None else min(25.0, self.usable_s * 0.45)
        tau = fresh * fps
        target = target_s * fps
        # start where good joins arrive (so the loop can close easily), varied by seed
        incoming = (self.ok.sum(0) * self.comp).astype(float)
        top = np.argsort(-incoming)[:max(1, int(self.comp.sum() // 4))]
        s0 = int(top[rng.randrange(len(top))])
        last = np.full(self.N, -1e9)      # output frame at which each (canonical) source frame was last shown
        t = 0
        segs, starts, lens = [], [s0], []
        cur = s0 + K

        def show(a, b):
            nonlocal t
            for f in range(a, b):
                last[self.canon[f]] = t
                t += 1

        offs = np.arange(self.MIN)
        canon = self.canon

        def staleness(ii, jj):
            """For each candidate jump i->j: how recently the footage we'd land on was shown
            (0 = long unseen .. 1 = just shown), counting the piece playing now."""
            land = np.minimum(jj[:, None] + K + offs[None, :], self.N - 1)        # frames we'd land on
            t_land = t + (ii - cur) + K                                            # when we'd land
            shown = last[canon[land]]
            # frames of the current piece (cur .. i+K) are shown at t + (f - cur)
            cl = canon[land]
            in_run = (land >= cur) & (land < (ii + K)[:, None])
            shown = np.where(in_run, t + (land - cur), shown)
            # the same footage elsewhere in the clip (if the clip repeats itself) also counts
            age = np.maximum(t_land[:, None] - shown, 0)
            return np.exp(-age / tau).mean(1)

        for _ in range(4000):
            lo, hi = cur + self.MIN, min(cur + self.MAX, M - 1)
            if lo >= hi:
                raise SystemExit('walk reached the end of the clip (pruning failed)')
            # close the loop once it is long enough: jump into the start of an earlier run
            run_total = np.cumsum(lens[::-1])[::-1] if lens else np.zeros(0)
            close = None
            for k, tj in enumerate(starts):
                have = float(run_total[k]) if k < len(run_total) else 0.0
                if have + (hi - cur) + K < target:
                    continue
                i_min = max(lo, cur + int(target - have) - K)
                if i_min >= hi:
                    continue
                col = self.Wc[i_min:hi, tj]
                cands = np.nonzero((col <= self.THR * 1.2) & (np.abs(np.arange(i_min, hi) - tj) > self.GAP))[0]
                if len(cands):
                    o = cands[np.argmin(col[cands])]
                    c = float(col[o])
                    if close is None or c < close[0]:
                        close = (c, k, i_min + int(o), int(tj))
            if close:
                c, k, i, tj = close
                return tj, segs[k:] + [(cur, i, tj, c)]

            ii, jj = np.nonzero(self.ok[lo:hi])
            ii = ii + lo
            if not len(ii):
                raise SystemExit('no way on from frame %d (pruning failed)' % cur)
            cost = self.Wc[ii, jj] / self.THR
            st = staleness(ii, jj)
            score = cost + 3.0 * st + 0.15 * np.array([rng.random() for _ in range(len(ii))])
            order = np.argsort(score)[:6]
            pick = order[rng.randrange(len(order))]
            i, j = int(ii[pick]), int(jj[pick])
            segs.append((cur, i, j, float(self.Wc[i, j])))
            show(cur, i + K)
            lens.append((i - cur) + K)
            starts.append(j)
            cur = j + K
        raise SystemExit('could not close the loop')

    # -------------------------------------------------------------------------------------
    def check(self, start, segs):
        """Sanity checks and numbers for the report."""
        K = self.K
        assert segs[0][0] == start + K, 'loop must start right after its closing blend'
        for (c1, i1, j1, _), (c2, *_r) in zip(segs, segs[1:]):
            assert c2 == j1 + K
        assert segs[-1][2] == start
        for (c, i, j, _x) in segs:
            assert c < i < self.M and j + K < self.N
        # the source frame shown at every output frame (blends count as their target)
        src = []
        for (c, i, j, _x) in segs:
            src.extend(range(c, i))
            src.extend(range(j, j + K))
        src = self.canon[np.array(src)]
        L = len(src)
        # for each output frame: how long until the same footage comes back (around the loop)
        pos = {}
        for n, f in enumerate(np.concatenate([src, src])):
            pos.setdefault(int(f), []).append(n)
        gaps = []
        for f, ps in pos.items():
            ps = np.array(ps)
            ps = ps[ps < 2 * L]
            d = np.diff(ps)
            gaps.extend(d[d > 0].tolist())
        gaps = np.array(gaps) / self.fps
        costs = np.array([x for *_, x in segs]) / self.step
        runs = np.array([(i - c) + K for (c, i, j, _x) in segs]) / self.fps
        return dict(seconds=round(L / self.fps, 1), joins=len(segs),
                    worst_join=round(float(costs.max()), 2), mean_join=round(float(costs.mean()), 2),
                    shortest_run=round(float(runs.min()), 1), longest_run=round(float(runs.max()), 1),
                    repeat_soonest=round(float(gaps.min()), 1), repeat_p5=round(float(np.percentile(gaps, 5)), 1),
                    repeat_median=round(float(np.median(gaps)), 1))
