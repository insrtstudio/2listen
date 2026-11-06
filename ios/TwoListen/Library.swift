import Foundation
import Network
import Security

/// La bibliothèque vue depuis l'iPhone : la connexion au Mac et ce qu'il sert.
@MainActor
final class Library: ObservableObject {
    enum Link: Equatable { case unpaired, connecting, online, offline }

    @Published private(set) var link: Link = .unpaired
    @Published private(set) var tracks: [Track] = []
    @Published private(set) var playlists: [Playlist] = []
    @Published private(set) var macName = ""
    @Published private(set) var albums: [Album] = []
    @Published private(set) var artists: [Artist] = []
    /// Une écriture ou un téléchargement qui a échoué, à signaler.
    @Published var notice: String?
    @Published var downloaded: Set<String> = []
    @Published var downloading: Set<String> = []
    var downloadQueue: [Track] = []
    var downloadWorker: Task<Void, Never>?
    let downloadSession = URLSession(configuration: .default)

    private(set) var baseURL: URL?
    private var token: String?
    private var byId: [String: Track] = [:]

    let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 8
        // assez pour garder les pochettes d'une grosse bibliothèque
        config.urlCache = URLCache(memoryCapacity: 32 << 20, diskCapacity: 512 << 20)
        return URLSession(configuration: config)
    }()

    /// Hors du dossier Caches, que le système peut vider : sans le Mac, c'est tout ce qu'il reste.
    private var cacheFile: URL {
        let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder.appendingPathComponent("library.json")
    }

    init() {
        loadDownloads()
        guard let saved = UserDefaults.standard.string(forKey: "server"), let url = URL(string: saved),
              let secret = Keychain.read() else { return }
        baseURL = url
        token = secret
        macName = UserDefaults.standard.string(forKey: "macName") ?? ""
        link = .connecting
        // la liste reste consultable le temps de joindre le Mac
        if let data = try? Data(contentsOf: cacheFile), let payload = try? JSONDecoder().decode(LibraryPayload.self, from: data) {
            apply(payload)
        }
    }

    // MARK: Adresses

    func streamURL(_ track: Track) -> URL? { localAudio(track) ?? url("stream/\(track.id).\(track.ext)") }
    func coverURL(_ key: String?) -> URL? { key.flatMap { localCover($0) ?? url("cover/\($0)") } }
    func peaksURL(_ track: Track) -> URL? { localPeaks(track) ?? url("peaks/\(track.id)") }
    func remoteURL(_ path: String) -> URL? { url(path) }

    private func url(_ path: String) -> URL? {
        guard let baseURL, let token else { return nil }
        var parts = URLComponents(url: baseURL.appendingPathComponent("api/\(path)"), resolvingAgainstBaseURL: false)
        parts?.queryItems = [URLQueryItem(name: "t", value: token)]
        return parts?.url
    }

    // MARK: Connexion

    enum PairError: LocalizedError {
        case wrongCode, unreachable
        var errorDescription: String? {
            switch self {
            case .wrongCode: return "Ce code n'est pas le bon, ou il a expiré. Regarde celui affiché dans Réglages sur le Mac."
            case .unreachable: return "Mac injoignable. Vérifie que 2Listen est ouvert et que l'iPhone est sur le même réseau."
            }
        }
    }

    func pair(server: URL, code: String) async throws {
        var request = URLRequest(url: server.appendingPathComponent("api/pair"))
        request.httpMethod = "POST"
        request.httpBody = try JSONEncoder().encode(["code": code])
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw PairError.unreachable
        }
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let reply = try? JSONDecoder().decode(PairReply.self, from: data) else { throw PairError.wrongCode }
        Keychain.save(reply.token)
        UserDefaults.standard.set(server.absoluteString, forKey: "server")
        UserDefaults.standard.set(reply.name, forKey: "macName")
        baseURL = server
        token = reply.token
        macName = reply.name
        link = .connecting
        await refresh()
    }

    private struct PairReply: Decodable { let token: String; let name: String }

    func refresh() async {
        guard let url = url("library") else { return }
        do {
            let (data, response) = try await session.data(from: url)
            let status = (response as? HTTPURLResponse)?.statusCode
            if status == 401 {
                // le Mac a déconnecté les appareils : il faut un nouveau code.
                // Les téléchargements restent, ils resserviront à la reconnexion.
                forget(keepingDownloads: true)
                return
            }
            guard status == 200 else { throw URLError(.badServerResponse) }
            apply(try JSONDecoder().decode(LibraryPayload.self, from: data))
            try? data.write(to: cacheFile, options: .atomic)
            link = .online
            pruneDownloads()
            saveAddresses(data)
        } catch {
            link = .offline
            await rediscover()
        }
    }

    /// L'adresse du Mac a pu changer : Bonjour le retrouve sans nouvel appairage, et hors
    /// de chez soi on essaie ses autres adresses (Tailscale, par exemple).
    private func rediscover() async {
        var candidates = (UserDefaults.standard.stringArray(forKey: "addresses") ?? []).compactMap(URL.init(string:))
        if let nearby = await Bonjour.firstServer(timeout: 4) { candidates.insert(nearby, at: 0) }
        for candidate in candidates where candidate != baseURL {
            guard await accepts(candidate) else { continue }
            baseURL = candidate
            UserDefaults.standard.set(candidate.absoluteString, forKey: "server")
            await refresh()
            return
        }
    }

    /// Un autre 2Listen sur le réseau refuse notre jeton : il ne faut surtout pas s'y connecter.
    private func accepts(_ server: URL) async -> Bool {
        guard let token else { return false }
        var request = URLRequest(url: server.appendingPathComponent("api/info/auth"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 3
        guard let (_, response) = try? await session.data(for: request) else { return false }
        return (response as? HTTPURLResponse)?.statusCode == 200
    }

    private func saveAddresses(_ data: Data) {
        guard let reply = try? JSONDecoder().decode(Reach.self, from: data) else { return }
        UserDefaults.standard.set(reply.addresses.map { "http://\($0):\(reply.port)" }, forKey: "addresses")
    }

    private struct Reach: Decodable { let addresses: [String]; let port: Int }

    func forget(keepingDownloads: Bool = false) {
        if !keepingDownloads { removeAllDownloads() }
        UserDefaults.standard.removeObject(forKey: "addresses")
        Keychain.delete()
        UserDefaults.standard.removeObject(forKey: "server")
        UserDefaults.standard.removeObject(forKey: "macName")
        try? FileManager.default.removeItem(at: cacheFile)
        baseURL = nil
        token = nil
        macName = ""
        tracks = []
        playlists = []
        albums = []
        artists = []
        byId = [:]
        link = .unpaired
    }

    func tracks(of playlist: Playlist) -> [Track] { playlist.trackIds.compactMap { byId[$0] } }
    func album(of track: Track) -> Album? { albums.first { $0.tracks.contains(track) } }
    func artist(of track: Track) -> Artist? { artists.first { $0.tracks.contains(track) } }

    // MARK: Playlists

    func add(_ track: Track, to playlist: Playlist) async {
        await write("playlists/\(playlist.id)/tracks", method: "POST", body: ["trackIds": [track.id]])
    }

    func remove(_ track: Track, from playlist: Playlist) async {
        await write("playlists/\(playlist.id)/tracks", method: "DELETE", body: ["trackIds": [track.id]])
    }

    func createPlaylist(named name: String, with track: Track?) async {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        await write("playlists", method: "POST", body: ["name": trimmed.isEmpty ? "Nouvelle playlist" : trimmed, "trackIds": track.map { [$0.id] } ?? []])
    }

    /// Le Mac reste la référence : on relit la bibliothèque après chaque écriture.
    private func write(_ path: String, method: String, body: [String: Any]) async {
        guard let baseURL, let token else { return }
        var request = URLRequest(url: baseURL.appendingPathComponent("api/\(path)"))
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        guard let (_, response) = try? await session.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200 else {
            notice = "Le Mac n'a pas pu enregistrer. Vérifie que 2Listen y est ouvert, puis réessaie."
            return
        }
        await refresh()
    }

    private func apply(_ payload: LibraryPayload) {
        tracks = payload.tracks
        playlists = payload.playlists
        byId = Dictionary(payload.tracks.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })

        let inAlbumOrder: (Track, Track) -> Bool = {
            (($0.discNo ?? 1), ($0.trackNo ?? 0), $0.title) < (($1.discNo ?? 1), ($1.trackNo ?? 0), $1.title)
        }
        albums = Dictionary(grouping: payload.tracks, by: { "\($0.groupArtist)\u{1}\($0.groupAlbum)" })
            .values
            .map { Album(title: $0[0].groupAlbum, artist: $0[0].groupArtist, tracks: $0.sorted(by: inAlbumOrder)) }
            .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
        artists = Dictionary(grouping: payload.tracks, by: \.groupArtist)
            .map { Artist(name: $0.key, tracks: $0.value.sorted(by: inAlbumOrder)) }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }
}

