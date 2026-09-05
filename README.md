# matthew-foote.github.io

Personal portfolio site. Built with [Astro](https://astro.build), deployed to GitHub Pages by the workflow in `.github/workflows/deploy.yml` on every push to `main`.

## Editing

- **Text**: each section is one file in `src/components/` (`Hero`, `About`, `Skills`, `Experience`, `Ambition`, `Contact`). Edit the copy in place.
- **Links, emails, YouTube IDs**: `src/data/site.ts`. Paste a YouTube ID into `youtube.kizik` or `youtube.arcboat` and the placeholder becomes an embed.
- **Photos**: drop files into `src/assets/img/` and import them in the component. Astro resizes and converts them at build time.
- **Video loops**: `public/media/video/`. Keep them short, muted, and under ~10 MB.
- **Engine model**: `public/models/engine.glb`. Export the full assembly from Onshape as glTF to get all the part hotspots.
- **Logos**: `src/assets/img/logo-*.png`. Add Prusa, Bambu Lab, and Premiere Pro there and list them in `src/components/Skills.astro`.
- **Resume**: replace `public/resume/Matthew_Foote_Resume.pdf`.

## Running locally

```
npm install
npm run dev      # http://localhost:4321
npm run build    # writes dist/
```

## Notes

- The Enlisted boat film is cleared for this site only, so it is not in this repo. Host it as an unlisted YouTube video and paste the ID into `site.ts`.
- The Starship photo is SpaceX's and is credited on the page.
