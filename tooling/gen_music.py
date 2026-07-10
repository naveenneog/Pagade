"""Compose per-world looping music beds for Pagade (numpy + ffmpeg), raga-flavoured.

Additive synthesis, ADSR, light Indian percussion (tabla/kick/hat) and a cheap comb reverb;
the loop tail wraps into the head so it repeats seamlessly. Output: web/assets/<world>/music.mp3

Usage: python tooling/gen_music.py [dharma mahabharata ancient-india]
"""
import pathlib
import subprocess
import sys
import wave

import numpy as np

SR = 44100
ROOT = pathlib.Path(__file__).resolve().parents[1]
ASSETS = ROOT / "web" / "assets"
A4 = 440.0


def hz(semi):
    return A4 * (2 ** (semi / 12.0))


def adsr(n, a=0.01, d=0.08, s=0.7, r=0.2):
    a_n, d_n, r_n = int(a * SR), int(d * SR), int(r * SR)
    s_n = max(1, n - a_n - d_n - r_n)
    env = np.concatenate([
        np.linspace(0, 1, a_n, endpoint=False),
        np.linspace(1, s, d_n, endpoint=False),
        np.full(s_n, s),
        np.linspace(s, 0, r_n),
    ])
    if len(env) < n:
        env = np.concatenate([env, np.zeros(n - len(env))])
    return env[:n]


def tone(freq, dur, harmonics, env, vib=0.0, vib_hz=5.0, detune=0.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    ph = 2 * np.pi * freq * t
    if vib:
        ph = ph + vib * np.sin(2 * np.pi * vib_hz * t)
    sig = np.zeros(n)
    for k, amp in enumerate(harmonics, start=1):
        sig += amp * np.sin(k * ph)
    if detune:
        for k, amp in enumerate(harmonics, start=1):
            sig += amp * 0.5 * np.sin(k * ph * (1 + detune))
    sig /= max(1e-6, sum(harmonics) * (1.5 if detune else 1.0))
    return sig * env[:n]


PAD = [1, 0.5, 0.3, 0.2, 0.12]
SITAR = [1, 0.7, 0.5, 0.35, 0.22, 0.14, 0.09]   # bright, buzzy plucked
BANSURI = [1, 0.22, 0.09, 0.04]                  # airy flute
DRONE = [1, 0.45, 0.25, 0.12, 0.06]
BASS = [1, 0.5, 0.28, 0.15]


def kick(dur=0.16):
    n = int(dur * SR); t = np.arange(n) / SR
    f = 120 * np.exp(-t * 30) + 45
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 22)


def hat(dur=0.05, lvl=0.4):
    n = int(dur * SR); t = np.arange(n) / SR
    noise = np.random.randn(n)
    noise = noise - np.convolve(noise, np.ones(8) / 8, mode="same")
    return noise * np.exp(-t * 60) * lvl


def tabla(dur=0.18, low=True):
    n = int(dur * SR); t = np.arange(n) / SR
    if low:
        f = 150 * np.exp(-t * 18) + 80
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 16) * 0.8
    return (np.sin(2 * np.pi * 320 * t) * np.exp(-t * 26)
            + np.random.randn(n) * np.exp(-t * 40) * 0.3)


def comb_reverb(x, taps=((0.037, 0.28), (0.053, 0.2), (0.071, 0.14), (0.097, 0.1))):
    out = x.copy()
    for dl, g in taps:
        d = int(dl * SR)
        out += g * np.concatenate([np.zeros(d), x])[: len(x)]
    return out


class Track:
    def __init__(self, seconds, tail=2.0):
        self.tail = int(tail * SR)
        self.n = int(seconds * SR)
        self.buf = np.zeros(self.n + self.tail)

    def add(self, at, sig, gain=1.0):
        i = int(at * SR)
        j = min(len(self.buf), i + len(sig))
        self.buf[i:j] += sig[: j - i] * gain

    def finish(self, reverb=0.25):
        if reverb:
            wet = comb_reverb(self.buf)
            self.buf = (1 - reverb) * self.buf + reverb * wet
        head = self.buf[: self.n].copy()
        head[: self.tail] += self.buf[self.n: self.n + self.tail]
        peak = np.max(np.abs(head)) or 1.0
        return np.tanh(head / peak * 0.9 * 1.1)


def drone_pair(T, total, sa):
    """A sustained tanpura-like Sa + Pa drone under the whole loop."""
    T.add(0, tone(hz(sa - 12), total, DRONE, adsr(int(total * SR), 0.8, 0.6, 0.9, 1.0)), 0.16)
    T.add(0, tone(hz(sa - 12 + 7), total, DRONE, adsr(int(total * SR), 1.0, 0.6, 0.85, 1.0)), 0.11)
    T.add(0, tone(hz(sa), total, [1, 0.3, 0.15], adsr(int(total * SR), 1.2, 0.6, 0.8, 1.0)), 0.06)


def melody(T, base, sa, phrase, inst, gain, beat, vib=0.16):
    t = base
    for deg, beats in phrase:
        dur = beats * beat
        T.add(t, tone(hz(sa + deg), dur, inst, adsr(int(dur * SR), 0.05, 0.12, 0.8, 0.3),
                      vib=vib, vib_hz=5.2), gain)
        t += dur


