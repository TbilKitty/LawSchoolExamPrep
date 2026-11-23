// Celebration / wrong-answer effects, synthesized sounds and read-aloud.

let ctx = null;
function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(ac, { freq, to, start, dur, type = 'triangle', gain = 0.18 }) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  if (to) o.frequency.exponentialRampToValueAtTime(to, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(ac.destination);
  o.start(start);
  o.stop(start + dur + 0.02);
}

export function playCoin() {
  const ac = audio(); if (!ac) return;
  const t = ac.currentTime + 0.01;
  tone(ac, { freq: 988, start: t, dur: 0.09, type: 'square', gain: 0.08 });
  tone(ac, { freq: 1319, start: t + 0.08, dur: 0.28, type: 'square', gain: 0.08 });
  [2637, 3136, 3520].forEach((f, i) => tone(ac, { freq: f, start: t + 0.14 + i * 0.05, dur: 0.18, type: 'sine', gain: 0.04 }));
}

export function playBonk() {
  const ac = audio(); if (!ac) return;
  const t = ac.currentTime + 0.01;
  tone(ac, { freq: 240, to: 110, start: t, dur: 0.32, type: 'sawtooth', gain: 0.07 });
  tone(ac, { freq: 180, to: 90, start: t + 0.12, dur: 0.3, type: 'triangle', gain: 0.08 });
}

export function moneyRain(target, { motion = true } = {}) {
  const fx = document.getElementById('fx');
  if (!motion) {
    if (target) { target.classList.remove('glow'); void target.offsetWidth; target.classList.add('glow'); }
    return;
  }
  const w = window.innerWidth;
  const n = Math.min(34, Math.max(18, Math.round(w / 18)));
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    const bill = Math.random() < 0.35;
    el.className = 'drop ' + (bill ? 'bill' : 'coin');
    el.textContent = '$';
    el.style.left = Math.round(Math.random() * (w - 40)) + 'px';
    el.style.animationDelay = Math.round(Math.random() * 220) + 'ms';
    el.style.setProperty('--dur', (850 + Math.round(Math.random() * 350)) + 'ms');
    el.style.setProperty('--dx', (Math.round(Math.random() * 80) - 40) + 'px');
    el.style.setProperty('--rot', (Math.random() < 0.5 ? -1 : 1) * (180 + Math.round(Math.random() * 360)) + 'deg');
    fx.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }
  const plus = document.createElement('div');
  plus.className = 'plus'; plus.textContent = '+1';
  fx.appendChild(plus);
  setTimeout(() => plus.remove(), 1000);
}

export function inkSplat(target, { motion = true } = {}) {
  const fx = document.getElementById('fx');
  if (!motion) return;
  const el = document.createElement('div');
  el.className = 'splat';
  el.innerHTML = `<svg viewBox="0 0 200 200" width="220" height="220">
    <path fill="#e0384f" d="M100 28c14 0 18 18 30 20s26-10 34 2-6 22-2 34 22 18 16 32-24 6-30 16 6 28-8 36-22-10-36-10-24 16-36 8 0-26-8-36-30-4-34-18 14-20 12-32-18-20-8-32 26 2 36-4 12-16 34-16z"/>
    <circle cx="36" cy="40" r="9" fill="#e0384f"/><circle cx="170" cy="150" r="7" fill="#e0384f"/>
    <circle cx="160" cy="34" r="5" fill="#e0384f"/><circle cx="30" cy="160" r="6" fill="#e0384f"/>
    <text x="100" y="114" text-anchor="middle" font-size="30" font-weight="900" fill="#fff" font-family="-apple-system, sans-serif">oops</text>
  </svg>`;
  fx.appendChild(el);
  setTimeout(() => el.remove(), 1000);
  if (target) { target.classList.remove('shake'); void target.offsetWidth; target.classList.add('shake'); }
}

// ---------- read aloud ----------
let speaking = false;
export function canSpeak() { return 'speechSynthesis' in window; }
export function speak(text, onEnd) {
  if (!canSpeak()) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/§§/g, 'sections ').replace(/§/g, 'section ').replace(/\(([a-z0-9]{1,4})\)/gi, ' $1 '));
  u.rate = 0.95;
  u.onend = () => { speaking = false; onEnd && onEnd(); };
  u.onerror = () => { speaking = false; onEnd && onEnd(); };
  speaking = true;
  window.speechSynthesis.speak(u);
  return true;
}
export function stopSpeaking() { if (canSpeak()) window.speechSynthesis.cancel(); speaking = false; }
export function isSpeaking() { return speaking; }
