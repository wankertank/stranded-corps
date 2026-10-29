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
- `src/render/` holds the typed rendering modules: `postfx.ts` (ambient occlusion, bloom, lens pass), `materials.ts` (texture loading, triplanar PBR, terrain blend, HDRI lighting), `tonemap.ts` (keeps fog, sky and decals looking as tuned under post-processing).
- `src/legacy/game.js` is the first-person prototype, ported as one ES module on the current Three.js. It gets split into typed modules as each system is rebuilt.
- `public/textures`, `public/hdri` and `public/models` hold CC0 art; see `CREDITS.md`. Models are packed with `gltf-transform optimize --compress meshopt --texture-compress webp`.

Press G in game to switch between high and low graphics (low drops ambient occlusion and renders at 1x pixel ratio). `?q=low` in the URL starts in low.

## Roadmap

1. Project setup and port. Done.
2. Renderer upgrade: Poly Haven CC0 PBR textures, HDRI lighting, bloom, ambient occlusion, film grain. Done.
3. CC0 props: Poly Haven scanned rocks, loot containers, colony kit, concrete barricades and the service pistol. Done. The pulse rifle, smart gun and flamer stay procedural until a fitting free sci-fi model turns up.
4. Skarn creature models and the crashed dropship, sculpted in code (`src/render/skarn.ts`, `src/render/shapes.ts`): glossy ribbed hide, swept-back craniums, jaws, dorsal tubes, forearms, bladed tails; a lofted dropship hull with engine pods, ramp and hull breach. Done. AI-generated Skarn can still replace these later.
5. Feel: magazines and reloading (12-round sidearm, 99-round pulse rifle with its counter, 100-unit flamer tank, 500-round smart gun drum), procedural weapon animation (draw, reload, slide and bolt, sprint and sway), layered synthesized gun, reload and Skarn sounds. Done. Still open: hit reactions, camera effects, recorded audio.

Art stays free: CC0 packs and AI-generated models only. Credit each pack in `CREDITS.md` as it is added.
