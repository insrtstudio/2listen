import AVKit
import SwiftUI

/// Barre du morceau en cours, au-dessus des onglets.
struct MiniPlayer: View {
    let open: () -> Void
    @EnvironmentObject private var player: Player

    var body: some View {
        HStack(spacing: 10) {
            // pas de Button ici : dans l'accessoire de la barre d'onglets, son contenu n'était plus redessiné
            HStack(spacing: 10) {
                CoverView(key: player.current?.cover, cornerRadius: 6).frame(width: 32, height: 32)
                VStack(alignment: .leading, spacing: 0) {
                    Text(player.current?.title ?? "Rien en lecture")
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    if let artist = player.current?.displayArtist, !artist.isEmpty {
                        Text(artist).font(.caption).foregroundStyle(Theme.inkSoft).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
            .onTapGesture { if player.current != nil { open() } }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
            Button(action: player.toggle) {
                Image(systemName: player.isPlaying ? "pause.fill" : "play.fill").font(.title3)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(player.isPlaying ? "Pause" : "Lecture")
            .disabled(player.current == nil)
            Button(action: player.next) {
                Image(systemName: "forward.fill").font(.title3)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Morceau suivant")
            .disabled(player.current == nil)
        }
        .padding(.horizontal, 12)
    }
}

/// Écran de lecture : la pochette, la forme d'onde et les commandes, rien d'autre.
struct NowPlayingView: View {
    @EnvironmentObject private var player: Player
    @EnvironmentObject private var library: Library

    var body: some View {
        VStack(spacing: 18) {
            Spacer(minLength: 24)
            CoverView(key: player.current?.cover, cornerRadius: 20)
                .aspectRatio(1, contentMode: .fit)
                .frame(maxHeight: 360)
            Spacer(minLength: 0)

            VStack(spacing: 4) {
                Text(player.current?.title ?? "")
                    .font(.title2.weight(.bold))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                Text(player.current?.displayArtist ?? "")
                    .font(.system(.title3, design: .serif).italic())
                    .foregroundStyle(Theme.inkSoft)
                    .lineLimit(1)
            }

            if let track = player.current {
                Scrubber(track: track)
            }

            if let failure = player.failure {
                Text(failure)
                    .font(.footnote)
                    .foregroundStyle(Theme.accent)
                    .multilineTextAlignment(.center)
            }

            HStack {
                Button(action: player.toggleShuffle) {
                    Image(systemName: "shuffle")
                        .foregroundStyle(player.shuffled ? Theme.accent : Theme.inkSoft)
                }
                .accessibilityLabel("Aléatoire")
                Spacer()
                Button(action: player.previous) {
                    Image(systemName: "backward.fill").font(.title)
                }
                .accessibilityLabel("Précédent")
                Spacer()
                Button(action: player.toggle) {
                    Image(systemName: player.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                        .font(.system(size: 66))
                        .foregroundStyle(Theme.accent)
                }
                .accessibilityLabel(player.isPlaying ? "Pause" : "Lecture")
                Spacer()
                Button(action: player.next) {
                    Image(systemName: "forward.fill").font(.title)
                }
                .accessibilityLabel("Suivant")
                Spacer()
                Button(action: player.cycleRepeat) {
                    Image(systemName: player.repeatMode == .one ? "repeat.1" : "repeat")
                        .foregroundStyle(player.repeatMode == .off ? Theme.inkSoft : Theme.accent)
                }
                .accessibilityLabel("Répéter")
            }
            .buttonStyle(.plain)
            .foregroundStyle(.primary)

            HStack {
                Text(player.current?.quality ?? "")
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(Theme.inkSoft)
                Spacer()
                RoutePicker().frame(width: 32, height: 32)
            }
            Spacer(minLength: 8)
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background)
        .presentationDragIndicator(.visible)
    }
}

/// Choix de la sortie : AirPods, AirPlay.
struct RoutePicker: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let view = AVRoutePickerView()
        view.tintColor = UIColor(Theme.inkSoft)
        view.activeTintColor = UIColor(Theme.accent)
        return view
    }
    func updateUIView(_ view: AVRoutePickerView, context: Context) {}
}

/// Barres de la forme d'onde servies par le Mac, ou une simple ligne quand le
/// morceau n'y a pas encore été analysé. Glisser déplace la lecture.
struct Scrubber: View {
    let track: Track
    @EnvironmentObject private var player: Player
    @EnvironmentObject private var library: Library
    @EnvironmentObject private var clock: Clock
    @State private var bars: [Float]?
    @State private var dragging: Double?

    private var progress: Double {
        guard track.duration > 0 else { return 0 }
        return dragging ?? min(1, max(0, clock.time / track.duration))
    }

    var body: some View {
        VStack(spacing: 6) {
            GeometryReader { geo in
                Canvas { context, size in draw(in: &context, size: size) }
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { dragging = min(1, max(0, $0.location.x / geo.size.width)) }
                            .onEnded { value in
                                let ratio = min(1, max(0, value.location.x / geo.size.width))
                                player.seek(to: ratio * track.duration)
                                dragging = nil
                            }
                    )
            }
            .frame(height: bars == nil ? 28 : 72)
            .accessibilityElement()
            .accessibilityLabel("Position")
            .accessibilityValue(clock.time.clock)
            .accessibilityAdjustableAction { direction in
                player.seek(to: max(0, clock.time + (direction == .increment ? 10 : -10)))
            }
            HStack {
                Text((dragging.map { $0 * track.duration } ?? clock.time).clock)
                Spacer()
                Text(track.duration.clock)
            }
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(Theme.inkSoft)
        }
        .task(id: track.id) { await loadPeaks() }
    }

    private func draw(in context: inout GraphicsContext, size: CGSize) {
        let played = size.width * progress
        guard let bars, !bars.isEmpty else {
            let y = size.height / 2 - 2
            context.fill(Path(roundedRect: CGRect(x: 0, y: y, width: size.width, height: 4), cornerRadius: 2), with: .color(Theme.inkSoft.opacity(0.3)))
            context.fill(Path(roundedRect: CGRect(x: 0, y: y, width: played, height: 4), cornerRadius: 2), with: .color(Theme.accent))
            return
        }
        let step = size.width / CGFloat(bars.count)
        let width = max(1.5, step - 1)
        for (i, value) in bars.enumerated() {
            let height = max(2, CGFloat(value) * size.height)
            let rect = CGRect(x: CGFloat(i) * step, y: (size.height - height) / 2, width: width, height: height)
            let isPlayed = rect.midX <= played
            context.fill(Path(roundedRect: rect, cornerRadius: width / 2), with: .color(isPlayed ? Theme.accent : Theme.inkSoft.opacity(0.4)))
        }
    }

    /// Fichier du Mac : 6 plans de `buckets` octets, min et max centrés sur 128 d'abord.
    private func loadPeaks() async {
        bars = nil
        guard let url = library.peaksURL(track),
              let (data, response) = try? await URLSession.shared.data(from: url),
              (response as? HTTPURLResponse)?.statusCode == 200, data.count >= 6 else { return }
        let buckets = data.count / 6
        let count = 72
        var out = [Float](repeating: 0, count: count)
        data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            for i in 0..<count {
                let from = i * buckets / count
                let to = max(from + 1, (i + 1) * buckets / count)
                var top: Float = 0
                for b in from..<min(to, buckets) {
                    let low = abs(Float(raw[b]) - 128)
                    let high = abs(Float(raw[buckets + b]) - 128)
                    top = max(top, max(low, high))
                }
                out[i] = top / 128
            }
        }
        bars = out
    }
}
