import AVFoundation
import Combine
import MediaPlayer
import UIKit

/// Position de lecture, à part : mise à jour 4 fois par seconde, elle ne doit
/// redessiner que ce qui l'affiche, pas les listes.
@MainActor
final class Clock: ObservableObject {
    @Published var time: TimeInterval = 0
}

/// Lecteur : AVQueuePlayer garde le morceau courant et le suivant déjà préparé,
/// pour enchaîner sans blanc. Arrière-plan, écran verrouillé et AirPods passent
/// par la session audio et le centre de contrôle du système.
@MainActor
final class Player: ObservableObject {
    enum Repeat { case off, all, one }

    @Published private(set) var current: Track?
    @Published private(set) var isPlaying = false
    @Published private(set) var isBuffering = false
    @Published private(set) var failure: String?
    @Published var repeatMode: Repeat = .off
    @Published private(set) var shuffled = false

    let clock = Clock()
    private let player = AVQueuePlayer()
    private var library: Library?
    private var original: [Track] = []
    private var queue: [Track] = []
    private var index = 0
    private var observers: [NSKeyValueObservation] = []
    private var itemObserver: NSKeyValueObservation?
    private var timeToken: Any?
    private var artworkTask: Task<Void, Never>?
    private var failedInARow = 0

    /// Un élément de file qui sait quel morceau il joue.
    private final class Item: AVPlayerItem {
        var track: Track?
    }

