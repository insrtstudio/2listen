import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Track } from '@shared/types'
import { getAnalysis } from '@/lib/analysis'
import { fmtDuration } from '@/lib/format'
import { getPeaks } from '@/lib/peaks'
import { player } from '@/lib/player'
import { ClipRecorder, clipExt, pickClipMime } from '@/lib/recorder'
import { FORMATS, Stage, clipName, loadStageFonts, parseVersion, type StageFormat, type StageState } from '@/lib/stage'
import { useStore } from '@/lib/store'

const TOP = 44 // barre du haut (feux macOS + sortie)
const CTRL = 92 // deux rangées de commandes
const PREF = 'tl.streamer'

interface Prefs {
  format: StageFormat
  camera: string
  mirror: boolean
  mic: boolean
  /** Thème de la scène et de l'interface streamer, indépendant de l'app. */
  theme: 'light' | 'dark'
}

function loadPrefs(appTheme: 'light' | 'dark'): Prefs {
  const def: Prefs = { format: 'post', camera: '', mirror: true, mic: false, theme: appTheme }
  try {
    const raw = localStorage.getItem(PREF)
    if (raw) return { ...def, ...(JSON.parse(raw) as Partial<Prefs>) }
  } catch {
    /* préférences illisibles */
  }
  return def
}

/** Petit bouton de commande, style bloc. */
function Cmd({
  children,
  on,
  onClick,
  title,
  disabled,
  acc
}: {
  children: React.ReactNode
  on?: boolean
  onClick: () => void
  title?: string
  disabled?: boolean
  acc?: boolean
}): React.ReactNode {
  return (
    <button
      className={`blk tap ${acc ? 'acc' : ''}`}
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: '6px 10px',
        fontSize: 11,
        background: on ? 'var(--ink)' : undefined,
        color: on ? 'var(--paper)' : undefined,
        whiteSpace: 'nowrap',
        flex: 'none'
      }}
    >
      {children}
    </button>
  )
}

