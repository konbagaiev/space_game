// 016 — item 3D models: components/weapons gain the same model fields ships already have.
// We populate only model_url_high (hangar, CloudFront) for now — items are menu-only icons, never
// rendered in combat — so model_url (combat/same-origin) stays nullable & unused. See
// docs/plans/component-weapon-models.md.
export const up = (db) => {
  db.exec('ALTER TABLE components ADD COLUMN model_url TEXT;');
  db.exec('ALTER TABLE components ADD COLUMN model_url_high TEXT;');
  db.exec('ALTER TABLE weapons ADD COLUMN model_url TEXT;');
  db.exec('ALTER TABLE weapons ADD COLUMN model_url_high TEXT;');
};