/// Le jeton donne accès à toute la musique : il vit dans le trousseau.
enum Keychain {
    private static let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "fr.insrt.twolisten",
        kSecAttrAccount as String: "server-token"
    ]

    static func save(_ value: String) {
        delete()
        var item = query
        item[kSecValueData as String] = Data(value.utf8)
        // accessible écran verrouillé : la lecture enchaîne sans déverrouillage
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }

    static func read() -> String? {
        var search = query
        search[kSecReturnData as String] = true
        search[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(search as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete() {
        SecItemDelete(query as CFDictionary)
    }
}

/// Recherche des Mac qui annoncent `_2listen._tcp` sur le réseau local.
@MainActor
final class Bonjour: ObservableObject {
    struct Server: Identifiable, Hashable {
        let name: String
        let endpoint: NWEndpoint
        var id: String { name }
    }

    @Published private(set) var servers: [Server] = []
    private var browser: NWBrowser?

    func start() {
        guard browser == nil else { return }
        let browser = NWBrowser(for: .bonjour(type: "_2listen._tcp", domain: nil), using: .tcp)
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            let found = results.compactMap { result -> Server? in
                guard case let .service(name, _, _, _) = result.endpoint else { return nil }
                return Server(name: name, endpoint: result.endpoint)
            }
            Task { @MainActor in self?.servers = found.sorted { $0.name < $1.name } }
        }
        browser.start(queue: .main)
        self.browser = browser
    }

    func stop() {
        browser?.cancel()
        browser = nil
    }

    /// Adresse IPv4 et port d'un service trouvé.
    nonisolated static func resolve(_ endpoint: NWEndpoint) async -> URL? {
        let parameters = NWParameters.tcp
        (parameters.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options)?.version = .v4
        let connection = NWConnection(to: endpoint, using: parameters)
        return await withCheckedContinuation { continuation in
            let done = Once()
            let finish: (URL?) -> Void = { url in
                if done.claim() {
                    connection.cancel()
                    continuation.resume(returning: url)
                }
            }
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    guard case let .hostPort(host, port)? = connection.currentPath?.remoteEndpoint else { return finish(nil) }
                    finish(URL(string: "http://\("\(host)".split(separator: "%")[0]):\(port.rawValue)"))
                case .failed, .cancelled:
                    finish(nil)
                default:
                    break
                }
            }
            connection.start(queue: .global())
            DispatchQueue.global().asyncAfter(deadline: .now() + 5) { finish(nil) }
        }
    }

    static func firstServer(timeout: TimeInterval) async -> URL? {
        let bonjour = Bonjour()
        bonjour.start()
        defer { bonjour.stop() }
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let server = bonjour.servers.first { return await resolve(server.endpoint) }
            try? await Task.sleep(for: .milliseconds(200))
        }
        return nil
    }
}

/// Ne laisse passer qu'un seul appel, quel que soit le fil.
final class Once: @unchecked Sendable {
    private let lock = NSLock()
    private var claimed = false
    func claim() -> Bool {
        lock.lock(); defer { lock.unlock() }
        if claimed { return false }
        claimed = true
        return true
    }
}
