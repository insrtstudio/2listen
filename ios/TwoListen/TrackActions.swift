import SwiftUI

/// Où l'app se trouve : l'onglet, sa navigation et l'écran de lecture.
@MainActor
final class Navigator: ObservableObject {
    @Published var tab = "tracks"
    @Published var paths: [String: NavigationPath] = [:]
    @Published var showNowPlaying = false

    func show(_ album: Album) { open(album, in: "albums") }
    func show(_ artist: Artist) { open(artist, in: "artists") }

    private func open<Value: Hashable>(_ value: Value, in tab: String) {
        var path = NavigationPath()
        path.append(value)
        paths[tab] = path
        self.tab = tab
        showNowPlaying = false
    }
}

/// Ce qu'on peut faire d'un morceau, depuis la liste comme depuis l'écran de lecture.
struct TrackActions: View {
    let track: Track
    var playlist: Playlist?
    @Binding var creatingFor: Track?
    @EnvironmentObject private var library: Library
    @EnvironmentObject private var player: Player
    @EnvironmentObject private var navigator: Navigator

    var body: some View {
        Button("Lire ensuite", systemImage: "text.line.first.and.arrowtriangle.forward") { player.playNext(track) }
        Button("Ajouter à la file", systemImage: "text.line.last.and.arrowtriangle.forward") { player.addToQueue(track) }
        Menu("Ajouter à une playlist", systemImage: "text.badge.plus") {
            Button("Nouvelle playlist…", systemImage: "plus") { creatingFor = track }
            ForEach(library.playlists) { candidate in
                let hasTrack = candidate.trackIds.contains(track.id)
                Button(candidate.name, systemImage: hasTrack ? "checkmark" : "music.note.list") {
                    Task { await library.add(track, to: candidate) }
                }
                .disabled(hasTrack)
            }
        }
        if let playlist {
            Button("Retirer de cette playlist", systemImage: "minus.circle", role: .destructive) {
                Task { await library.remove(track, from: playlist) }
            }
        }
        if library.downloaded.contains(track.id) {
            Button("Retirer de l'iPhone", systemImage: "trash") { library.removeDownloads([track]) }
        } else {
            Button("Télécharger", systemImage: "arrow.down.circle") { library.download([track]) }
                .disabled(library.downloading.contains(track.id))
        }
        Divider()
        if let album = library.album(of: track) {
            Button("Voir l'album", systemImage: "square.stack") { navigator.show(album) }
        }
        if let artist = library.artist(of: track) {
            Button("Voir l'artiste", systemImage: "music.mic") { navigator.show(artist) }
        }
    }
}

/// La saisie du nom d'une nouvelle playlist, et les erreurs d'écriture sur le Mac.
struct TrackActionAlerts: ViewModifier {
    @Binding var creatingFor: Track?
    @EnvironmentObject private var library: Library
    @State private var name = ""

    func body(content: Content) -> some View {
        content
            .alert("Nouvelle playlist", isPresented: Binding(get: { creatingFor != nil }, set: { if !$0 { creatingFor = nil } })) {
                TextField("Nom", text: $name)
                Button("Annuler", role: .cancel) { name = "" }
                Button("Créer") {
                    let track = creatingFor
                    let chosen = name
                    name = ""
                    Task { await library.createPlaylist(named: chosen, with: track) }
                }
            }
            .alert("Une erreur est survenue", isPresented: Binding(get: { library.notice != nil }, set: { if !$0 { library.notice = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(library.notice ?? "")
            }
    }
}