export default function StreamerView(): React.ReactNode {
  const { setStreamer, tracks, settings } = useStore()
  const snap = useSyncExternalStore(player.subscribe, player.getSnapshot)
  const track = snap.track

  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs(settings.theme))
  const patch = (p: Partial<Prefs>): void => setPrefs((v) => ({ ...v, ...p }))
  useEffect(() => {
    try {
      localStorage.setItem(PREF, JSON.stringify(prefs))
    } catch {
      /* stockage indisponible */
    }
  }, [prefs])

  const [cams, setCams] = useState<MediaDeviceInfo[]>([])
  const [camNonce, setCamNonce] = useState(0)
  const [camError, setCamError] = useState<string | null>(null)
  const [micError, setMicError] = useState<string | null>(null)
  const [version, setVersion] = useState('')
  const [rec, setRec] = useState<'idle' | 'rec' | 'saving'>('idle')
  const [recSec, setRecSec] = useState(0)
  const [notice, setNotice] = useState<{ text: string; path?: string; error?: boolean } | null>(null)
  const [picker, setPicker] = useState(false)
  const [q, setQ] = useState('')

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<Stage | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const camStreamRef = useRef<MediaStream | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<ClipRecorder | null>(null)
  const versionsRef = useRef(new Map<string, string>())
  const stateRef = useRef<StageState>({
    track: null, peaks: null, analysis: null, cover: null, video: null,
    mirror: true, version: '', time: 0, duration: 0, playing: false
  })

  const mime = useMemo(pickClipMime, [])
  const ext = clipExt(mime)
  const fmt = FORMATS[prefs.format]

  // ---- fenêtre au format de la scène ---------------------------------------
  useEffect(() => {
    void window.tl.win.streamer(true, fmt.w / fmt.h, TOP + CTRL)
  }, [fmt.w, fmt.h])
  useEffect(() => () => void window.tl.win.streamer(false, 0, 0), [])

  // ---- scène + boucle de rendu (30 i/s, même cadence que la capture) --------
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const stage = new Stage(canvas)
    stageRef.current = stage
    let raf = 0
    let last = 0
    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop)
      // tolérance de 5 ms : les rAF tombent à 33,3 ms, pas 33,33 — sinon on
      // saute une image sur trois et le clip tombe à 20 i/s
      if (now - last < 1000 / 30 - 5) return
      last = now
      const s = stateRef.current
      s.time = player.currentTime()
      s.duration = s.track?.duration ?? 0
      s.playing = player.playing
      stage.draw(s)
    }
    void loadStageFonts().then(() => stage.draw(stateRef.current))
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  useEffect(() => {
    stageRef.current?.setFormat(prefs.format)
  }, [prefs.format])
  useEffect(() => {
    stateRef.current.mirror = prefs.mirror
  }, [prefs.mirror])
  useEffect(() => {
    stateRef.current.version = version
  }, [version])
  const editVersion = (v: string): void => {
    setVersion(v)
    if (track) versionsRef.current.set(track.id, v)
  }

  // ---- piste : pics, analyse, pochette, version par défaut -------------------
  useEffect(() => {
    const s = stateRef.current
    s.track = track
    s.peaks = null
    s.analysis = null
    s.cover = null
    if (!track) {
      setVersion('')
      return
    }
    setVersion(versionsRef.current.get(track.id) ?? parseVersion(track.title))
    let alive = true
    void getPeaks(track.id, track.path).then((p) => {
      if (alive) s.peaks = p
    })
    void getAnalysis(track.id, track.path).then((a) => {
      if (alive) s.analysis = a
    })
    if (track.cover) {
      void window.tl.url.cover(track.cover).then((url) => {
        const img = new Image()
        img.onload = () => {
          if (alive) s.cover = img
        }
        img.src = url
      })
    }
    return () => {
      alive = false
    }
  }, [track])

  // ---- webcam ----------------------------------------------------------------
  // une caméra branchée/débranchée (ou un iPhone en Continuité) relance la prise
  useEffect(() => {
    const onChange = (): void => setCamNonce((n) => n + 1)
    navigator.mediaDevices.addEventListener('devicechange', onChange)
    return () => navigator.mediaDevices.removeEventListener('devicechange', onChange)
  }, [])
  useEffect(() => {
    let alive = true
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    videoRef.current = video
    stateRef.current.video = video
    void (async () => {
      setCamError(null)
      try {
        await window.tl.media.access('camera')
        const constraints: MediaStreamConstraints = {
          video: {
            deviceId: prefs.camera ? { exact: prefs.camera } : undefined,
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 }
          },
          audio: false
        }
        let stream: MediaStream
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints)
        } catch (err) {
          // la caméra mémorisée a disparu : on prend celle par défaut
          if (!prefs.camera) throw err
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        }
        if (!alive) {
          for (const tr of stream.getTracks()) tr.stop()
          return
        }
        camStreamRef.current = stream
        video.srcObject = stream
        await video.play().catch(() => {})
        const devices = await navigator.mediaDevices.enumerateDevices()
        if (alive) setCams(devices.filter((d) => d.kind === 'videoinput'))
      } catch (err) {
        if (alive) {
          stateRef.current.video = null
          const msg = err instanceof Error ? err.message : ''
          setCamError(
            /not found/i.test(msg)
              ? 'no camera found — plug one in (or use an iPhone via Continuity)'
              : /denied|permission/i.test(msg)
                ? 'access denied — System Settings › Privacy › Camera'
                : msg || 'camera unavailable'
          )
        }
      }
    })()
    return () => {
      alive = false
      for (const tr of camStreamRef.current?.getTracks() ?? []) tr.stop()
      camStreamRef.current = null
      video.srcObject = null
      if (videoRef.current === video) {
        videoRef.current = null
        stateRef.current.video = null
      }
    }
  }, [prefs.camera, camNonce])

  // ---- micro (optionnel, mixé dans le clip seulement) ---------------------------
  useEffect(() => {
    if (!prefs.mic) {
      for (const tr of micStreamRef.current?.getTracks() ?? []) tr.stop()
      micStreamRef.current = null
      setMicError(null)
      return
    }
    let alive = true
    void (async () => {
      try {
        await window.tl.media.access('microphone')
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        if (!alive) {
          for (const tr of stream.getTracks()) tr.stop()
          return
        }
        micStreamRef.current = stream
        setMicError(null)
      } catch (err) {
        if (alive) setMicError(err instanceof Error ? err.message : 'mic unavailable')
      }
    })()
    return () => {
      alive = false
    }
  }, [prefs.mic])

  // ---- enregistrement ---------------------------------------------------------
  const startRec = async (): Promise<void> => {
    if (rec !== 'idle') return
    setNotice(null)
    const canvas = canvasRef.current
    if (!canvas) return
    const r = new ClipRecorder()
    try {
      await r.start(canvas, prefs.mic ? micStreamRef.current : null)
    } catch (err) {
      setNotice({ text: err instanceof Error ? err.message : 'Could not start recording', error: true })
      return
    }
    recorderRef.current = r
    setRecSec(0)
    setRec('rec')
  }
  const stopRec = async (): Promise<void> => {
    const r = recorderRef.current
    if (!r || rec !== 'rec') return
    setRec('saving')
    try {
      const path = await r.stop(clipName(track, version, ext))
      setNotice(path ? { text: 'Clip exported', path } : { text: 'Export canceled' })
    } catch (err) {
      setNotice({ text: err instanceof Error ? err.message : 'Export failed', error: true })
    } finally {
      recorderRef.current = null
      setRec('idle')
    }
  }
  useEffect(() => {
    if (rec !== 'rec') return
    const id = setInterval(() => {
      const r = recorderRef.current
      if (r) setRecSec((performance.now() - r.startedAt) / 1000)
    }, 250)
    return () => clearInterval(id)
  }, [rec])
  // sortie de la vue en plein enregistrement : on jette le clip en cours
  useEffect(() => () => void recorderRef.current?.cancel(), [])

  // ---- clavier : Échap = quitter, Espace = lecture/pause -------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.key === 'Escape') {
        if (picker) setPicker(false)
        else if (rec === 'idle') setStreamer(false)
      } else if (e.key === ' ') {
        e.preventDefault()
        player.toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picker, rec, setStreamer])

  // clic sur la forme d'onde de la scène = seek
  const onStagePointer = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const stage = stageRef.current
    const canvas = canvasRef.current
    if (!stage || !canvas || !track) return
    const rect = canvas.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * fmt.w
    const y = ((e.clientY - rect.top) / rect.height) * fmt.h
    const wv = stage.layout.wave
    if (x >= wv.x && x <= wv.x + wv.w && y >= wv.y && y <= wv.y + wv.h) {
      player.seek((x - wv.x) / wv.w)
    }
  }

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = needle
      ? tracks.filter((t) => t.title.toLowerCase().includes(needle) || t.artist.toLowerCase().includes(needle))
      : tracks
    return list.slice(0, 10)
  }, [tracks, q])
  const pick = (t: Track): void => {
    void player.playQueue(tracks, tracks.indexOf(t))
    setPicker(false)
    setQ('')
  }

  const sep = <span style={{ width: 2, alignSelf: 'stretch', background: 'var(--ink)', opacity: 0.25, flex: 'none' }} />

  return (
    <div data-theme={prefs.theme} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'var(--paper)', color: 'var(--ink)', display: 'flex', flexDirection: 'column' }}>
      {/* barre du haut : zone de drag, feux macOS à gauche */}
      <div
        className="drag"
        style={{ height: TOP, flex: 'none', borderBottom: 'var(--line-thick)', display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px 0 88px' }}
      >
        <span className="mono" style={{ fontSize: 9, letterSpacing: '.16em', color: 'var(--accent)', whiteSpace: 'nowrap' }}>
          STREAMER MODE
        </span>
        <span className="mono" style={{ fontSize: 9, color: 'var(--ink-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {fmt.name} · {fmt.w}×{fmt.h} · {ext.toUpperCase()}
        </span>
        <div style={{ flex: 1 }} />
        {rec === 'rec' && (
          <span className="mono" style={{ fontSize: 9, color: 'var(--accent)', letterSpacing: '.12em', animation: 'blink 1s steps(1) infinite' }}>
            ● REC
          </span>
        )}
        <button className="blk tap no-drag" onClick={() => setStreamer(false)} disabled={rec !== 'idle'} title="Esc" style={{ padding: '5px 10px', fontSize: 11 }}>
          Exit
        </button>
      </div>

      {/* scène */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--paper-2)', position: 'relative', overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          data-stage
          width={fmt.w}
          height={fmt.h}
          onPointerDown={onStagePointer}
          style={{ maxWidth: '100%', maxHeight: '100%', display: 'block', cursor: track ? 'crosshair' : 'default' }}
        />
        {(camError || micError) && (
          <div className="mono" style={{ position: 'absolute', left: 10, top: 10, fontSize: 9, background: 'var(--ink)', color: 'var(--paper)', padding: '4px 8px', maxWidth: '80%' }}>
            {camError ? `CAMERA: ${camError}` : `MIC: ${micError}`}
          </div>
        )}
        {notice && (
          <div
            className="rise"
            style={{
              position: 'absolute', left: 12, right: 12, bottom: 12, display: 'flex', alignItems: 'center', gap: 10,
              background: notice.error ? 'var(--accent)' : 'var(--ink)', color: notice.error ? '#111' : 'var(--paper)',
              padding: '8px 12px', font: '700 11px var(--grotesk)', letterSpacing: '.06em', textTransform: 'uppercase'
            }}
          >
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {notice.text}
              {notice.path && <span className="mono" style={{ opacity: 0.7, marginLeft: 8, textTransform: 'none', letterSpacing: 0 }}>{notice.path}</span>}
            </span>
            {notice.path && (
              <button className="tap" style={{ color: 'var(--accent)', font: '700 11px var(--grotesk)', letterSpacing: '.06em' }} onClick={() => void window.tl.track.reveal(notice.path!)}>
                REVEAL
              </button>
            )}
            <button className="tap" style={{ font: '700 12px var(--grotesk)' }} onClick={() => setNotice(null)}>
              ✕
            </button>
          </div>
        )}
        {picker && (
          <div style={{ position: 'absolute', left: 12, right: 12, bottom: 12, zIndex: 5, background: 'var(--paper)', border: 'var(--line-thick)', boxShadow: '6px 6px 0 rgba(17,17,17,.25)' }}>
            <input
              autoFocus
              className="field"
              placeholder="Search tracks…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setPicker(false)
                if (e.key === 'Enter' && results[0]) pick(results[0])
              }}
              style={{ border: 'none', borderBottom: 'var(--line)' }}
            />
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {results.map((t) => (
                <button
                  key={t.id}
                  onClick={() => pick(t)}
                  className="hov"
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '7px 12px', borderBottom: 'var(--line)',
                    font: '500 12px var(--grotesk)', color: t.id === track?.id ? 'var(--accent)' : undefined
                  }}
                >
                  {t.title} <span className="mono" style={{ fontSize: 9, color: 'var(--ink-soft)' }}>— {t.artist}</span>
                </button>
              ))}
              {results.length === 0 && (
                <div className="serif" style={{ fontStyle: 'italic', color: 'var(--ink-soft)', padding: '8px 12px' }}>Nothing found.</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* commandes : deux rangées */}
      <div style={{ height: CTRL, flex: 'none', borderTop: 'var(--line-thick)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', borderBottom: 'var(--line)', minWidth: 0, overflow: 'hidden' }}>
          {rec === 'idle' ? (
            <Cmd acc onClick={() => void startRec()} disabled={!track || !mime} title={mime ? 'Start recording' : 'MediaRecorder unavailable'}>
              ● Record
            </Cmd>
          ) : (
            <Cmd on onClick={() => void stopRec()} disabled={rec === 'saving'} title="Stop and export">
              ■ {rec === 'saving' ? 'Exporting…' : 'Stop'}
            </Cmd>
          )}
          <span className="mono" style={{ fontSize: 12, minWidth: 44, color: rec === 'rec' ? 'var(--accent)' : 'var(--ink-soft)' }}>
            {fmtDuration(recSec)}
          </span>
          {sep}
          <Cmd onClick={() => player.prev()} title="Previous">⏮</Cmd>
          <Cmd onClick={() => player.toggle()} title="Play / pause (Space)" on={snap.playing}>
            {snap.playing ? '❚❚' : '▶'}
          </Cmd>
          <Cmd onClick={() => player.next()} title="Next">⏭</Cmd>
          {sep}
          <button
            className="tap"
            onClick={() => setPicker((v) => !v)}
            title="Pick a track"
            style={{ flex: 1, minWidth: 0, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 1 }}
          >
            <span style={{ font: '700 12px/1.2 var(--grotesk)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>
              {track ? track.title : 'Pick a track…'}
            </span>
            <span className="mono" style={{ fontSize: 9, color: 'var(--ink-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>
              {track ? track.artist : 'click to open the list'}
            </span>
          </button>
          <Cmd onClick={() => setPicker((v) => !v)} on={picker}>Track</Cmd>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', minWidth: 0, overflow: 'hidden' }}>
          <span style={{ display: 'flex', flex: 'none' }}>
            {(Object.keys(FORMATS) as StageFormat[]).map((f, i) => (
              <button
                key={f}
                className="tap"
                disabled={rec !== 'idle'}
                onClick={() => patch({ format: f })}
                title={FORMATS[f].name}
                style={{
                  border: '2px solid var(--ink)', marginLeft: i ? -2 : 0, padding: '5px 8px', font: '700 11px var(--grotesk)',
                  background: prefs.format === f ? 'var(--accent)' : 'transparent', color: prefs.format === f ? '#111' : 'inherit',
                  opacity: rec !== 'idle' && prefs.format !== f ? 0.35 : 1
                }}
              >
                {FORMATS[f].label}
              </button>
            ))}
          </span>
          {sep}
          <select
            className="field"
            value={prefs.camera}
            onChange={(e) => patch({ camera: e.target.value })}
            title="Camera"
            style={{ flex: 1, minWidth: 80, padding: '5px 8px', fontSize: 11, height: 30 }}
          >
            <option value="">Default camera</option>
            {cams.map((c, i) => (
              <option key={c.deviceId} value={c.deviceId}>
                {c.label || `Camera ${i + 1}`}
              </option>
            ))}
          </select>
          <Cmd on={prefs.theme === 'dark'} onClick={() => patch({ theme: prefs.theme === 'dark' ? 'light' : 'dark' })} title="Dark stage theme">
            Dark
          </Cmd>
          <Cmd on={prefs.mirror} onClick={() => patch({ mirror: !prefs.mirror })} title="Mirror the image (selfie)">Mirror</Cmd>
          <Cmd on={prefs.mic} onClick={() => patch({ mic: !prefs.mic })} title="Mix the mic into the clip" disabled={rec !== 'idle'}>
            Mic
          </Cmd>
          {sep}
          <input
            className="field"
            value={version}
            onChange={(e) => editVersion(e.target.value)}
            placeholder="Version (v3, Club Mix…)"
            title="Version shown on the stage"
            style={{ width: 150, flex: 'none', padding: '5px 8px', fontSize: 11, height: 30 }}
          />
        </div>
      </div>
    </div>
  )
}
