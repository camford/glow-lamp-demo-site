# BioGlow lamp demo

Interactive static demo of the BioGlow lamp, built from the four STL parts in this repository. The deployable site is in `dist/`.

## Preview locally

```sh
python3 -m http.server 8765 --directory dist
```

Open <http://127.0.0.1:8765/>. The site has no build step. The Migration response map loads OpenStreetMap tiles over the network; the rest of the demo is served from `dist/`.

## Publish with GitHub Pages

In the repository's **Settings → Pages**, set **Build and deployment → Source** to **GitHub Actions**. The workflow in `.github/workflows/deploy-pages.yml` publishes `dist/` on each push to `main`; no build step is needed. After the first successful run, the site is available at <https://camford.github.io/glow-lamp-demo-site/>.

## Assets

The original lamp STL parts and reference photo are at the repository root. The rendered site assets are in `dist/assets/`. Recording sources and licenses are listed in [`dist/audio-credits.html`](dist/audio-credits.html). OpenStreetMap attribution appears on the map.