def compose_dharma():
    # Bhupali (pentatonic), meditative and devotional. Slow.
    bpm, bars = 60, 8
    beat = 60 / bpm
    sa = -9  # C4 tonic
    T = Track(bars * 4 * beat)
    total = bars * 4 * beat
    drone_pair(T, total, sa)
    phrases = [
        [(0, 2), (4, 1), (2, 1), (7, 2), (4, 2)],
        [(9, 2), (7, 1), (4, 1), (2, 2), (0, 2)],
        [(7, 1), (9, 1), (12, 2), (9, 1), (7, 1), (4, 2)],
        [(4, 2), (2, 1), (0, 1), (-3, 2), (0, 2)],
    ]
    for bar in range(bars):
        base = bar * 4 * beat
        if bar % 2 == 0:
            melody(T, base, sa, phrases[(bar // 2) % len(phrases)], BANSURI, 0.30, beat, vib=0.2)
        # sparse sitar pluck on the Sa/Pa
        T.add(base, tone(hz(sa + (0 if bar % 2 == 0 else 7)), beat * 2, SITAR,
                         adsr(int(beat * 2 * SR), 0.005, 0.2, 0.4, 0.5)), 0.13)
        # very soft tabla heartbeat
        T.add(base, tabla(low=True), 0.4)
        T.add(base + 2 * beat, tabla(low=False), 0.3)
    return T.finish(reverb=0.34)


def compose_mahabharata():
    # Bhairav-flavoured (komal Re + komal Dha), dramatic and grand. Medium.
    bpm, bars = 82, 12
    beat = 60 / bpm
    sa = -9
    T = Track(bars * 4 * beat)
    total = bars * 4 * beat
    drone_pair(T, total, sa)
    phrases = [
        [(0, 1), (1, 1), (4, 2), (5, 1), (4, 1), (1, 2)],   # Sa re Ga ma Ga re
        [(7, 1), (8, 1), (7, 2), (5, 1), (4, 1), (1, 2)],   # Pa dha Pa ma Ga re
        [(11, 1), (12, 2), (11, 1), (8, 2), (7, 2)],        # Ni Sa' Ni dha Pa
        [(4, 1), (5, 1), (7, 2), (8, 2), (7, 2)],
    ]
    for bar in range(bars):
        base = bar * 4 * beat
        melody(T, base, sa, phrases[bar % len(phrases)], SITAR, 0.26, beat, vib=0.1)
        # marching bass on Sa / Pa
        cr = 0 if bar % 2 == 0 else 7
        for b in range(4):
            T.add(base + b * beat, tone(hz(sa + cr - 24), beat * 0.9, BASS,
                                        adsr(int(beat * 0.9 * SR), 0.005, 0.06, 0.7, 0.2)), 0.34)
        # pakhawaj-like martial groove
        T.add(base, kick(), 0.9)
        T.add(base + 1.5 * beat, kick(), 0.7)
        T.add(base + 2 * beat, tabla(low=True), 0.7)
        T.add(base + beat, tabla(low=False), 0.5)
        T.add(base + 3 * beat, tabla(low=False), 0.5)
        for e in range(4):
            T.add(base + e * beat, hat(lvl=0.28), 0.5)
    return T.finish(reverb=0.26)


def compose_ancient_india():
    # Kafi (komal Ga + komal Ni), warm folk journey. Mid-tempo, forward-moving.
    bpm, bars = 96, 16
    beat = 60 / bpm
    sa = -9
    T = Track(bars * 4 * beat)
    total = bars * 4 * beat
    drone_pair(T, total, sa)
    phrases = [
        [(0, 1), (2, 1), (3, 1), (5, 1), (7, 2), (5, 1), (3, 1)],
        [(7, 1), (9, 1), (10, 2), (9, 1), (7, 1), (5, 2)],
        [(12, 1), (10, 1), (9, 1), (7, 1), (5, 2), (3, 2)],
        [(3, 1), (5, 1), (7, 2), (5, 1), (3, 1), (2, 1), (0, 1)],
    ]
    for bar in range(bars):
        base = bar * 4 * beat
        inst = BANSURI if bar % 2 == 0 else SITAR
        melody(T, base, sa, phrases[bar % len(phrases)], inst, 0.24, beat, vib=0.14)
        # walking bass (caravan step)
        walk = [0, 7, 5, 7]
        for b in range(4):
            T.add(base + b * beat, tone(hz(sa + walk[b] - 24), beat * 0.85, BASS,
                                        adsr(int(beat * 0.85 * SR), 0.005, 0.06, 0.65, 0.2)), 0.3)
        # lilting tabla groove
        T.add(base, tabla(low=True), 0.6)
        T.add(base + beat, tabla(low=False), 0.45)
        T.add(base + 1.5 * beat, tabla(low=False), 0.35)
        T.add(base + 2 * beat, tabla(low=True), 0.55)
        T.add(base + 3 * beat, tabla(low=False), 0.45)
        for e in range(8):
            T.add(base + e * beat / 2, hat(lvl=0.22), 0.5)
    return T.finish(reverb=0.24)


COMPOSERS = {
    "dharma": compose_dharma,
    "mahabharata": compose_mahabharata,
    "ancient-india": compose_ancient_india,
}


def write_mp3(samples, out_mp3):
    out_mp3.parent.mkdir(parents=True, exist_ok=True)
    wav_path = out_mp3.with_suffix(".wav")
    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
    with wave.open(str(wav_path), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav_path),
                    "-codec:a", "libmp3lame", "-b:a", "128k", str(out_mp3)], check=True)
    wav_path.unlink(missing_ok=True)
    print(f"OK {out_mp3.relative_to(ASSETS)} ({out_mp3.stat().st_size} bytes)", flush=True)


def main():
    worlds = [a for a in sys.argv[1:] if not a.startswith("--")] or list(COMPOSERS.keys())
    np.random.seed(7)
    for w in worlds:
        fn = COMPOSERS.get(w)
        if not fn:
            print(f"no composer for {w}"); continue
        print(f"composing {w}...", flush=True)
        write_mp3(fn(), ASSETS / w / "music.mp3")
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
