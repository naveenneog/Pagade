"""Pre-generate Indian-English DragonHD narration for every teaching (Azure AI Speech, AAD).

Every line the game reads aloud (enter / castle / capture / captured / home / win / journey
teachings + the goal line) is synthesized once with an expressive **DragonHD** Indian-English
voice and saved as a small mp3, plus a manifest mapping the exact text -> file. At runtime the
game plays the matching clip and only falls back to the (robotic) browser voice if a clip is
missing.

Each world uses its own voice.azure (dharma/mahabharata = en-IN-Arjun, ancient-india = en-IN-Neerja).

Output: web/assets/<world>/voice/<hash>.mp3  +  web/assets/<world>/voice/voice.json
Usage: python tooling/gen_voice.py [world ...]
"""
import hashlib
import html
import json
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORLDS_DIR = ROOT / "web" / "worlds"
ASSETS = ROOT / "web" / "assets"

REGION = "eastus2"
RESOURCE_ID = ("/subscriptions/e839ff0f-532b-4828-a2b3-8c9a1b719d85/resourceGroups/"
               "rg-contosohub/providers/Microsoft.CognitiveServices/accounts/"
               "ai-contosohub530569751908")
CS_SCOPE = "https://cognitiveservices.azure.com"
ENDPOINT = f"https://{REGION}.tts.speech.microsoft.com/cognitiveservices/v1"
FMT = "audio-24khz-48kbitrate-mono-mp3"
DEFAULT_VOICE = "en-IN-Arjun:DragonHDLatestNeural"

# per-teaching prosody (rate, pitch) — pitch as % never "0st" (which 400s). Non-zero neutral is fine.
PROSODY = {
    "enter": ("0%", "0%"),
    "castle": ("-2%", "0%"),
    "capture": ("-4%", "-4%"),
    "captured": ("-3%", "-2%"),
    "home": ("+2%", "+3%"),
    "win": ("+2%", "+4%"),
    "journey": ("0%", "+1%"),
}


def token():
    r = subprocess.run(["az", "account", "get-access-token", "--resource", CS_SCOPE,
                        "--query", "accessToken", "-o", "tsv"],
                       capture_output=True, text=True, shell=True, timeout=30)
    t = r.stdout.strip()
    if not t:
        raise RuntimeError("no AAD token; run `az login`")
    return t


def ssml(text, voice, rate, pitch):
    inner = f'<prosody rate="{rate}" pitch="{pitch}">{html.escape(text)}</prosody>'
    return (f'<speak version="1.0" xmlns:mstts="https://www.w3.org/2001/mstts" '
            f'xml:lang="en-IN"><voice name="{voice}">{inner}</voice></speak>')


def synth(text, out, voice, rate, pitch, tries=4):
    body = ssml(text, voice, rate, pitch).encode("utf-8")
    for i in range(1, tries + 1):
        req = urllib.request.Request(ENDPOINT, data=body, method="POST")
        req.add_header("Authorization", f"aad#{RESOURCE_ID}#{token()}")
        req.add_header("Content-Type", "application/ssml+xml")
        req.add_header("X-Microsoft-OutputFormat", FMT)
        req.add_header("User-Agent", "pagade")
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            if len(data) > 400:
                out.write_bytes(data)
                return True
            print(f"  WARN empty ({len(data)}B) voice={voice} text={text[:40]!r}")
        except urllib.error.HTTPError as e:
            print(f"  HTTP {e.code} try {i}: {e.read()[:160]!r}")
            time.sleep(min(3 * i, 12))
        except Exception as e:  # noqa: BLE001
            print(f"  ERR try {i}: {e}")
            time.sleep(min(3 * i, 12))
    return False


def key(text):
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]


def lines_for(world):
    voice = (world.get("voice") or {}).get("azure") or DEFAULT_VOICE
    T = world.get("teachings") or {}
    for kind, arr in T.items():
        rate, pitch = PROSODY.get(kind, ("0%", "0%"))
        for e in (arr or []):
            if isinstance(e, dict) and e.get("text"):
                yield (e["text"], voice, rate, pitch)
    if world.get("goalMeaning"):
        yield (world["goalMeaning"], voice, "+2%", "+4%")


def main():
    worlds = sys.argv[1:] or [f.stem for f in WORLDS_DIR.glob("*.json")]
    for wid in worlds:
        wf = WORLDS_DIR / f"{wid}.json"
        if not wf.exists():
            print(f"skip {wid}: no world json"); continue
        world = json.loads(wf.read_text(encoding="utf-8"))
        out_dir = ASSETS / wid / "voice"
        out_dir.mkdir(parents=True, exist_ok=True)
        manifest = {}
        seen = set()
        items = [it for it in lines_for(world) if it[0]]
        print(f"[{wid}] {len(items)} lines")
        for text, voice, rate, pitch in items:
            h = key(text)
            manifest[text] = f"{h}.mp3"
            if h in seen:
                continue
            seen.add(h)
            out = out_dir / f"{h}.mp3"
            if out.exists() and out.stat().st_size > 400:
                continue
            ok = synth(text, out, voice, rate, pitch)
            print(f"  {'OK ' if ok else 'FAIL'} [{voice.split(':')[0]}] {text[:52]}")
            time.sleep(0.35)
        (out_dir / "voice.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=0), encoding="utf-8")
        print(f"[{wid}] manifest -> voice.json ({len(manifest)} entries)")
    print("DONE")


if __name__ == "__main__":
    main()
