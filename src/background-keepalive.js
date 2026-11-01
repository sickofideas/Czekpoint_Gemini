/**
 * Czekpoint — Podpora běhu a záznamu na pozadí i při zhasnutém displeji / v kapse.
 * 
 * Využívá kombinaci:
 * 1. Přehrávání neslyšného audio streamu ve smyčce (Silent Audio Keep-Alive),
 *    které mobilním systémům (Android, iOS Safari) signalizuje aktivní mediální službu.
 *    Díky tomu operační systém neuspí vlákno JavaScriptu a nepřeruší navigator.geolocation.watchPosition.
 * 2. Media Session API (notifikace na zamčené obrazovce se stavem výpravy a tlačítky Pauza/Ukončit).
 * 3. Screen Wake Lock API (volitelné zabránění zhasnutí obrazovky, pokud je zapnuto).
 */

// Generuje 2sekundový platný 8-bit PCM WAV soubor (8000 Hz, 16 000 vzorků) s nepatrným střídáním 128/129,
// aby mobilní OS (Android Chrome, iOS Safari) nevyhodnotil stream jako nulové ticho a neuspal proces při zhasnutí displeje.
function buildKeepAliveWavDataUri() {
  try {
    const sampleRate = 8000;
    const durationSec = 2;
    const numSamples = sampleRate * durationSec;
    const buffer = new ArrayBuffer(44 + numSamples);
    const view = new DataView(buffer);
    const writeStr = (offset, str) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + numSamples, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true); // 8-bit
    writeStr(36, 'data');
    view.setUint32(40, numSamples, true);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < numSamples; i++) {
      bytes[44 + i] = (i & 1) === 0 ? 128 : 129;
    }
    if (typeof btoa === 'function') {
      let binary = '';
      const chunkSize = 4096;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
      }
      return 'data:audio/wav;base64,' + btoa(binary);
    }
    if (typeof Buffer !== 'undefined') {
      return 'data:audio/wav;base64,' + Buffer.from(bytes).toString('base64');
    }
  } catch {}
  return 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAESsAAABAAgAZGF0YQQAAACAgICA';
}

export const SILENT_WAV_BASE64 = buildKeepAliveWavDataUri();

let audioElement = null;
let audioTickCallback = null;
let trackingShouldStayActive = false;

export function getAudioKeepaliveElement() {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return null;
  if (!audioElement) {
    try {
      audioElement = new Audio(SILENT_WAV_BASE64);
      audioElement.loop = true;
      audioElement.playsInline = true;
      audioElement.setAttribute?.('playsinline', '');
      audioElement.setAttribute?.('webkit-playsinline', '');
      audioElement.volume = 0.01;
      audioElement.addEventListener?.('timeupdate', () => {
        if (typeof audioTickCallback === 'function') {
          try {
            audioTickCallback(Date.now());
          } catch {}
        }
      });
      audioElement.addEventListener?.('ended', () => {
        if (trackingShouldStayActive && audioElement) {
          try {
            audioElement.currentTime = 0;
            const p = audioElement.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
          } catch {}
        }
      });
    } catch {
      audioElement = null;
    }
  }
  return audioElement;
}

/**
 * @param {Object} [options]
 * @param {string} [options.title]
 * @param {string} [options.artist]
 * @param {string} [options.album]
 * @param {(() => void) | null} [options.onPause]
 * @param {(() => void) | null} [options.onResume]
 * @param {(() => void) | null} [options.onStop]
 * @param {((now: number) => void) | null} [options.onTick]
 */
export function startBackgroundTracking({
  title = 'Záznam výpravy běží',
  artist = 'Czekpoint · Objevování a mapa',
  album = 'Záznam trasy na pozadí',
  onPause = /** @type {(() => void) | null} */ (null),
  onResume = /** @type {(() => void) | null} */ (null),
  onStop = /** @type {(() => void) | null} */ (null),
  onTick = /** @type {((now: number) => void) | null} */ (null),
} = {}) {
  if (typeof window === 'undefined' && typeof navigator === 'undefined') return;

  trackingShouldStayActive = true;
  if (typeof onTick === 'function') {
    audioTickCallback = onTick;
  }

  const audio = getAudioKeepaliveElement();
  if (audio) {
    try {
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
    } catch {}
  }

  if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist,
        album,
        artwork: [
          { src: './assets/icon.svg', sizes: '96x96', type: 'image/svg+xml' },
          { src: './assets/icon.svg', sizes: '192x192', type: 'image/svg+xml' },
        ],
      });
      navigator.mediaSession.playbackState = 'playing';

      if (typeof onPause === 'function') {
        navigator.mediaSession.setActionHandler('pause', () => onPause());
      }
      if (typeof onResume === 'function') {
        navigator.mediaSession.setActionHandler('play', () => onResume());
      }
      if (typeof onStop === 'function') {
        navigator.mediaSession.setActionHandler('stop', () => onStop());
      }
    } catch {}
  }
}

export function updateBackgroundTracking({ title, album } = {}) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !navigator.mediaSession?.metadata) return;
  try {
    if (title) navigator.mediaSession.metadata.title = title;
    if (album) navigator.mediaSession.metadata.album = album;
  } catch {}
}

export function pauseBackgroundTracking() {
  trackingShouldStayActive = false;
  const audio = getAudioKeepaliveElement();
  if (audio) {
    try { audio.pause(); } catch {}
  }
  if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
    try {
      navigator.mediaSession.playbackState = 'paused';
    } catch {}
  }
}

export function stopBackgroundTracking() {
  trackingShouldStayActive = false;
  const audio = getAudioKeepaliveElement();
  if (audio) {
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {}
  }
  if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
    try {
      navigator.mediaSession.playbackState = 'none';
    } catch {}
  }
}
