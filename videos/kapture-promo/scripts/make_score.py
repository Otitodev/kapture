"""Generate the original, royalty-free electronic bed used by KaptureColorPromo."""

import math
import random
import struct
import wave
from pathlib import Path

RATE = 22050
LENGTH = 27.5
TEMPO = 120
SAMPLES = int(RATE * LENGTH)
mix = [0.0] * SAMPLES
rng = random.Random(24)


def add_pluck(start: float, pitch: float, loudness: float, seconds: float = 0.3) -> None:
    begin = int(start * RATE)
    for i in range(min(int(seconds * RATE), SAMPLES - begin)):
        t = i / RATE
        env = math.exp(-12 * t)
        value = math.sin(2 * math.pi * pitch * t) + 0.23 * math.sin(4 * math.pi * pitch * t)
        mix[begin + i] += loudness * env * value


def add_kick(start: float) -> None:
    begin = int(start * RATE)
    phase = 0.0
    for i in range(min(int(0.34 * RATE), SAMPLES - begin)):
        t = i / RATE
        phase += 2 * math.pi * (52 + 118 * math.exp(-24 * t)) / RATE
        mix[begin + i] += 0.42 * math.exp(-13 * t) * math.sin(phase)


def add_snare(start: float) -> None:
    begin = int(start * RATE)
    previous = 0.0
    for i in range(min(int(0.17 * RATE), SAMPLES - begin)):
        t = i / RATE
        noise = rng.uniform(-1, 1)
        high = noise - previous * 0.58
        previous = noise
        mix[begin + i] += 0.15 * math.exp(-28 * t) * high
        mix[begin + i] += 0.055 * math.exp(-28 * t) * math.sin(2 * math.pi * 190 * t)


def add_hat(start: float, strong: bool) -> None:
    begin = int(start * RATE)
    previous = 0.0
    for i in range(min(int(0.07 * RATE), SAMPLES - begin)):
        t = i / RATE
        noise = rng.uniform(-1, 1)
        high = noise - previous * 0.86
        previous = noise
        mix[begin + i] += (0.048 if strong else 0.026) * math.exp(-58 * t) * high


progression = [
    (130.81, [261.63, 329.63, 392.00]),  # C major
    (98.00, [196.00, 246.94, 392.00]),  # G major
    (110.00, [220.00, 261.63, 329.63]),  # A minor
    (87.31, [174.61, 220.00, 349.23]),  # F major
]

# A small pulse and arpeggio every half beat, with the chord changing every bar.
for half_beat in range(int(LENGTH * TEMPO / 30)):
    start = half_beat * 30 / TEMPO
    bar = int(start // 2)
    root, notes = progression[bar % len(progression)]
    add_hat(start, half_beat % 2 == 0)
    add_pluck(start, notes[half_beat % 3] * 2, 0.05, 0.22)
    if half_beat % 2 == 0:
        add_kick(start)
        add_pluck(start, root, 0.15, 0.42)
    if half_beat % 4 == 2:
        add_snare(start)

output = Path(__file__).resolve().parents[1] / 'public' / 'score.wav'
with wave.open(str(output), 'wb') as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(RATE)
    for i, sample in enumerate(mix):
        fade_in = min(1.0, i / (RATE * 0.5))
        fade_out = min(1.0, (SAMPLES - i) / (RATE * 1.25))
        value = math.tanh(sample * 1.25) * fade_in * fade_out
        wav.writeframesraw(struct.pack('<h', round(max(-1, min(1, value)) * 32767)))

print(output)
