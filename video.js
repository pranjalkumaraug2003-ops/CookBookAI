// YouTube mode: the recipe video plays inside Cook-Along through YouTube's official IFrame Player API.
// Nothing is downloaded or scraped; the video streams from YouTube exactly as it would on youtube.com.
// https://developers.google.com/youtube/iframe_api_reference

let apiPromise = null;

function loadApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) try { prev(); } catch (_) { /* ignore */ } resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => { apiPromise = null; reject(new Error('YouTube could not be reached')); };
    document.head.appendChild(s);
    setTimeout(() => { if (!(window.YT && window.YT.Player)) { apiPromise = null; reject(new Error('YouTube took too long to load')); } }, 15000);
  });
  return apiPromise;
}

// YT.PlayerState: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
export const PLAYING = 1;
export const BUFFERING = 3;

export function createVideo(host, videoId, { onState, onReady, onError } = {}) {
  const ctl = {
    ready: false,
    failed: null,
    state: -1,
    player: null,
    pendingSeek: null,
    play() { if (this.ready) { try { this.player.playVideo(); } catch (_) { /* ignore */ } } },
    pause() { if (this.ready) { try { this.player.pauseVideo(); } catch (_) { /* ignore */ } } },
    seek(t, play = false) {
      if (!this.ready) { this.pendingSeek = { t, play }; return; }
      try { this.player.seekTo(Math.max(0, t), true); if (play) this.player.playVideo(); } catch (_) { /* ignore */ }
    },
    time() { try { return this.ready ? this.player.getCurrentTime() || 0 : 0; } catch (_) { return 0; } },
    playing() { return this.ready && (this.state === PLAYING || this.state === BUFFERING); },
    destroy() { try { if (this.player) this.player.destroy(); } catch (_) { /* ignore */ } this.player = null; this.ready = false; },
  };
  const mountEl = document.createElement('div');
  host.innerHTML = '';
  host.appendChild(mountEl);
  loadApi().then((YT) => {
    ctl.player = new YT.Player(mountEl, {
      videoId,
      width: '100%',
      height: '100%',
      // playsinline keeps it on the page on iOS; rel=0 keeps suggestions to the same channel.
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 1, fs: 0, iv_load_policy: 3, origin: location.origin },
      events: {
        onReady: () => {
          ctl.ready = true;
          if (ctl.pendingSeek) { const p = ctl.pendingSeek; ctl.pendingSeek = null; ctl.seek(p.t, p.play); }
          if (onReady) onReady();
        },
        onStateChange: (e) => { ctl.state = e.data; if (onState) onState(e.data); },
        // 2 bad id, 5 HTML5 error, 100 removed or private, 101/150 the owner blocks embedding
        onError: (e) => {
          ctl.failed = { 2: 'This video link is not valid.', 5: 'The video could not play here.', 100: 'This video was removed or is private.', 101: 'The owner does not allow this video to play inside other apps.', 150: 'The owner does not allow this video to play inside other apps.' }[e.data] || 'The video could not play.';
          if (onError) onError(ctl.failed);
        },
      },
    });
  }).catch((err) => {
    ctl.failed = navigator.onLine === false ? 'You are offline, so the video cannot play. The steps still work.' : (err.message || 'YouTube could not be reached.');
    if (onError) onError(ctl.failed);
  });
  return ctl;
}

export function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

export function parseTime(text) {
  if (text == null || text === '') return null;
  const parts = String(text).trim().split(':').map((x) => Number(x));
  if (parts.some((x) => !Number.isFinite(x) || x < 0)) return null;
  return parts.reduce((acc, x) => acc * 60 + x, 0);
}

export function youtubeId(url) {
  const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}
