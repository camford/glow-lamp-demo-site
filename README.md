# BioGlow lamp demo

Interactive static demo of the BioGlow lamp, built from the four STL parts in this repository. The deployable site is in `dist/`.

## Preview locally

```sh
python3 server.py
```

Open <http://127.0.0.1:8765/>. The site has no build step. `server.py` serves `dist/` and provides fixed same-origin routes for BirdCast migration, station wildlife detections, and directional lamp aiming. The direction proxy limits changes to angle and beam width through the station's direction endpoint and restores the prior mode when needed. Wildlife card photos come from iNaturalist observations with CC-BY licensed photos, with attribution displayed on each card. Set `BIOGLOW_API_BASE` in the server environment to change the BioGlow upstream base URL; it is never sent to the browser.

## Cloudflare Pages live light route

The Pages Function in `functions/api/bioglow/light.js` serves the same-origin `/api/bioglow/light` endpoint used by the G.L.O.W. 3D lamp. It makes a server-side request to the fixed BioGlow `/v1/latest` endpoint and returns only the live power, color, brightness, and mode fields. The new hostname does not need a browser-side API URL change; the matching Pages Function must be included in each deployment. Cloudflare dashboard drag-and-drop deployments do not compile the `functions/` directory. Deploy through Pages Git integration or Wrangler so the Function is installed with the static `dist/` assets.

## Publish with GitHub Pages

In the repository's **Settings → Pages**, set **Build and deployment → Source** to **GitHub Actions**. The workflow in `.github/workflows/deploy-pages.yml` publishes `dist/` on each push to `main`. GitHub Pages serves static files only, so it cannot host the BioGlow proxy; the live dashboard works when the site is served through `server.py` or when that proxy is deployed behind the website's own origin. The static Pages copy has no live API connection.

## Assets

The original lamp STL parts and reference photo are at the repository root. The rendered site assets are in `dist/assets/`. Recording sources and licenses are listed in [`dist/audio-credits.html`](dist/audio-credits.html).
