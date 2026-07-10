"""Render per-world Pagade intro films with Azure Sora-2 (AAD auth, text-to-video).

Text-to-video only (no reference image) so moderation never blocks on people. Writes
web/assets/<world>/intro.mp4 sequentially (avoids concurrency 429s). Skips existing unless --force.

Usage:
  python tooling/gen_intro.py [world ...] [--seconds 8] [--force]
"""
import json
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request

ENDPOINT = "https://ai-contosohub530569751908.cognitiveservices.azure.com"
API_VERSION = "preview"
MODEL = "sora-2"
CS_SCOPE = "https://cognitiveservices.azure.com"
ROOT = pathlib.Path(__file__).resolve().parents[1]

PROMPTS = {
    "dharma": (
        "Serene cinematic overhead shot of an ancient Indian pagade (pachisi) game at dusk in a warm "
        "temple hall lit by flickering oil lamps. A large hand-embroidered cross-shaped cloth board in deep "
        "indigo and gold rests on the stone floor. Six small cowrie shells tumble and scatter across the "
        "cloth in slow motion. Beehive-shaped wooden playing pieces in glowing red, green, gold and violet "
        "sit at the four arms and softly pulse with light, beginning a journey along the cross toward a "
        "radiant golden centre marked with a sacred Om symbol. Dust motes drift in the lamplight, shallow "
        "depth of field, slow meditative camera push-in. Devotional, peaceful, the journey of the soul from "
        "fate to dharma. No text, no words, no logos, no watermark."
    ),
    "mahabharata": (
        "Epic mythic cinematic title sequence at dusk in an ancient Indian royal court. A vast cross-shaped "
        "pachisi game court of red and white stone squares, like the imperial game courts of old, stretches "
        "across a torchlit palace floor. Cowrie shells cast by unseen royal hands scatter across the squares "
        "as dark storm clouds gather overhead. The playing pieces are tiny glowing bronze war-chariots and "
        "warrior figures that flare with amber fire and drifting embers. Dramatic torchlight, deep shadows, a "
        "sense that the fate of a whole kingdom hangs on a single throw of the dice. Slow majestic sweeping "
        "camera move. Grand, tense, mythic and ancient. No text, no words, no logos, no watermark."
    ),
    "ancient-india": (
        "Warm heritage-documentary cinematic journey across the ages of ancient India, imagined as a glowing "
        "cross-shaped board-map on aged parchment and embroidered cloth in saffron and sandstone tones. Along "
        "the four arms of the cross rise softly glowing miniature scenes: the brick streets of an Indus Valley "
        "city, a carved Ashokan pillar, a Gupta-era astronomy chart of stars and a zero, a southern temple-city "
        "of Vijayanagara, and a Mughal garden arch. Cowrie shells roll forward along the road and small caravan "
        "and camel silhouettes travel between the ages. Golden-hour light, drifting dust, warm nostalgic glow, "
        "slow travelling camera. Adventurous and reverent, one road across five ages. No text, no words, no watermark."
    ),
}

_tok = {"v": None, "t": 0.0}


def token():
    if not _tok["v"] or time.time() - _tok["t"] > 2400:
        _tok["v"] = subprocess.run(
            ["az", "account", "get-access-token", "--resource", CS_SCOPE,
             "--query", "accessToken", "-o", "tsv"],
            capture_output=True, text=True, shell=True).stdout.strip()
        _tok["t"] = time.time()
        if not _tok["v"]:
            raise RuntimeError("no AAD token; run `az login`")
    return _tok["v"]


def req(method, url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Authorization", f"Bearer {token()}")
    if body is not None:
        r.add_header("Content-Type", "application/json")
    return urllib.request.urlopen(r, timeout=180)


def log(m):
    print(f"{time.strftime('%H:%M:%S')} {m}", flush=True)


def render(world, prompt, seconds):
    out = ROOT / "web" / "assets" / world / "intro.mp4"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.with_suffix(".prompt.txt").write_text(prompt, encoding="utf-8")
    size = "1280x720"

    vid = None
    while vid is None:
        try:
            with req("POST", f"{ENDPOINT}/openai/v1/videos?api-version={API_VERSION}",
                     {"model": MODEL, "prompt": prompt, "seconds": str(seconds), "size": size}) as r:
                vid = json.loads(r.read())["id"]
                log(f"[{world}] submitted -> {vid}")
        except urllib.error.HTTPError as e:
            if e.code == 429:
                log(f"[{world}] 429 on submit; backoff 45s"); time.sleep(45)
            elif e.code in (401, 403):
                _tok["v"] = None; time.sleep(2)
            else:
                raise RuntimeError(f"[{world}] submit failed {e.code}: {e.read()[:300]!r}")

    deadline = time.time() + 1800
    while True:
        if time.time() > deadline:
            raise TimeoutError(f"[{world}] intro did not complete in time")
        try:
            with req("GET", f"{ENDPOINT}/openai/v1/videos/{vid}?api-version={API_VERSION}") as r:
                s = json.loads(r.read())
            st = s.get("status")
            if st == "completed":
                with req("GET", f"{ENDPOINT}/openai/v1/videos/{vid}/content?api-version={API_VERSION}") as r:
                    out.write_bytes(r.read())
                log(f"[{world}] DONE {out} ({out.stat().st_size} bytes)")
                return
            if st == "failed":
                raise RuntimeError(f"[{world}] failed: {s.get('error')}")
            log(f"[{world}] status={st} progress={s.get('progress', '?')}")
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                _tok["v"] = None
            else:
                log(f"[{world}] poll error {e.code}")
        time.sleep(10)


def main():
    args = sys.argv[1:]
    force = "--force" in args
    seconds = 8
    if "--seconds" in args:
        i = args.index("--seconds"); seconds = int(args[i + 1]); del args[i:i + 2]
    worlds = [a for a in args if not a.startswith("--")] or list(PROMPTS.keys())
    for w in worlds:
        if w not in PROMPTS:
            log(f"[{w}] no prompt; skip"); continue
        out = ROOT / "web" / "assets" / w / "intro.mp4"
        if out.exists() and not force:
            log(f"[{w}] exists ({out.stat().st_size} bytes); skip"); continue
        render(w, PROMPTS[w], seconds)
    log("ALL DONE")


if __name__ == "__main__":
    main()
