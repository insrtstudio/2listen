import SwiftUI

struct MainTabs: View {
    @EnvironmentObject private var library: Library
    @EnvironmentObject private var player: Player
    @StateObject private var navigator = Navigator()
    @State private var showSettings = false

    var body: some View {
        tabs
            .sheet(isPresented: $navigator.showNowPlaying) {
                NowPlayingView()
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
            #if DEBUG
            .onChange(of: player.current) { _, track in
                if track != nil && TestHooks.openNowPlaying { navigator.showNowPlaying = true }
            }
            .onAppear {
                if let wanted = TestHooks.tab { navigator.tab = wanted }
                if TestHooks.env["TL_OPEN"] == "settings" { showSettings = true }
            }
            #endif
            .environmentObject(navigator)
    }

    private func screen<Content: View>(_ tab: String, @ViewBuilder _ content: () -> Content) -> some View {
        NavigationStack(path: Binding(get: { navigator.paths[tab] ?? NavigationPath() }, set: { navigator.paths[tab] = $0 })) {
            content()
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            showSettings = true
                        } label: {
                            Image(systemName: library.link == .offline ? "desktopcomputer.trianglebadge.exclamationmark" : "gearshape")
                                // l'orange ne signale ici qu'un Mac injoignable
                                .foregroundStyle(library.link == .offline ? Theme.accent : Color.primary)
                        }
                        .accessibilityLabel("Réglages")
                    }
                }
                .navigationDestination(for: Album.self) { AlbumView(album: $0) }
                .navigationDestination(for: Artist.self) { ArtistView(artist: $0) }
                .navigationDestination(for: Playlist.self) { PlaylistView(playlist: $0) }
                .navigationDestination(for: LibraryRoute.self) { _ in DownloadsView() }
        }
    }

    @ViewBuilder
    private var tabs: some View {
        let view = TabView(selection: $navigator.tab) {
            Tab("Morceaux", systemImage: "music.note", value: "tracks") { screen("tracks") { TracksView() } }
            Tab("Albums", systemImage: "square.stack", value: "albums") { screen("albums") { AlbumsView() } }
            Tab("Artistes", systemImage: "music.mic", value: "artists") { screen("artists") { ArtistsView() } }
            Tab("Playlists", systemImage: "music.note.list", value: "playlists") { screen("playlists") { PlaylistsView() } }
        }
        if #available(iOS 26.0, *) {
            // l'accessoire de la barre d'onglets en Liquid Glass, toujours présent comme dans Musique :
            // l'ajouter au premier morceau recréerait les onglets et perdrait la navigation en cours
            view
                .tabBarMinimizeBehavior(.onScrollDown)
                .tabViewBottomAccessory { MiniPlayer { navigator.showNowPlaying = true } }
        } else {
            view.safeAreaInset(edge: .bottom) {
                if player.current != nil {
                    MiniPlayer { navigator.showNowPlaying = true }
                        .frame(height: 56)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .padding(.horizontal, 12)
                        .padding(.bottom, 56)
                }
            }
        }
    }
}

// MARK: Morceaux

struct TracksView: View {
    enum Sort: String, CaseIterable {
        case added = "Date d'ajout", title = "Titre", artist = "Artiste"
    }

    @EnvironmentObject private var library: Library
    @EnvironmentObject private var player: Player
    @AppStorage("sort") private var sort: Sort = .added
    @State private var query = ""

    private var visible: [Track] {
        let needle = query.trimmingCharacters(in: .whitespaces)
        let found = needle.isEmpty ? library.tracks : library.tracks.filter {
            $0.title.localizedCaseInsensitiveContains(needle)
                || $0.artist.localizedCaseInsensitiveContains(needle)
                || $0.album.localizedCaseInsensitiveContains(needle)
        }
        switch sort {
        case .added: return found.sorted { $0.addedAt > $1.addedAt }
        case .title: return found.sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
        case .artist: return found.sorted { $0.groupArtist.localizedCaseInsensitiveCompare($1.groupArtist) == .orderedAscending }
        }
    }

