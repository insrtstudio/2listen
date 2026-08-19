/**
 * Décodage PCM d'une piste pour l'analyse (waveform, LUFS, spectre, BPM…).
 * decodeAudioData couvre FLAC/WAV/MP3/AAC/OGG ; pour les codecs que Chromium
 * ne décode pas hors lecture (ALAC…), le main convertit via CoreAudio
 * (afconvert → WAV float temporaire) et on décode ce WAV.
 */
export async function decodeTrack(path: string): Promise<AudioBuffer | null> {
  const tryDecode = async (url: string): Promise<AudioBuffer | null> => {
    try {
      const res = await fetch(url)
      const raw = await res.arrayBuffer()
      const ctx = new OfflineAudioContext(1, 1, 44100)
      return await ctx.decodeAudioData(raw)
    } catch {
      return null
    }
  }
  const direct = await tryDecode(await window.tl.url.audio(path))
  if (direct) return direct
  const wav = await window.tl.url.wavFallback(path)
  if (!wav) return null
  return tryDecode(await window.tl.url.audio(wav))
}
