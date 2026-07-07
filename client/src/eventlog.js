// In-game event log: a short stack of fading lines above the rocket button (kills + pickups).
// DOM-only; pure cosmetic. Keeps the last MAX lines; each line fades over 5s via CSS then removes itself.
const MAX = 4;
let box = null;
const host = () => (box ||= document.getElementById('event-log'));

// text: the line to show. color: optional CSS color (pickup lines are tinted by the item's color).
export function logEvent(text, color) {
  const el = host(); if (!el) return;
  const line = document.createElement('div');
  line.className = 'event-line';
  line.textContent = text;
  if (color) line.style.color = color;
  el.appendChild(line);                              // newest at the bottom
  while (el.children.length > MAX) el.removeChild(el.firstChild); // drop the oldest
  line.addEventListener('animationend', () => line.remove());     // self-remove after the 5s fade
}

export function clearEventLog() { const el = host(); if (el) el.replaceChildren(); }
