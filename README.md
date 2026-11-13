# BioGlow lamp demo

Interactive static demo of the BioGlow lamp, built from the four STL parts in this repository. The deployable site is in `dist/`.

## Preview locally

```sh
python3 -m http.server 8765 --directory dist
```

Open <http://127.0.0.1:8765/>. The site has no build step. The Migration response map loads OpenStreetMap tiles over the network; the rest of the demo is served from `dist/`.

## Assets

The original lamp STL parts and reference photo are at the repository root. The rendered site assets are in `dist/assets/`. Recording sources and licenses are listed in [`dist/audio-credits.html`](dist/audio-credits.html). OpenStreetMap attribution appears on the map.
