// tools/frame/video-player.js
// S7.3.3 — Video artifact player for Case 001 (Morning in Prague) and future.
// Per VIDEO_EVIDENCE_SPEC v1 (LOCKED).
//
// Two operating modes:
//   REAL VIDEO  — post.video exists AND loads successfully.
//                 Full controls: play/pause, scrub, frame-step, MARK MOMENT,
//                 EXTRACT FRAME (paused only). Autosave + resume.
//   DEV MODE    — post.video absent OR file 404s. Placeholder still shown
//                 (post.video_still). Play/pause/scrub/frame-step/MARK MOMENT
//                 disabled. EXTRACT FRAME remains active — captures the still.
//                 Timestamp readout shows "--:--.-".
//
// Not a fancy component. Zero animations, zero cinematic, zero sound
// per VIDEO_EVIDENCE_SPEC §3 controls list.

import { emit as emitAction } from '../../engine/actions.js';
import {
  getState, saveVideoState, subscribe, FRAME_CAPTURE_HARD_CAP,
} from '../../engine/state.js';
import { resolveAsset } from '../../engine/case-loader.js';

const FPS = 30;
const FRAME_STEP_MS = 1000 / FPS;
const AUTOSAVE_INTERVAL_MS = 3000;
const RESUME_REWIND_MS = 1000;              // §10 — reopen at lastTime - 1s
const JPEG_QUALITY = 0.85;                  // §13 Q3 (final)
const CAPTURE_WIDTH = 720;                  // vertical 9:16
const CAPTURE_HEIGHT = 1280;

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTs(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return '--:--.-';
  const total = Math.max(0, Math.round(Number(ms)));
  const mins = Math.floor(total / 60000);
  const secs = Math.floor((total % 60000) / 1000);
  const tenths = Math.floor((total % 1000) / 100);
  return `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}.${tenths}`;
}

// Deterministic id for EXTRACT FRAME artifact — reproducible per (videoId, ms).
// DEV MODE (timestamp null) → counter suffix so multiple captures of the same
// placeholder get distinct ids.
function makeCaptureId(videoId, timestampMs, devCounter) {
  if (timestampMs == null) {
    return `frame_capture_${videoId}_dev_${devCounter}`;
  }
  const msPadded = String(Math.round(timestampMs)).padStart(7, '0');
  return `frame_capture_${videoId}_${msPadded}`;
}

