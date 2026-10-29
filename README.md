# Stranded Corps

A first-person survival game in the browser. You are a Frontier Expeditionary Corps marine stranded on the moon Veyra-9 after the Haldane Colony evacuation. Scavenge, research, fortify, and survive the Skarn hive until you can kill the Broodmother.

Play it at https://wankertank.github.io/stranded-corps/ once GitHub Pages is on (Settings, Pages, Source: GitHub Actions). Every push to `main` deploys.

## Develop

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck and production build into dist/
```

Desktop browser with keyboard and mouse. Click Deploy to lock the mouse.

## Layout

- `index.html` holds the HUD and menu markup, `src/style.css` the HUD styles.
- `src/main.ts` is the entry point.
- `src/legacy/game.js` is the first-person prototype, ported as one ES module on the current Three.js. It gets split into typed modules as each system is rebuilt.

## Roadmap

1. Project setup and port (this step).
2. Renderer upgrade: Poly Haven CC0 PBR terrain and metal textures, HDRI sky, bloom, ambient occlusion, fog volumes, film grain.
3. CC0 props and weapons (Quaternius, Kenney, Poly Haven) replacing the box geometry.
4. Skarn creature models: AI-generated bases, cleaned up and rigged, with animation.
5. Feel: recorded audio, hit reactions, weapon animation, camera effects.

Art stays free: CC0 packs and AI-generated models only. Credit each pack in `CREDITS.md` as it is added.
