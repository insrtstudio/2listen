import Foundation

/// Un morceau tel que le Mac le présente : jamais son chemin sur le disque.
struct Track: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let artist: String
    let albumArtist: String
    let album: String
    let year: Int?
    let trackNo: Int?
    let discNo: Int?
    let duration: Double
    let codec: String
    let lossless: Bool
    let sampleRate: Double
    let bitsPerSample: Double
    let bitrate: Double
    let cover: String?
    let addedAt: Double
    /// Extension du fichier : AVFoundation s'en sert pour reconnaître le format.
    let ext: String

    var displayArtist: String { artist.isEmpty ? albumArtist : artist }
    var groupArtist: String {
        let name = albumArtist.isEmpty ? artist : albumArtist
        return name.isEmpty ? "Artiste inconnu" : name
    }
    var groupAlbum: String { album.isEmpty ? "Album inconnu" : album }

    /// « FLAC · 24/96 » ou « MP3 · 320 kbps », comme sur le Mac (fmtQuality).
    var quality: String {
        if lossless {
            let rate = sampleRate / 1000
            let rateText = rate.rounded() == rate ? String(Int(rate)) : String(format: "%.1f", rate)
            return "\(codec) · \(bitsPerSample > 0 ? Int(bitsPerSample) : 16)/\(rateText)"
        }
        return bitrate > 0 ? "\(codec) · \(Int(bitrate.rounded())) kbps" : codec
    }
}

struct Playlist: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let trackIds: [String]
}

struct LibraryPayload: Codable {
    let tracks: [Track]
    let playlists: [Playlist]
}

struct Album: Identifiable, Hashable {
    let title: String
    let artist: String
    let tracks: [Track]
    var id: String { "\(artist)\u{1}\(title)" }
    var cover: String? { tracks.first(where: { $0.cover != nil })?.cover }
    var year: Int? { tracks.compactMap(\.year).first }
}

struct Artist: Identifiable, Hashable {
    let name: String
    let tracks: [Track]
    var id: String { name }
}

extension TimeInterval {
    /// 3:07, ou 1:02:45 au-delà d'une heure.
    var clock: String {
        guard isFinite, self >= 0 else { return "0:00" }
        let total = Int(self)
        let (h, m, s) = (total / 3600, total % 3600 / 60, total % 60)
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }
}
