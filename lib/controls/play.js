// lib/controls/play.js — Play/pause and Restart in the bottom-left corner.
import { h } from '../site/dom.js';

export function mountPlay(fig) {
  const play = h('button', { class: 'x-play', type: 'button', 'aria-pressed': 'false' }, 'Play');
  const restart = h('button', { class: 'x-restart', type: 'button' }, 'Restart');
  play.addEventListener('click', () => (fig.playing ? fig.pause() : fig.play()));
  restart.addEventListener('click', () => fig.restart());
  const el = h('div', { class: 'x-corner x-corner-left' }, play, restart);
  return {
    el,
    sync() {
      play.setAttribute('aria-pressed', String(fig.playing));
      const text = fig.playing ? 'Pause' : 'Play';
      if (play.textContent !== text) play.textContent = text;
    },
  };
}