    func attach(_ library: Library) {
        self.library = library
        configureSession()
        configureRemote()

        timeToken = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 4), queue: .main) { [weak self] time in
            MainActor.assumeIsolated { self?.clock.time = time.seconds.isFinite ? time.seconds : 0 }
        }
        observers = [
            player.observe(\.timeControlStatus, options: [.new]) { [weak self] p, _ in
                let status = p.timeControlStatus
                Task { @MainActor in self?.statusChanged(status) }
            },
            player.observe(\.currentItem, options: [.new]) { [weak self] p, _ in
                let item = p.currentItem
                Task { @MainActor in self?.itemChanged(item) }
            }
        ]
        #if DEBUG
        player.isMuted = ProcessInfo.processInfo.environment["TL_MUTE"] != nil
        #endif
    }

    // MARK: Commandes

    func play(_ tracks: [Track], from start: Track, shuffle: Bool = false) {
        failure = nil
        failedInARow = 0
        original = tracks
        shuffled = shuffle
        if shuffle {
            queue = [start] + tracks.filter { $0.id != start.id }.shuffled()
            index = 0
        } else {
            queue = tracks
            index = tracks.firstIndex(of: start) ?? 0
        }
        load(startPlaying: true)
    }

    func toggle() {
        failure = nil
        if player.timeControlStatus == .paused {
            // fin de file : on reprend le dernier morceau depuis le début
            if player.currentItem == nil { load(startPlaying: true) } else { player.play() }
        } else {
            player.pause()
        }
    }

    func next() {
        guard !queue.isEmpty else { return }
        if let target = upcomingIndex(afterSkip: true) {
            index = target
            load(startPlaying: true)
        } else {
            player.pause()
            seek(to: 0)
        }
    }

    func previous() {
        guard !queue.isEmpty else { return }
        // comme partout : d'abord le début du morceau, puis le précédent
        if clock.time > 3 || index == 0 {
            seek(to: 0)
        } else {
            index -= 1
            load(startPlaying: true)
        }
    }

    func seek(to seconds: TimeInterval) {
        clock.time = seconds
        player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            Task { @MainActor in self?.publishNowPlaying() }
        }
    }

    func toggleShuffle() {
        guard let current else { shuffled.toggle(); return }
        shuffled.toggle()
        queue = shuffled ? [current] + original.filter { $0.id != current.id }.shuffled() : original
        index = queue.firstIndex(of: current) ?? 0
        rebuildUpcoming()
    }

    func cycleRepeat() {
        switch repeatMode {
        case .off: repeatMode = .all
        case .all: repeatMode = .one
        case .one: repeatMode = .off
        }
        rebuildUpcoming()
    }

    // MARK: File

    private func upcomingIndex(afterSkip: Bool) -> Int? {
        if repeatMode == .one && !afterSkip { return index }
        if index + 1 < queue.count { return index + 1 }
        return repeatMode == .off ? nil : 0
    }

    private func makeItem(_ track: Track) -> Item? {
        guard let url = library?.streamURL(track) else { return nil }
        let item = Item(url: url)
        item.track = track
        // assez d'avance pour une coupure Wi-Fi, sans charger tout le fichier
        item.preferredForwardBufferDuration = 30
        return item
    }

    private func load(startPlaying: Bool) {
        guard queue.indices.contains(index), let item = makeItem(queue[index]) else { return }
        player.removeAllItems()
        player.insert(item, after: nil)
        rebuildUpcoming()
        if startPlaying {
            try? AVAudioSession.sharedInstance().setActive(true)
            player.play()
        }
    }

    /// Tout sauf l'élément courant est remplacé par le suivant prévu.
    private func rebuildUpcoming() {
        for item in player.items().dropFirst() { player.remove(item) }
        guard let target = upcomingIndex(afterSkip: false), let item = makeItem(queue[target]) else { return }
        player.insert(item, after: player.items().last)
    }

    private func itemChanged(_ item: AVPlayerItem?) {
        guard let item = item as? Item, let track = item.track else {
            // file épuisée : on reste sur le dernier morceau, à l'arrêt
            if current != nil { isPlaying = false; publishNowPlaying() }
            return
        }
        if current?.id != track.id || repeatMode == .one, let found = queue.firstIndex(of: track) { index = found }
        current = track
        clock.time = 0
        #if DEBUG
        NSLog("[tl-test] %@", "item \(track.title)")
        #endif
        itemObserver = item.observe(\.status, options: [.new]) { [weak self] observed, _ in
            let failed = observed.status == .failed
            let message = observed.error?.localizedDescription
            Task { @MainActor in
                #if DEBUG
                NSLog("[tl-test] %@", "status \(observed.status.rawValue) \(message ?? "")")
                #endif
                if failed { await self?.itemFailed(track) }
                else if observed.status == .readyToPlay { self?.failedInARow = 0 }
            }
        }
        rebuildUpcoming()
        publishNowPlaying()
        loadArtwork(track)
    }

    /// Morceau illisible : si le Mac répond, c'est le fichier (Ogg, par exemple,
    /// que l'iPhone ne sait pas lire) et on passe au suivant. Sinon on s'arrête là
    /// plutôt que d'échouer sur toute la file.
    private func itemFailed(_ track: Track) async {
        await library?.refresh()
        guard library?.link == .online else {
            player.pause()
            failure = "Mac injoignable. Vérifie que 2Listen est ouvert."
            return
        }
        failedInARow += 1
        // AVQueuePlayer a souvent déjà avancé tout seul sur le suivant
        if current?.id == track.id {
            if failedInARow < queue.count, upcomingIndex(afterSkip: true) != nil {
                next()
            } else {
                player.pause()
            }
        }
        let message = "« \(track.title) » n'est pas lisible sur l'iPhone."
        failure = message
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(6))
            if self?.failure == message { self?.failure = nil }
        }
    }

    private func statusChanged(_ status: AVPlayer.TimeControlStatus) {
        isPlaying = status != .paused
        isBuffering = status == .waitingToPlayAtSpecifiedRate
        publishNowPlaying()
    }

    // MARK: Système

    private func configureSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, policy: .longFormAudio)
        NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { [weak self] note in
            guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  AVAudioSession.InterruptionType(rawValue: raw) == .ended,
                  let options = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt,
                  AVAudioSession.InterruptionOptions(rawValue: options).contains(.shouldResume) else { return }
            MainActor.assumeIsolated { self?.player.play() }
        }
    }

    private func configureRemote() {
        let center = MPRemoteCommandCenter.shared()
        func bind(_ command: MPRemoteCommand, _ action: @escaping @MainActor (Player) -> Void) {
            command.addTarget { [weak self] _ in
                guard let self else { return .commandFailed }
                MainActor.assumeIsolated { action(self) }
                return .success
            }
        }
        bind(center.playCommand) { $0.player.play() }
        bind(center.pauseCommand) { $0.player.pause() }
        bind(center.togglePlayPauseCommand) { $0.toggle() }
        bind(center.nextTrackCommand) { $0.next() }
        bind(center.previousTrackCommand) { $0.previous() }
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let self, let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            MainActor.assumeIsolated { self.seek(to: event.positionTime) }
            return .success
        }
    }

    private var artwork: MPMediaItemArtwork?

    private func publishNowPlaying() {
        guard let current else { return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: current.title,
            MPMediaItemPropertyArtist: current.displayArtist,
            MPMediaItemPropertyAlbumTitle: current.album,
            MPMediaItemPropertyPlaybackDuration: current.duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: player.currentTime().seconds.isFinite ? player.currentTime().seconds : 0,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0
        ]
        if let artwork { info[MPMediaItemPropertyArtwork] = artwork }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func loadArtwork(_ track: Track) {
        artworkTask?.cancel()
        artwork = nil
        guard let url = library?.coverURL(track.cover) else { return }
        artworkTask = Task { [weak self] in
            guard let (data, _) = try? await URLSession.shared.data(from: url),
                  let image = UIImage(data: data), !Task.isCancelled else { return }
            self?.artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            self?.publishNowPlaying()
        }
    }
}