// Capture the current frame to a JPEG data URI. Uses full 720x1280 target
// regardless of source render size per §13 Q3.
function captureToJpegDataURI(sourceEl) {
  const canvas = document.createElement('canvas');
  canvas.width = CAPTURE_WIDTH;
  canvas.height = CAPTURE_HEIGHT;
  const ctx = canvas.getContext('2d');
  try {
    ctx.drawImage(sourceEl, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  } catch (e) {
    console.warn('[video-player] capture failed', e);
    return null;
  }
}

// Main entry — mounts player into mountEl. Returns cleanup fn.
export function renderVideoPlayer(mountEl, opts) {
  const {
    caseData,
    profile,
    post,
    videoId,          // e.g. `${profileId}#${postId}#video`
    onClose,
    onFrameCaptured,  // called with captureId after successful extract
  } = opts;

  const posterUrl = post.video_still ? resolveAsset(caseData, post.video_still) : '';
  const videoUrl = post.video ? resolveAsset(caseData, post.video) : '';
  const videoWebm = post.video_webm ? resolveAsset(caseData, post.video_webm) : '';
  const durationMs = Number(post.video_duration_ms) || null;

  // Restore prior position from state per §10.
  const st = getState();
  const priorState = st && st.videoState && st.videoState[videoId] || null;
  const resumeMs = priorState && Number.isFinite(Number(priorState.currentTime_ms))
    ? Math.max(0, Number(priorState.currentTime_ms) - RESUME_REWIND_MS)
    : 0;

  // Bookmarks for this video from persisted state.
  const bookmarks = () => {
    const s = getState();
    return (s && s.videoBookmarks && s.videoBookmarks[videoId]) || [];
  };

  // Runtime dev-mode flag. True until we confirm the <video> can play.
  let devMode = !videoUrl;
  let devCaptureCounter = 0;

  mountEl.innerHTML = `
    <div class="video-player" data-video-id="${esc(videoId)}">
      <div class="video-player__stage tx-letterbox" style="--tx-ratio: 9 / 16;">
        ${videoUrl ? `
          <video class="video-player__video" preload="metadata" playsinline
                 ${posterUrl ? `poster="${esc(posterUrl)}"` : ''}>
            <source src="${esc(videoUrl)}" type="video/mp4">
            ${videoWebm ? `<source src="${esc(videoWebm)}" type="video/webm">` : ''}
          </video>
        ` : ''}
        <img class="video-player__poster" src="${esc(posterUrl)}" alt=""
             style="${videoUrl ? 'display:none' : ''}">
        <div class="video-player__badge-dev"
             style="${devMode ? '' : 'display:none'}">DEV MODE: PLACEHOLDER</div>
        <div class="video-player__timestamp">--:--.-</div>
      </div>

      <div class="video-player__controls">
        <button type="button" class="video-player__btn video-player__playpause"
                data-role="playpause" ${devMode ? 'disabled' : ''}
                title="Play / Pause (Space)">▷</button>
        <div class="video-player__scrub" data-role="scrub" ${devMode ? 'aria-disabled="true"' : ''}>
          <div class="video-player__scrub-fill" style="width:0%"></div>
          <div class="video-player__scrub-marks"></div>
        </div>
        <div class="video-player__time" data-role="time">00:00.0 / 00:00.0</div>
      </div>

      <div class="video-player__actions">
        <button type="button" class="btn-primary" data-role="extract-frame"
                title="EXTRACT FRAME (paused only)">EXTRACT FRAME</button>
        <button type="button" class="btn-ghost" data-role="mark-moment"
                ${devMode ? 'disabled' : ''}
                title="MARK MOMENT">MARK MOMENT</button>
        <button type="button" class="btn-ghost video-player__close"
                data-role="close" title="Close player">×</button>
      </div>

      <div class="video-player__limit-banner" style="display:none">
        FRAME CAPTURE LIMIT REACHED — DELETE AN EXISTING CAPTURE TO CONTINUE
      </div>
      <div class="video-player__capture-preview" style="display:none"></div>
    </div>
  `;

  const videoEl = mountEl.querySelector('.video-player__video');
  const posterEl = mountEl.querySelector('.video-player__poster');
  const badgeDev = mountEl.querySelector('.video-player__badge-dev');
  const tsEl = mountEl.querySelector('.video-player__timestamp');
  const playBtn = mountEl.querySelector('[data-role="playpause"]');
  const scrubEl = mountEl.querySelector('[data-role="scrub"]');
  const scrubFillEl = mountEl.querySelector('.video-player__scrub-fill');
  const scrubMarksEl = mountEl.querySelector('.video-player__scrub-marks');
  const timeEl = mountEl.querySelector('[data-role="time"]');
  const extractBtn = mountEl.querySelector('[data-role="extract-frame"]');
  const markBtn = mountEl.querySelector('[data-role="mark-moment"]');
  const closeBtn = mountEl.querySelector('[data-role="close"]');
  const limitBanner = mountEl.querySelector('.video-player__limit-banner');
  const previewEl = mountEl.querySelector('.video-player__capture-preview');

  // Renders bookmarks as ticks on the scrub bar. Called on mount + after
  // moment_marked event.
  function renderBookmarkTicks() {
    if (!scrubMarksEl) return;
    const totalMs = durationOfVideo();
    if (!totalMs) { scrubMarksEl.innerHTML = ''; return; }
    scrubMarksEl.innerHTML = bookmarks().map(bm => {
      const pct = Math.min(100, Math.max(0, (bm.timestamp / totalMs) * 100));
      return `<button type="button" class="video-player__tick"
               data-ts="${bm.timestamp}" style="left:${pct}%"
               title="${esc(formatTs(bm.timestamp))}${bm.label ? ' — ' + esc(bm.label) : ''}"></button>`;
    }).join('');
    scrubMarksEl.querySelectorAll('.video-player__tick').forEach(el => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const ts = Number(el.dataset.ts);
        if (!videoEl || devMode) return;
        videoEl.currentTime = ts / 1000;
        videoEl.pause();
        updateUI();
      });
    });
  }

  function durationOfVideo() {
    if (videoEl && videoEl.duration && Number.isFinite(videoEl.duration) && videoEl.duration > 0) {
      return videoEl.duration * 1000;
    }
    return durationMs || 0;
  }

  function currentMs() {
    if (devMode || !videoEl) return null;
    return Math.round(videoEl.currentTime * 1000);
  }

  function updateUI() {
    if (devMode) {
      tsEl.textContent = '--:--.-';
      timeEl.textContent = '--:--.- / --:--.-';
      scrubFillEl.style.width = '0%';
      playBtn.textContent = '▷';
      // Extract active even in dev — capture the poster.
      return;
    }
    const cur = videoEl.currentTime * 1000;
    const total = durationOfVideo();
    tsEl.textContent = formatTs(cur);
    timeEl.textContent = `${formatTs(cur)} / ${formatTs(total)}`;
    scrubFillEl.style.width = (total > 0 ? Math.min(100, (cur / total) * 100) : 0) + '%';
    playBtn.textContent = videoEl.paused ? '▷' : '◼';
    // EXTRACT FRAME only when paused per §4.
    extractBtn.disabled = !videoEl.paused;
    extractBtn.title = videoEl.paused
      ? 'EXTRACT FRAME'
      : 'Pause first to extract a frame';
  }

  // --- Video load lifecycle ---
  if (videoEl) {
    // Drop-to-DEV-MODE helper — invoked on error event OR
    // when no source can be played (NETWORK_NO_SOURCE).
    function fallbackToDevMode() {
      if (devMode) return;   // idempotent
      devMode = true;
      videoEl.style.display = 'none';
      posterEl.style.display = '';
      badgeDev.style.display = '';
      playBtn.disabled = true;
      markBtn.disabled = true;
      scrubEl.setAttribute('aria-disabled', 'true');
      updateUI();
    }

    videoEl.addEventListener('error', fallbackToDevMode, { once: true });

    // Source-level error propagation: <source> emits error when its URL fails.
    // If all sources fail, video.networkState becomes 3 (NO_SOURCE) without a
    // video-level error event on Chrome. Attach listeners to each <source> and
    // fall through when they all error.
    const sourceEls = Array.from(videoEl.querySelectorAll('source'));
    let sourceErrCount = 0;
    for (const s of sourceEls) {
      s.addEventListener('error', () => {
        sourceErrCount++;
        if (sourceErrCount >= sourceEls.length) fallbackToDevMode();
      }, { once: true });
    }

    // Belt-and-braces: if after 2s the network is empty (NO_SOURCE) and no
    // metadata loaded, assume DEV MODE. Prevents indefinite "loading…" state.
    setTimeout(() => {
      if (!devMode && videoEl.readyState === 0 && videoEl.networkState === 3) {
        fallbackToDevMode();
      }
    }, 2000);

    videoEl.addEventListener('loadedmetadata', () => {
      // Restore position per §10.
      if (resumeMs > 0) {
        try { videoEl.currentTime = resumeMs / 1000; } catch {}
      }
      renderBookmarkTicks();
      updateUI();
    });

    videoEl.addEventListener('timeupdate', updateUI);
    videoEl.addEventListener('play', updateUI);
    videoEl.addEventListener('pause', updateUI);
    videoEl.addEventListener('ended', () => {
      // Explicitly pause on end so EXTRACT FRAME re-enables on the last frame.
      try { videoEl.pause(); } catch {}
      updateUI();
    });
  } else {
    // No videoUrl at all — pure DEV MODE from the start.
    updateUI();
  }

  // --- Controls ---
  playBtn.addEventListener('click', () => {
    if (devMode || !videoEl) return;
    if (videoEl.paused) videoEl.play().catch(() => {});
    else videoEl.pause();
  });

  scrubEl.addEventListener('click', (ev) => {
    if (devMode || !videoEl) return;
    const rect = scrubEl.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
    videoEl.currentTime = frac * (videoEl.duration || 0);
    updateUI();
  });

  extractBtn.addEventListener('click', () => {
    if (devMode) {
      const captureId = makeCaptureId(videoId, null, devCaptureCounter++);
      const imageDataUri = captureToJpegDataURI(posterEl);
      emitAction('extract_frame', {
        videoId,
        timestamp: null,
        capturedArtifactId: captureId,
        imageDataUri: imageDataUri || undefined,
      });
      return;
    }
    if (!videoEl || !videoEl.paused) return;
    const ts = currentMs();
    const captureId = makeCaptureId(videoId, ts, 0);
    const imageDataUri = captureToJpegDataURI(videoEl);
    emitAction('extract_frame', {
      videoId,
      timestamp: ts,
      capturedArtifactId: captureId,
      imageDataUri: imageDataUri || undefined,
    });
  });

  markBtn.addEventListener('click', () => {
    if (devMode || !videoEl) return;
    emitAction('mark_moment', { videoId, timestamp: currentMs() });
  });

  closeBtn.addEventListener('click', () => {
    persistNow();
    onClose && onClose();
  });

  // Keyboard shortcuts (space play/pause; ← / → frame step when paused).
  function onKeydown(ev) {
    if (!mountEl.isConnected) return;  // component unmounted
    // Only handle keys when the player is visible in the pane.
    const target = ev.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    if (ev.code === 'Space') {
      ev.preventDefault();
      playBtn.click();
    } else if (ev.code === 'ArrowLeft' && videoEl && !devMode && videoEl.paused) {
      ev.preventDefault();
      videoEl.currentTime = Math.max(0, videoEl.currentTime - FRAME_STEP_MS / 1000);
      updateUI();
    } else if (ev.code === 'ArrowRight' && videoEl && !devMode && videoEl.paused) {
      ev.preventDefault();
      videoEl.currentTime = Math.min(
        videoEl.duration || 0,
        videoEl.currentTime + FRAME_STEP_MS / 1000);
      updateUI();
    }
  }
  document.addEventListener('keydown', onKeydown);

  // --- State bus subscription: react to frame_capture_limit_reached +
  //     frame_captured (preview) + moment_marked (redraw ticks). ---
  const offSubscribe = subscribe((evt) => {
    if (evt.type === 'frame_capture_limit_reached') {
      limitBanner.style.display = '';
      extractBtn.disabled = true;
      extractBtn.title = 'Frame capture limit reached — delete a capture first';
    } else if (evt.type === 'frame_captured') {
      // Only react if this player owns the captured video.
      if (evt.capture && evt.capture.sourceVideoId === videoId) {
        showCapturePreview(evt.capture);
      }
    } else if (evt.type === 'frame_capture_deleted') {
      // Free the limit banner if we dropped below cap.
      const cur = getState();
      if (cur && Array.isArray(cur.frameCaptures) && cur.frameCaptures.length < FRAME_CAPTURE_HARD_CAP) {
        limitBanner.style.display = 'none';
        if (!devMode && videoEl && videoEl.paused) extractBtn.disabled = false;
        if (devMode) extractBtn.disabled = false;
      }
    } else if (evt.type === 'moment_marked' && evt.videoId === videoId) {
      renderBookmarkTicks();
    }
  });

  function showCapturePreview(capture) {
    previewEl.style.display = '';
    const ts = formatTs(capture.sourceTimestamp_ms);
    previewEl.innerHTML = `
      <div class="video-player__preview-inner">
        <img src="${esc(capture.imageDataUri || '')}" alt="Frame ${esc(ts)}">
        <div class="video-player__preview-meta">
          <span>Captured ${esc(ts)}</span>
          <button type="button" class="btn-primary btn-primary--sm"
                  data-role="preview-add">+ ADD TO CASE</button>
          <button type="button" class="btn-ghost btn-ghost--sm"
                  data-role="preview-dismiss">DISMISS</button>
        </div>
      </div>
    `;
    previewEl.querySelector('[data-role="preview-add"]').addEventListener('click', () => {
      emitAction('add_to_case', { artifactId: capture.id, tool: 'frame' });
      onFrameCaptured && onFrameCaptured(capture.id);
      previewEl.style.display = 'none';
      previewEl.innerHTML = '';
    });
    previewEl.querySelector('[data-role="preview-dismiss"]').addEventListener('click', () => {
      previewEl.style.display = 'none';
      previewEl.innerHTML = '';
    });
  }

  // --- Autosave loop + persist on close ---
  function persistNow() {
    if (devMode || !videoEl) return;
    saveVideoState(videoId, {
      currentTime_ms: Math.round((videoEl.currentTime || 0) * 1000),
      playing: !videoEl.paused,
    });
  }
  const autosaveId = setInterval(persistNow, AUTOSAVE_INTERVAL_MS);

  // Cleanup: called by frame.js when player mount is torn down.
  const cleanup = () => {
    clearInterval(autosaveId);
    document.removeEventListener('keydown', onKeydown);
    persistNow();
    offSubscribe();
    try { if (videoEl) videoEl.pause(); } catch {}
  };

  // Return cleanup so callers can dismount.
  return cleanup;
}
