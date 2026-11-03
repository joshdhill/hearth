#!/usr/bin/env python3
"""Copy Kalshi's public election prices to the desk-data branch for the Midterms Desk.

Kalshi's API won't answer browser pages on other sites, so the desk (docs/election/) can't
read it directly. This runs in GitHub Actions instead: about once a minute it reads the
2026 Senate, governor, House and chamber-control markets and force-pushes one small file,
kalshi.json, as a single parentless commit on the desk-data branch. The page reads it from
raw.githubusercontent.com.

Output shape:
  {"at": ISO time, "ctl": {"senate": {...}, "house": {...}},
   "races": {"S-GA": {...}, "G-PA": {...}, "H-PA-01": {...}}, "n": {...}, "err": [...]}
  each {...} is {"D": p, "R": p, "O": p, "t": event ticker, "m": [[side, name, price], ...]}

Local check without pushing:  python3 kalshi_feed.py --once --out /tmp/kalshi.json
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

API = "https://api.elections.kalshi.com/trade-api/v2"
UA = "hearth-midterms-desk/1.0 (github.com/joshdhill/hearth)"
STATES = set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH "
             "NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split())
AT_LARGE = {"AK", "DE", "ND", "SD", "VT", "WY"}
CONTROL = {"CONTROLS": "senate", "CONTROLH": "house"}
RE_SEN = re.compile(r"^(?:KX)?SENATE(?:PARTY)?-?([A-Z]{2})S?$")      # trailing S = special election
RE_GOV = re.compile(r"^(?:KX)?GOV(?:PARTY)?-?([A-Z]{2})$")
RE_HOUSE = re.compile(r"^(?:KX)?HOUSE-?([A-Z]{2})-?(\d{1,2}|AL)$")
RE_CYCLE = re.compile(r"-(26|2026)$")
NAMES = {"Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO",
         "Connecticut": "CT", "Delaware": "DE", "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID",
         "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA",
         "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN",
         "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
         "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC",
         "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA",
         "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX",
         "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA", "West Virginia": "WV",
         "Wisconsin": "WI", "Wyoming": "WY"}
RE_STATE = re.compile(r"\b(" + "|".join(sorted(NAMES, key=len, reverse=True)) + r")\b")


def this_cycle(ev, key):
    """Kalshi's tickers don't always say the year (NH governor 2026 is GOVPARTYNH-28), so read the text too."""
    t = str(ev.get("event_ticker") or "")
    txt = f"{ev.get('title') or ''} {ev.get('sub_title') or ''}"
    if re.search(r"\b20(1\d|2[0-5]|2[89]|3\d)\b", txt) and "2026" not in txt:
        return key.startswith("G-") and "2027" in txt      # governors elected in 2026 take office in 2027
    return bool(RE_CYCLE.search(t)) or "2026" in txt or (key.startswith("G-") and "2027" in txt)


def fix_key(ev, key):
    """Trust the event title's state over the series ticker (Kalshi files Kentucky's race as SENATELA-26)."""
    if key[:2] not in ("S-", "G-"):
        return key
    m = RE_STATE.search(str(ev.get("title") or ""))
    return key[:2] + NAMES[m.group(1)] if m else key


def log(*a):
    print(datetime.now(timezone.utc).strftime("%H:%M:%S"), *a, flush=True)


def get(path, params=None, tries=3):
    url = API + path + ("?" + urllib.parse.urlencode(params) if params else "")
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": UA})
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep((3 if e.code == 429 else 1) * (i + 1))
        except Exception:
            time.sleep(1 + i)
    raise RuntimeError("no answer from " + path)


def key_for_series(ticker):
    """Map a Kalshi series ticker to the desk's race key, or None."""
    if ticker in CONTROL:
        return "ctl:" + CONTROL[ticker]
    m = RE_SEN.match(ticker)
    if m and m.group(1) in STATES:
        return "S-" + m.group(1)
    m = RE_GOV.match(ticker)
    if m and m.group(1) in STATES:
        return "G-" + m.group(1)
    m = RE_HOUSE.match(ticker)
    if m and m.group(1) in STATES:
        st, d = m.group(1), m.group(2)
        dist = "AL" if (st in AT_LARGE or d == "AL" or int(d) == 0) else d.zfill(2)
        return f"H-{st}-{dist}"
    return None


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def price(m):
    """Chance of YES: settled result, else the bid/ask midpoint, else the last trade."""
    res = str(m.get("result") or "").lower()
    if res == "yes":
        return 1.0
    if res == "no":
        return 0.0
    bid, ask, last = num(m.get("yes_bid_dollars")), num(m.get("yes_ask_dollars")), num(m.get("last_price_dollars"))
    if bid is None and num(m.get("yes_bid")) is not None:
        bid = num(m.get("yes_bid")) / 100
    if ask is None and num(m.get("yes_ask")) is not None:
        ask = num(m.get("yes_ask")) / 100
    if last is None and num(m.get("last_price")) is not None:
        last = num(m.get("last_price")) / 100
    if bid is not None and ask is not None and ask > 0 and ask >= bid and ask - bid <= 0.10:
        return (bid + ask) / 2
    if last is not None and last > 0:
        return last
    return bid


def side(m):
    t = str(m.get("ticker") or "").upper()
    if re.search(r"-(D|DEM)$", t):
        return "D"
    if re.search(r"-(R|REP|GOP)$", t):
        return "R"
    txt = " ".join(str(m.get(k) or "") for k in ("yes_sub_title", "title", "rules_primary")).lower()
    if "democrat" in txt:
        return "D"
    if "republican" in txt:
        return "R"
    return "O"


