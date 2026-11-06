import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Track } from '@shared/types'
import { getAnalysis } from '@/lib/analysis'
import { fmtDuration } from '@/lib/format'
import { getPeaks } from '@/lib/peaks'
import { player } from '@/lib/player'
import { ClipRecorder, clipExt, pickClipMime } from '@/lib/recorder'
import { FORMATS, Stage, clipName, loadStageFonts, parseVersion, type StageFormat, type StageState } from '@/lib/stage'
import { useStore } from '@/lib/store'
import Icon from './Icon'

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
  const [scene, setScene] = useState(false)
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
        else if (scene) setScene(false)
        else if (rec === 'idle') setStreamer(false)
      } else if (e.key === ' ') {
        e.preventDefault()
        player.toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picker, scene, rec, setStreamer])

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

  return (
    <div className="streamer" data-theme={prefs.theme}>
      {/* barre du haut : zone de drag, feux macOS à gauche */}
      <div className="st-top drag">
        <span className="toolbar-title" style={{ fontSize: 14 }}>Streamer</span>
        <span className="toolbar-sub">{fmt.name}</span>
        {(camError || micError) && (
          <span className="toolbar-sub" style={{ color: 'var(--accent-2)' }} title={(camError ?? micError) || undefined}>
            {camError ? 'No camera' : 'No mic'}
          </span>
        )}
        <div className="grow" />
        {rec === 'rec' && <span className="rec-pill"><i className="pulse" />REC</span>}
        <button className="blk sm no-drag" onClick={() => setStreamer(false)} disabled={rec !== 'idle'} title="Esc">Exit</button>
      </div>

      <div className="st-stage">
        <canvas
          ref={canvasRef}
          data-stage
          width={fmt.w}
          height={fmt.h}
          onPointerDown={onStagePointer}
          style={{ maxWidth: '100%', maxHeight: '100%', display: 'block', cursor: track ? 'crosshair' : 'default' }}
        />
        {notice && (
          <div className={`st-note rise ${notice.error ? 'error' : ''}`}>
            <span className="ell grow" title={notice.path}>{notice.text}</span>
            {notice.path && <button className="blk sm" onClick={() => void window.tl.track.reveal(notice.path!)}>Show in Finder</button>}
            <button className="ic xs" title="Dismiss" onClick={() => setNotice(null)}><Icon name="close" /></button>
          </div>
        )}
        {picker && (
          <div className="dropdown" style={{ top: 'auto', left: 10, right: 10, bottom: 10, zIndex: 5 }}>
            <input
              autoFocus
              className="field"
              placeholder="Search tracks"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setPicker(false)
                if (e.key === 'Enter' && results[0]) pick(results[0])
              }}
            />
            <div className="list">
              {results.map((t) => (
                <button key={t.id} className={`opt ${t.id === track?.id ? 'cur' : ''}`} onClick={() => pick(t)}>
                  <span className="ell">{t.title}</span>
                  <span className="dim ell" style={{ flex: 'none', maxWidth: '45%', fontSize: 11 }}>{t.artist}</span>
                </button>
              ))}
              {results.length === 0 && <div className="dim" style={{ padding: '6px 9px' }}>Nothing found.</div>}
            </div>
          </div>
        )}
      </div>

      {scene && (
        <div className="st-pop">
          <div className="grow-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 5 }}>
            <span className="label">Camera</span>
            <select className="field" value={prefs.camera} onChange={(e) => patch({ camera: e.target.value })}>
              <option value="">Default camera</option>
              {cams.map((c, i) => (
                <option key={c.deviceId} value={c.deviceId}>{c.label || `Camera ${i + 1}`}</option>
              ))}
            </select>
          </div>
          <label className="grow-row switch" title="Flip the image, like a selfie">
            Mirror
            <input type="checkbox" checked={prefs.mirror} onChange={(e) => patch({ mirror: e.target.checked })} />
          </label>
          <label className="grow-row switch" title="Mix the mic into the clip">
            Microphone
            <input type="checkbox" checked={prefs.mic} disabled={rec !== 'idle'} onChange={(e) => patch({ mic: e.target.checked })} />
          </label>
          <label className="grow-row switch">
            Dark stage
            <input type="checkbox" checked={prefs.theme === 'dark'} onChange={(e) => patch({ theme: e.target.checked ? 'dark' : 'light' })} />
          </label>
        </div>
      )}

      <div className="st-ctrl">
        <div className="st-row">
          {rec === 'idle' ? (
            <button className="blk acc" onClick={() => void startRec()} disabled={!track || !mime} title={mime ? 'Start recording' : 'MediaRecorder unavailable'}>
              <Icon name="rec" />
              Record
            </button>
          ) : (
            <button className="blk on" onClick={() => void stopRec()} disabled={rec === 'saving'} title="Stop and export">
              <Icon name="stop" />
              {rec === 'saving' ? 'Exporting…' : 'Stop'}
            </button>
          )}
          {rec !== 'idle' && (
            <span className="mono" style={{ fontSize: 12, color: 'var(--accent-2)' }}>{fmtDuration(recSec)}</span>
          )}
          <div className="ptransport">
            <button className="ic" title="Previous" onClick={() => player.prev()}><Icon name="prev" /></button>
            <button className="ic" title="Play / pause (Space)" onClick={() => player.toggle()}><Icon name={snap.playing ? 'pause' : 'play'} /></button>
            <button className="ic" title="Next" onClick={() => player.next()}><Icon name="next" /></button>
          </div>
          <button
            className={`st-track grow ${picker ? 'on' : ''}`}
            onClick={() => {
              setPicker((v) => !v)
              setScene(false)
            }}
            title="Pick a track"
                      >
            <div className="ell" style={{ font: '600 12.5px/1.25 var(--grotesk)' }}>{track ? track.title : 'Pick a track…'}</div>
            {track && <div className="ell dim" style={{ fontSize: 11.5 }}>{track.artist}</div>}
          </button>
        </div>
        <div className="st-row">
          <div className="seg">
            {(Object.keys(FORMATS) as StageFormat[]).map((f) => (
              <button
                key={f}
                className={prefs.format === f ? 'on' : ''}
                disabled={rec !== 'idle'}
                onClick={() => patch({ format: f })}
                title={FORMATS[f].name}
              >
                {FORMATS[f].label}
              </button>
            ))}
          </div>
          <input
            className="field grow"
            value={version}
            onChange={(e) => editVersion(e.target.value)}
            placeholder="Version (v3, Club Mix…)"
            title="Version shown on the stage"
          />
          <button
            className={`ic ${scene ? 'on' : ''}`}
            title="Camera, mirror, mic, theme"
            onClick={() => {
              setScene((v) => !v)
              setPicker(false)
            }}
          >
            <Icon name="gear" />
          </button>
        </div>
      </div>
    </div>
  )
}
