import SwiftUI

struct MainTabs: View {
    @EnvironmentObject private var library: Library
    @EnvironmentObject private var player: Player
    @State private var showNowPlaying = false
    @State private var showSettings = false
    @State private var tab = "tracks"

    var body: some View {
        tabs
            .sheet(isPresented: $showNowPlaying) {
                NowPlayingView()
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
                    .presentationDetents([.medium])
            }
            #if DEBUG
            .onChange(of: player.current) { _, track in
                if track != nil && TestHooks.openNowPlaying { showNowPlaying = true }
            }
            .onAppear {
                if let wanted = TestHooks.tab { tab = wanted }
                if TestHooks.env["TL_OPEN"] == "settings" { showSettings = true }
            }
            #endif
    }

    private func screen<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        NavigationStack {
            content()
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            showSettings = true
                        } label: {
                            Image(systemName: library.link == .offline ? "desktopcomputer.trianglebadge.exclamationmark" : "desktopcomputer")
                                // l'orange ne signale ici qu'un Mac injoignable
                                .foregroundStyle(library.link == .offline ? Theme.accent : Color.primary)
                        }
                        .accessibilityLabel("Connexion au Mac")
                    }
                }
                .navigationDestination(for: Album.self) { AlbumView(album: $0) }
                .navigationDestination(for: Artist.self) { ArtistView(artist: $0) }
                .navigationDestination(for: Playlist.self) { PlaylistView(playlist: $0) }
        }
    }

    @ViewBuilder
    private var tabs: some View {
        let view = TabView(selection: $tab) {
            Tab("Morceaux", systemImage: "music.note", value: "tracks") { screen { TracksView() } }
            Tab("Albums", systemImage: "square.stack", value: "albums") { screen { AlbumsView() } }
            Tab("Artistes", systemImage: "music.mic", value: "artists") { screen { ArtistsView() } }
            Tab("Playlists", systemImage: "music.note.list", value: "playlists") { screen { PlaylistsView() } }
        }
        if #available(iOS 26.0, *) {
            // l'accessoire de la barre d'onglets en Liquid Glass, toujours présent comme dans Musique :
            // l'ajouter au premier morceau recréerait les onglets et perdrait la navigation en cours
            view
                .tabBarMinimizeBehavior(.onScrollDown)
                .tabViewBottomAccessory { MiniPlayer { showNowPlaying = true } }
        } else {
            view.safeAreaInset(edge: .bottom) {
                if player.current != nil {
                    MiniPlayer { showNowPlaying = true }
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
    let header: Header
    @EnvironmentObject private var player: Player

    init(tracks: [Track], numbered: Bool = false, @ViewBuilder header: () -> Header = { EmptyView() }) {
        self.tracks = tracks
        self.numbered = numbered
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
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                .listRowSeparator(track.id == tracks.first?.id ? .hidden : .automatic, edges: .top)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Theme.background)
    }
}

struct TrackRow: View {
    let track: Track
    var number: Int?
    let isCurrent: Bool
    @EnvironmentObject private var player: Player

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
                    if isCurrent && track.cover == nil {
                        // pas de pochette : la note du substitut brouillerait l'onde
                        RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Theme.well)
                        nowPlayingGlyph.foregroundStyle(Theme.accent)
                    } else {
                        CoverView(key: track.cover, cornerRadius: 8)
                        if isCurrent {
                            RoundedRectangle(cornerRadius: 8, style: .continuous).fill(.black.opacity(0.45))
                            nowPlayingGlyph.foregroundStyle(.white)
                        }
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
    var cornerRadius: CGFloat = 12
    @EnvironmentObject private var library: Library

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(Theme.well)
            .overlay {
                AsyncImage(url: library.coverURL(key)) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
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
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
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
                            CoverView(key: album.cover).aspectRatio(1, contentMode: .fit)
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
                CoverView(key: album.cover, cornerRadius: 16).frame(width: 220, height: 220)
                Text(album.title).font(.title3.weight(.bold)).multilineTextAlignment(.center)
                Text(album.artist + (album.year.map { " · \($0)" } ?? ""))
                    .font(.subheadline)
                    .foregroundStyle(Theme.inkSoft)
                PlayButtons(tracks: album.tracks).padding(.top, 4)
            }
            .frame(maxWidth: .infinity)
        }
        .navigationBarTitleDisplayMode(.inline)
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
        List(library.playlists) { playlist in
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
            .listRowSeparator(playlist.id == library.playlists.first?.id ? .hidden : .automatic, edges: .top)
        }
        .listStyle(.plain)
        .overlay {
            if library.playlists.isEmpty {
                ContentUnavailableView("Aucune playlist", systemImage: "music.note.list", description: Text("Crée-en une dans 2Listen sur le Mac."))
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
        let tracks = library.tracks(of: playlist)
        TrackList(tracks: tracks) {
            if !tracks.isEmpty { PlayButtons(tracks: tracks) }
        }
        .navigationTitle(playlist.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: Connexion

struct SettingsView: View {
    @EnvironmentObject private var library: Library
    @EnvironmentObject private var player: Player
    @Environment(\.dismiss) private var dismiss

    private var status: String {
        switch library.link {
        case .online: return "Connecté"
        case .connecting: return "Connexion…"
        case .offline: return "Injoignable"
        case .unpaired: return "Non connecté"
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Mac") {
                    LabeledContent(library.macName.isEmpty ? "Mac" : library.macName, value: status)
                    LabeledContent("Morceaux", value: "\(library.tracks.count)")
                }
                .listRowBackground(Theme.card)
                Section {
                    Button("Déconnecter ce Mac", role: .destructive) {
                        library.forget()
                        dismiss()
                    }
                }
                .listRowBackground(Theme.card)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Connexion")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("OK") { dismiss() } }
            }
        }
    }
}