def summarize(ev):
    ms = ev.get("markets") or []
    acc, tot, rows, vol = {"D": 0.0, "R": 0.0, "O": 0.0}, 0.0, [], 0.0
    for m in ms:
        p = price(m)
        if p is None:
            continue
        s = side(m)
        acc[s] += p
        tot += p
        vol += num(m.get("volume_fp")) or num(m.get("volume")) or 0
        rows.append([s, str(m.get("yes_sub_title") or m.get("title") or "")[:60], round(p, 4)])
    if tot <= 0:
        return None
    out = {k: round(v / tot, 4) for k, v in acc.items()}
    out.update(t=ev.get("event_ticker"), m=rows, v=round(vol))
    return out


def discover():
    """Find this cycle's events for every race series. Returns {key: [event tickers]}."""
    j = get("/series", {"category": "Elections"}) or {}
    series = {}
    for s in j.get("series") or []:
        k = key_for_series(str(s.get("ticker") or ""))
        if k:
            series.setdefault(k, []).append(s["ticker"])
    log("series matched", len(series), "keys from", len(j.get("series") or []))

    def events_of(pair):
        key, ticker = pair
        jj = get("/events", {"series_ticker": ticker, "with_nested_markets": "false", "limit": 100}) or {}
        return [(fix_key(e, key), e.get("event_ticker")) for e in jj.get("events") or [] if this_cycle(e, key)]

    found = {}
    pairs = [(k, t) for k, ts in series.items() for t in ts]
    with ThreadPoolExecutor(6) as ex:
        for evs in ex.map(lambda p: _safe(events_of, p, []), pairs):
            for k, e in evs:
                if e and e not in found.setdefault(k, []):
                    found[k].append(e)
    found = {k: v for k, v in found.items() if v}
    log("events found for", len(found), "keys")
    return found


def _safe(fn, arg, default):
    try:
        return fn(arg)
    except Exception as e:  # keep the loop alive; report in the file
        log("error", arg, e)
        return default


def snapshot(found):
    pairs = [(k, t) for k, ts in found.items() for t in ts]

    def one(t):
        j = get(f"/events/{urllib.parse.quote(t)}", {"with_nested_markets": "true"})
        if not j:
            return None
        ev = dict(j.get("event") or {})
        if not ev.get("markets"):
            ev["markets"] = j.get("markets") or []
        return summarize(ev)

    best, errs = {}, []
    with ThreadPoolExecutor(6) as ex:
        results = list(ex.map(lambda p: _safe(one, p[1], None), pairs))
    for (k, t), s in zip(pairs, results):
        if s is None:
            continue
        cur = best.get(k)
        if cur is None or s["v"] > cur["v"]:      # keep the deepest market for each race
            best[k] = s
    doc = {
        "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "src": "Kalshi public market data (api.elections.kalshi.com), copied by tools/desk/kalshi_feed.py",
        "ctl": {k[4:]: v for k, v in best.items() if k.startswith("ctl:")},
        "races": {k: v for k, v in best.items() if not k.startswith("ctl:")},
    }
    doc["n"] = {"S": sum(k.startswith("S-") for k in doc["races"]), "G": sum(k.startswith("G-") for k in doc["races"]),
                "H": sum(k.startswith("H-") for k in doc["races"]), "events": len(pairs)}
    if errs:
        doc["err"] = errs
    return doc


def git(*args, inp=None):
    env = dict(os.environ, GIT_AUTHOR_NAME="hearth-bot", GIT_AUTHOR_EMAIL="actions@users.noreply.github.com",
               GIT_COMMITTER_NAME="hearth-bot", GIT_COMMITTER_EMAIL="actions@users.noreply.github.com")
    r = subprocess.run(["git", *args], input=inp, capture_output=True, text=True, env=env, timeout=120)
    if r.returncode:
        raise RuntimeError(f"git {args[0]} failed: {r.stderr.strip()[:300]}")
    return r.stdout.strip()


def publish(doc):
    """One parentless commit holding kalshi.json, force-pushed to desk-data (no history piles up)."""
    data = json.dumps(doc, separators=(",", ":"), sort_keys=True)
    blob = git("hash-object", "-w", "--stdin", inp=data)
    tree = git("mktree", inp=f"100644 blob {blob}\tkalshi.json\n")
    commit = git("commit-tree", tree, "-m", "Kalshi prices " + doc["at"] + " [skip ci]")
    git("push", "-q", "-f", "origin", f"{commit}:refs/heads/desk-data")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=340, help="stop after this long")
    ap.add_argument("--until", default="2026-11-04T11:00:00Z", help="never run past this time (UTC)")
    ap.add_argument("--every", type=float, default=60, help="seconds between updates")
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--out", help="write the file here instead of pushing it")
    a = ap.parse_args()
    until = datetime.strptime(a.until, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
    stop = min(time.time() + a.minutes * 60, until)
    found, found_at, fails = {}, 0.0, 0
    while True:
        t0 = time.time()
        try:
            if not found or t0 - found_at > 1800:
                found, found_at = discover() or found, t0
            doc = snapshot(found)
            if a.out:
                with open(a.out, "w") as f:
                    json.dump(doc, f, indent=1, sort_keys=True)
            else:
                publish(doc)
            log("published", doc["n"], "ctl", {k: v["D"] for k, v in doc["ctl"].items()})
            fails = 0
        except Exception as e:
            fails += 1
            log("cycle failed", fails, e)
            if fails >= 30:
                sys.exit(1)
        if a.once or time.time() >= stop:
            break
        time.sleep(max(5.0, a.every - (time.time() - t0)))


if __name__ == "__main__":
    main()
