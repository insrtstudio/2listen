import SwiftUI

/// Morceaux gardés sur l'iPhone pour écouter sans le Mac, avec leur pochette et leur forme d'onde.
extension Library {
    private static var folder: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        var url = base.appendingPathComponent("Downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        // la musique reste sur le Mac : inutile de remplir la sauvegarde iCloud
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
        return url
    }

    private func audioFile(_ track: Track) -> URL { Self.folder.appendingPathComponent("\(track.id).\(track.ext)") }
    private func peaksFile(_ id: String) -> URL { Self.folder.appendingPathComponent("\(id).peaks") }
    private func coverFile(_ key: String) -> URL { Self.folder.appendingPathComponent((key as NSString).lastPathComponent) }

    func localAudio(_ track: Track) -> URL? { downloaded.contains(track.id) ? audioFile(track) : nil }
    func localPeaks(_ track: Track) -> URL? { downloaded.contains(track.id) ? peaksFile(track.id) : nil }
    func localCover(_ key: String) -> URL? {
        let file = coverFile(key)
        return FileManager.default.fileExists(atPath: file.path) ? file : nil
    }

    /// Sans le Mac, seuls les morceaux téléchargés sont jouables.
    func isPlayable(_ track: Track) -> Bool { link != .offline || downloaded.contains(track.id) }
    var downloadedTracks: [Track] { tracks.filter { downloaded.contains($0.id) } }

    func loadDownloads() {
        let files = (try? FileManager.default.contentsOfDirectory(atPath: Self.folder.path)) ?? []
        let audio = files.filter { !$0.hasSuffix(".peaks") && $0.count > 20 && $0.prefix(20).allSatisfy(\.isHexDigit) && $0.dropFirst(20).first == "." }
        downloaded = Set(audio.map { String($0.prefix(20)) })
    }

    func download(_ wanted: [Track]) {
        let fresh = wanted.filter { !downloaded.contains($0.id) && !downloading.contains($0.id) }
        downloadQueue += fresh
        downloading.formUnion(fresh.map(\.id))
        guard downloadWorker == nil, !downloadQueue.isEmpty else { return }
        downloadWorker = Task { await runDownloads() }
    }

    /// Un morceau à la fois : le Mac sert aussi l'écoute en cours.
    private func runDownloads() async {
        while !downloadQueue.isEmpty {
            let track = downloadQueue.removeFirst()
            do {
                try await fetch(track)
                downloaded.insert(track.id)
                downloading.remove(track.id)
            } catch {
                downloadQueue.removeAll()
                downloading.removeAll()
                notice = "Le téléchargement s'est interrompu. Garde l'app ouverte, à portée du Mac, puis réessaie."
            }
        }
        downloadWorker = nil
    }

    private func fetch(_ track: Track) async throws {
        guard let source = remoteURL("stream/\(track.id).\(track.ext)") else { throw URLError(.badURL) }
        let (temporary, response) = try await downloadSession.download(from: source)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        try? FileManager.default.removeItem(at: audioFile(track))
        try FileManager.default.moveItem(at: temporary, to: audioFile(track))
        // la pochette et la forme d'onde sont facultatives
        if let key = track.cover, localCover(key) == nil, let url = remoteURL("cover/\(key)") {
            await save(url, to: coverFile(key))
        }
        if let url = remoteURL("peaks/\(track.id)") {
            await save(url, to: peaksFile(track.id))
        }
    }

    private func save(_ url: URL, to file: URL) async {
        guard let (data, response) = try? await session.data(from: url),
              (response as? HTTPURLResponse)?.statusCode == 200 else { return }
        try? data.write(to: file, options: .atomic)
    }

    func removeDownloads(_ removed: [Track]) {
        for track in removed {
            try? FileManager.default.removeItem(at: audioFile(track))
            try? FileManager.default.removeItem(at: peaksFile(track.id))
            downloaded.remove(track.id)
        }
        // une pochette peut servir à tout un album
        let kept = Set(downloadedTracks.compactMap(\.cover))
        for key in Set(removed.compactMap(\.cover)).subtracting(kept) {
            try? FileManager.default.removeItem(at: coverFile(key))
        }
    }

    func removeAllDownloads() {
        downloadQueue.removeAll()
        downloading.removeAll()
        downloaded.removeAll()
        try? FileManager.default.removeItem(at: Self.folder)
    }

    /// Un morceau retiré de la bibliothèque du Mac ne reste pas sur l'iPhone.
    func pruneDownloads() {
        let known = Set(tracks.map(\.id))
        for id in downloaded.subtracting(known) {
            let files = (try? FileManager.default.contentsOfDirectory(atPath: Self.folder.path)) ?? []
            for name in files where name.hasPrefix(id) {
                try? FileManager.default.removeItem(at: Self.folder.appendingPathComponent(name))
            }
            downloaded.remove(id)
        }
    }

    var downloadsSize: Int64 {
        let files = FileManager.default.enumerator(at: Self.folder, includingPropertiesForKeys: [.fileSizeKey])
        var total: Int64 = 0
        while let file = files?.nextObject() as? URL {
            total += Int64((try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
        }
        return total
    }
}

/// Télécharger tout un album ou toute une playlist, d'un seul bouton.
struct DownloadButton: View {
    let tracks: [Track]
    @EnvironmentObject private var library: Library
    @State private var confirmingRemoval = false

    var body: some View {
        let active = tracks.contains { library.downloading.contains($0.id) }
        let complete = !tracks.isEmpty && tracks.allSatisfy { library.downloaded.contains($0.id) }
        Button {
            if complete { confirmingRemoval = true } else { library.download(tracks) }
        } label: {
            if active {
                ProgressView()
            } else {
                Image(systemName: complete ? "checkmark.circle.fill" : "arrow.down.circle")
                    .foregroundStyle(complete ? Theme.accent : Color.primary)
            }
        }
        .disabled(active || tracks.isEmpty)
        .accessibilityLabel(complete ? "Téléchargé" : "Tout télécharger")
        .confirmationDialog("Retirer ces morceaux de l'iPhone ?", isPresented: $confirmingRemoval, titleVisibility: .visible) {
            Button("Retirer", role: .destructive) { library.removeDownloads(tracks) }
        }
    }
}

/// Ce qui s'écoute sans le Mac.
struct DownloadsView: View {
    @EnvironmentObject private var library: Library

    var body: some View {
        let tracks = library.downloadedTracks
        TrackList(tracks: tracks) {
            if !tracks.isEmpty { PlayButtons(tracks: tracks) }
        }
        .overlay {
            if tracks.isEmpty {
                ContentUnavailableView("Aucun téléchargement", systemImage: "arrow.down.circle", description: Text("Garde le doigt sur un morceau, ou touche la flèche d'un album ou d'une playlist."))
            }
        }
        .navigationTitle("Téléchargements")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Une destination qui n'a pas de donnée propre.
enum LibraryRoute: Hashable { case downloads }
