# mobilefighter

**Wanderer × Elemental Strikers** — a touch-only mobile side-scrolling brawler PWA.

Built for Android Chrome at a fixed 300×500 portrait viewport. Installable as a Progressive Web App (add to home screen) with full offline play.

## What's in this game

- **Player fighter**: full animation set (idle, run, cross punch, roundhouse kick, uppercut, throw, fireball special, taking punch, knockdown, getting up, flame-on victory pose) from a clean transparent sprite package.
- **Combo system**: a real combo tree (jab → cross → uppercut) implemented as nested lookup tables, driven by a buffered input dequeue so taps during recovery still land.
- **Elemental Strikers**: Rock Warrior and Vine Assassin appear as regular enemies and as zone bosses, sized evenly with the player.
- **Zone campaign**: 6 zones, escalating difficulty, gem-funded shop between zones, XP/leveling.
- **VM-driven level generation**: a custom "018810 OMNIS" quaterbase4i GENETIC ROM (256-entry byte→glyph lookup table) plus Cascade Algebra (`a⊗b = a×(b+1)`) drives a tiny virtual machine that deterministically seeds enemy placement, hazards, gems, and flame pickups per zone — no `Math.random()` anywhere in the level generator.
- **Off-screen canvas rendering**: parallax background layers are pre-rendered once to `OffscreenCanvas` tiles and repeated via canvas patterns instead of being redrawn every frame.
- **🔥 Flame system**: collectible flame emoji pickups grant a stacking damage/XP/special-meter buff; the victory "flame on" pose plays automatically on every zone clear.
- **Emoji kill tally**: live HUD tracking 🪨 Rock Warrior / 🌿 Vine Assassin / 👊 CGI mook / 👑 boss kills.
- **Touch-only controls**: on-screen jump / left / right / punch / kick / special buttons. No mouse, no keyboard, no desktop fallback.
- **WebAudio SFX**: unlocked on first touch (required by Android Chrome's autoplay policy), synthesized — no audio files.

## Controls

- **◀ / ▶** — move
- **▲ JUMP** — jump (attacks work in the air too)
- **PUNCH / KICK** — combo tree: punch → punch chains into an uppercut finisher; punch+kick together throws a grab
- **SPECIAL** — fireball, once the special meter is full

## Running locally

Just open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8080
```

Then visit `http://localhost:8080` on an Android Chrome device (or desktop Chrome with device emulation set to a mobile viewport) to test.

## Deploying to GitHub Pages

1. Push this repo to GitHub as `mobilefighter`.
2. In the repo settings, go to **Pages** → set source to the `main` branch, root folder.
3. Your game will be live at `https://<your-username>.github.io/mobilefighter/`.
4. On an Android phone, open that URL in Chrome, tap the menu, and choose **"Add to Home screen"** to install it as a PWA.

## Project structure

```
mobilefighter/
├── index.html       # the entire game (sprites are base64-embedded, no external assets needed)
├── manifest.json     # PWA manifest
├── sw.js             # service worker (offline caching, cache-first)
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   └── apple-touch-icon.png
└── README.md
```

## Notes

- All sprite art is embedded as base64 inside `index.html` — there are no external image requests, so the offline service worker only needs to cache the app shell itself.
- The game targets a fixed 300×500 CSS pixel viewport; it is not designed to be responsive to other screen sizes or desktop use.
