import './style.css';

// The game loop is still the single-file prototype, ported as an ES module.
// It moves into typed modules (renderer, world, skarn, player, hud, audio) as each system is upgraded.
import('./legacy/game.js').catch((err: unknown) => {
  console.error(err);
  const el = document.getElementById('loadErr');
  if (el) el.textContent = 'The game failed to start. Try a recent desktop Chrome, Edge or Firefox.';
});
