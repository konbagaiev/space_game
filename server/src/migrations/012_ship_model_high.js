// 012 — ship hangar (high-poly) model URL. `ships.model_url` stays the combat (low-poly, same-origin)
// model; `model_url_high` is the optional hangar high-poly model (CloudFront, lazy-loaded). Nullable, no
// default (primitive/none when null). See docs/plans/ship-model-pipeline.md + DECISIONS §14.
export const up = (db) => {
  db.exec(`ALTER TABLE ships ADD COLUMN model_url_high TEXT;`);
};
