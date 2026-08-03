// ============================================================================
// assets.js — loads real external sprite sheets + JSON frame metadata.
// Drop new sheets in assets/sprites/, add an entry here, and they're available
// everywhere else in the engine — no base64, no single giant HTML file.
// ============================================================================

const Assets = (function(){
  "use strict";

  function loadImage(src){
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image: ' + src));
      img.src = src;
    });
  }

  function loadJSON(src){
    return fetch(src).then(r => {
      if (!r.ok) throw new Error('Failed to load JSON: ' + src);
      return r.json();
    });
  }

  // frame ranges by animation name, shared helper used by both packs
  function rangeFrames(meta, name){
    const a = meta.anims[name];
    const out = [];
    for (let i = 0; i < a.count; i++) out.push(a.start + i);
    return out;
  }

  async function loadAll(basePath){
    basePath = basePath || 'assets/sprites/';
    const [
      fighterImg, fighterMeta,
      elementalImg, elementalMeta,
      flameDemonImg, flameDemonMeta,
      extraImg, extraMeta
    ] = await Promise.all([
      loadImage(basePath + 'fighter_atlas.png'),
      loadJSON(basePath + 'fighter_meta.json'),
      loadImage(basePath + 'elemental_atlas.png'),
      loadJSON(basePath + 'elemental_meta.json'),
      loadImage(basePath + 'flame_demon_atlas.png'),
      loadJSON(basePath + 'flame_demon_meta.json'),
      loadImage(basePath + 'enemies_extra_atlas.png'),
      loadJSON(basePath + 'enemies_extra_meta.json')
    ]);
    return {
      fighterImg, fighterMeta,
      elementalImg, elementalMeta,
      flameDemonImg, flameDemonMeta,
      extraImg, extraMeta
    };
  }

  return { loadImage, loadJSON, rangeFrames, loadAll };
})();