    var body: some View {
        let list = visible
        TrackList(tracks: list)
            .overlay {
                if library.tracks.isEmpty {
                    EmptyLibrary()
                } else if list.isEmpty {
                    ContentUnavailableView.search(text: query)
                }
            }
            .navigationTitle("Morceaux")
            .searchable(text: $query, prompt: "Titre, artiste, album")
            .refreshable { await library.refresh() }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        Picker("Trier par", selection: $sort) {
                            ForEach(Sort.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                        }
                    } label: {
                        Image(systemName: "arrow.up.arrow.down")
                    }
                    .tint(Color.primary)
                    .accessibilityLabel("Trier")
                }
            }
    }
}

struct EmptyLibrary: View {
    @EnvironmentObject private var library: Library
    var body: some View {
        switch library.link {
        case .offline:
            ContentUnavailableView("Mac injoignable", systemImage: "desktopcomputer.trianglebadge.exclamationmark", description: Text("Vérifie que 2Listen est ouvert sur le Mac et que l'iPhone est sur le même réseau."))
        case .connecting:
            ProgressView()
        default:
            ContentUnavailableView("Aucun morceau", systemImage: "music.note", description: Text("Ajoute un dossier de musique dans 2Listen sur le Mac."))
        }
    }
}

/// Liste jouable : toucher un morceau lance toute la liste à partir de lui.
struct TrackList<Header: View>: View {
    let tracks: [Track]
    var numbered = false
    var playlist: Playlist?
    let header: Header
    @EnvironmentObject private var player: Player
    @EnvironmentObject private var library: Library
    @State private var creatingFor: Track?

    init(tracks: [Track], numbered: Bool = false, playlist: Playlist? = nil, @ViewBuilder header: () -> Header = { EmptyView() }) {
        self.tracks = tracks
        self.numbered = numbered
        self.playlist = playlist
        self.header = header()
    }

