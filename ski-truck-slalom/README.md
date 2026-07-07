# 🎿🚚 Lyžiar na Korbe — Ski Truck Slalom

A silly indie-style arcade game. A screaming skier is roped to the flatbed
(**korba**) of your pickup truck. Your job: **slalom through normal road
traffic** without crashing your truck. The **further and faster** you go, the
more points you rack up — and reaching the **CIEL (finish, 5 km)** quickly earns
a fat time bonus.

Pure vanilla JavaScript + HTML5 Canvas. **No build step, no dependencies.**

## ▶️ Ako spustiť / How to run

From the repo root:

```bash
# option A — Python (any 3.x)
cd ski-truck-slalom
python3 -m http.server 8000
# then open http://localhost:8000

# option B — Node
npx --yes serve ski-truck-slalom -l 8000
# then open http://localhost:8000
```

Open **http://localhost:8000** in a browser and press **SPACE** (or tap) to start.

## 🎮 Ovládanie / Controls

| Akcia            | Klávesy                    |
| ---------------- | -------------------------- |
| Kormidluj / steer | `←` `→` alebo `A` `D`     |
| Plyn / gas       | `↑` alebo `W`              |
| Brzda / brake    | `↓` alebo `S`              |
| Štart / reštart  | `Medzera` (Space) / ťuk    |
| Pauza            | `P`                        |
| Zvuk / mute      | `M` alebo tlačidlo 🔊      |

On phones/tablets, on-screen buttons appear automatically.

## 🏆 Bodovanie / Scoring

- **+100 bodov za každý km** prejdenej vzdialenosti (points per km).
- **Slalom prejazdy** (near-misses): tesný prejazd okolo auta = combo `xN`
  a extra body. Čím tesnejšie a čím dlhšie combo, tým viac.
- **Časový bonus**: príď do CIEĽa (5 km) rýchlejšie ako par time (105 s)
  a dostaneš `(par − tvoj čas) × 60` bodov.
- Po cieli pokračuješ na **BONUS TRASE** — jazdi ďalej a zbieraj ešte viac,
  kým nenaboruráš. Najlepšie skóre sa ukladá lokálne (`localStorage`).

## 😜 Funny prvky

Kričiaci lyžiar s bublinami, hompáľajúce sa lano, ragdoll pri náraze,
konfety v cieli, a premávka plná bizarných áut: školský autobus, traktor,
kačka, banán, **vaňa s gumenou kačkou** 🦆 a policajt s blikajúcimi svetlami.

Enjoy — a drž sa! 🎿