    var body: some View {
        List {
            header
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            ForEach(tracks) { track in
                Button {
                    player.play(tracks, from: track)
                } label: {
                    TrackRow(track: track, number: numbered ? track.trackNo : nil, isCurrent: track.id == player.current?.id)
                }
                .buttonStyle(.plain)
                .disabled(!library.isPlayable(track))
                .opacity(library.isPlayable(track) ? 1 : 0.4)
                .contextMenu { TrackActions(track: track, playlist: playlist, creatingFor: $creatingFor) }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                .listRowSeparator(track.id == tracks.first?.id ? .hidden : .automatic, edges: .top)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .modifier(TrackActionAlerts(creatingFor: $creatingFor))
    }
}

struct TrackRow: View {
    let track: Track
    var number: Int?
    let isCurrent: Bool
    @EnvironmentObject private var player: Player
    @EnvironmentObject private var library: Library

    var body: some View {
        HStack(spacing: 12) {
            if number != nil {
                Group {
                    if isCurrent {
                        nowPlayingGlyph.foregroundStyle(Theme.accent)
                    } else {
                        Text(number.map(String.init) ?? "").foregroundStyle(Theme.inkSoft)
                    }
                }
                .font(.system(.footnote, design: .monospaced))
                .frame(width: 24)
            } else {
                ZStack {
                    CoverView(key: track.cover, seed: track.coverSeed, cornerRadius: 8)
                    if isCurrent {
                        RoundedRectangle(cornerRadius: 8, style: .continuous).fill(.black.opacity(0.45))
                        nowPlayingGlyph.foregroundStyle(.white)
                    }
                }
                .frame(width: 46, height: 46)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(track.title)
                    .font(.body.weight(isCurrent ? .semibold : .regular))
                    .foregroundStyle(isCurrent ? Theme.accent : .primary)
                    .lineLimit(1)
                if !track.displayArtist.isEmpty {
                    Text(track.displayArtist)
                        .font(.subheadline)
                        .foregroundStyle(Theme.inkSoft)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if library.downloading.contains(track.id) {
                ProgressView().controlSize(.mini)
            } else if library.downloaded.contains(track.id) {
                Image(systemName: "arrow.down.circle.fill")
                    .font(.caption)
                    .foregroundStyle(Theme.inkSoft)
                    .accessibilityLabel("Téléchargé")
            }
            VStack(alignment: .trailing, spacing: 2) {
                Text(track.duration.clock)
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(Theme.inkSoft)
                // comme sur le Mac : seul le compressé est signalé
                if !track.lossless {
                    Text(track.quality)
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(Theme.inkSoft)
                }
            }
        }
        .contentShape(Rectangle())
    }

    private var nowPlayingGlyph: some View {
        Image(systemName: "waveform")
            .symbolEffect(.variableColor.iterative, isActive: player.isPlaying)
    }
}

struct CoverView: View {
    let key: String?
    /// Sans pochette, le style généré dépend de cette graine ; sans graine, rien ne joue.
    var seed: String?
    var cornerRadius: CGFloat = 12
    @EnvironmentObject private var library: Library

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(Theme.well)
            .overlay {
                if key != nil {
                    AsyncImage(url: library.coverURL(key)) { phase in
                        if let image = phase.image {
                            image.resizable().scaledToFill()
                        } else if case .failure = phase {
                            fallback
                        }
                    }
                } else {
                    fallback
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }

    @ViewBuilder private var fallback: some View {
        if let seed {
            GeneratedCover(seed: seed)
        } else {
            GeometryReader { geo in
                Image(systemName: "music.note")
                    .font(.system(size: geo.size.width * 0.34))
                    .foregroundStyle(Theme.inkSoft)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }
}

// MARK: Albums, artistes, playlists

struct AlbumsView: View {
    @EnvironmentObject private var library: Library

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14)], spacing: 18) {
                ForEach(library.albums) { album in
                    NavigationLink(value: album) {
                        VStack(alignment: .leading, spacing: 6) {
                            CoverView(key: album.cover, seed: album.coverSeed).aspectRatio(1, contentMode: .fit)
                            Text(album.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                            Text(album.artist).font(.footnote).foregroundStyle(Theme.inkSoft).lineLimit(1)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(16)
        }
        .overlay { if library.albums.isEmpty { EmptyLibrary() } }
        .background(Theme.background)
        .navigationTitle("Albums")
        .refreshable { await library.refresh() }
    }
}

struct AlbumView: View {
    let album: Album
    var body: some View {
        TrackList(tracks: album.tracks, numbered: true) {
            VStack(spacing: 10) {
                CoverView(key: album.cover, seed: album.coverSeed, cornerRadius: 16).frame(width: 220, height: 220)
                Text(album.title).font(.title3.weight(.bold)).multilineTextAlignment(.center)
                Text(album.artist + (album.year.map { " · \($0)" } ?? ""))
                    .font(.subheadline)
                    .foregroundStyle(Theme.inkSoft)
                PlayButtons(tracks: album.tracks).padding(.top, 4)
            }
            .frame(maxWidth: .infinity)
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { DownloadButton(tracks: album.tracks) } }
    }
}

struct PlayButtons: View {
    let tracks: [Track]
    @EnvironmentObject private var player: Player

    var body: some View {
        HStack(spacing: 10) {
            Button {
                if let first = tracks.first { player.play(tracks, from: first) }
            } label: {
                Label("Lire", systemImage: "play.fill").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            Button {
                if let first = tracks.randomElement() { player.play(tracks, from: first, shuffle: true) }
            } label: {
                Label("Aléatoire", systemImage: "shuffle").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
        .controlSize(.large)
        .buttonBorderShape(.capsule)
    }
}

struct ArtistsView: View {
    @EnvironmentObject private var library: Library

    var body: some View {
        List(library.artists) { artist in
            NavigationLink(value: artist) {
                HStack {
                    Text(artist.name).lineLimit(1)
                    Spacer()
                    Text("\(artist.tracks.count)")
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(Theme.inkSoft)
                }
            }
            .listRowBackground(Color.clear)
            .listRowSeparator(artist.id == library.artists.first?.id ? .hidden : .automatic, edges: .top)
        }
        .listStyle(.plain)
        .overlay { if library.artists.isEmpty { EmptyLibrary() } }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .navigationTitle("Artistes")
        .refreshable { await library.refresh() }
    }
}

struct ArtistView: View {
    let artist: Artist
    var body: some View {
        TrackList(tracks: artist.tracks) {
            PlayButtons(tracks: artist.tracks)
        }
        .navigationTitle(artist.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct PlaylistsView: View {
    @EnvironmentObject private var library: Library

    var body: some View {
        List {
            NavigationLink(value: LibraryRoute.downloads) {
                HStack {
                    Text("Téléchargements")
                    Spacer()
                    Text("\(library.downloaded.count)")
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(Theme.inkSoft)
                }
            }
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden, edges: .top)
            ForEach(library.playlists) { playlist in
            NavigationLink(value: playlist) {
                HStack {
                    Text(playlist.name).lineLimit(1)
                    Spacer()
                    Text("\(library.tracks(of: playlist).count)")
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(Theme.inkSoft)
                }
            }
            .listRowBackground(Color.clear)
            }
        }
        .listStyle(.plain)
        .overlay {
            if library.playlists.isEmpty {
                ContentUnavailableView("Aucune playlist", systemImage: "music.note.list", description: Text("Garde le doigt sur un morceau pour l'ajouter à une nouvelle playlist."))
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .navigationTitle("Playlists")
        .refreshable { await library.refresh() }
    }
}

struct PlaylistView: View {
    let playlist: Playlist
    @EnvironmentObject private var library: Library

    var body: some View {
        // la version à jour : elle change quand on ajoute ou retire un morceau
        let current = library.playlists.first { $0.id == playlist.id } ?? playlist
        let tracks = library.tracks(of: current)
        TrackList(tracks: tracks, playlist: current) {
            if !tracks.isEmpty { PlayButtons(tracks: tracks) }
        }
        .navigationTitle(playlist.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { DownloadButton(tracks: tracks) } }
    }
}

// MARK: Connexion

struct SettingsView: View {
    @EnvironmentObject private var library: Library
    @Environment(\.dismiss) private var dismiss
    @AppStorage(Appearance.storageKey) private var appearance = Appearance.system
    @State private var confirmingForget = false
    @State private var confirmingClear = false

    private var status: String {
        switch library.link {
        case .online: return "Connecté"
        case .connecting: return "Connexion…"
        case .offline: return "Injoignable"
        case .unpaired: return "Non connecté"
        }
    }

    private var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "–"
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Apparence") {
                    Picker("Thème", selection: $appearance) {
                        ForEach(Appearance.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                }
                .listRowBackground(Theme.card)
                Section("Mac") {
                    LabeledContent(library.macName.isEmpty ? "Mac" : library.macName, value: status)
                    if let host = library.baseURL?.host() {
                        LabeledContent("Adresse", value: host)
                    }
                    LabeledContent("Morceaux", value: "\(library.tracks.count)")
                    LabeledContent("Playlists", value: "\(library.playlists.count)")
                    Button("Actualiser la bibliothèque") {
                        Task { await library.refresh() }
                    }
                }
                .listRowBackground(Theme.card)
                Section("Hors ligne") {
                    LabeledContent("Morceaux téléchargés", value: "\(library.downloaded.count)")
                    LabeledContent("Espace utilisé", value: ByteCountFormatter.string(fromByteCount: library.downloadsSize, countStyle: .file))
                    if !library.downloaded.isEmpty {
                        Button("Tout retirer de l'iPhone", role: .destructive) { confirmingClear = true }
                    }
                }
                .listRowBackground(Theme.card)
                Section("À propos") {
                    LabeledContent("Version", value: version)
                }
                .listRowBackground(Theme.card)
                Section {
                    Button("Déconnecter ce Mac", role: .destructive) { confirmingForget = true }
                } footer: {
                    Text("Les téléchargements seront retirés, et il faudra un nouveau code, affiché dans les Réglages de 2Listen sur le Mac.")
                }
                .listRowBackground(Theme.card)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Réglages")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("OK") { dismiss() } }
            }
            .confirmationDialog("Retirer tous les téléchargements ?", isPresented: $confirmingClear, titleVisibility: .visible) {
                Button("Tout retirer", role: .destructive) { library.removeAllDownloads() }
            }
            .confirmationDialog("Déconnecter ce Mac ?", isPresented: $confirmingForget, titleVisibility: .visible) {
                Button("Déconnecter", role: .destructive) {
                    library.forget()
                    dismiss()
                }
            }
        }
    }
}
