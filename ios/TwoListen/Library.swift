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

    private(set) var baseURL: URL?
    private var token: String?
    private var byId: [String: Track] = [:]

    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 8
        // assez pour garder les pochettes d'une grosse bibliothèque
        config.urlCache = URLCache(memoryCapacity: 32 << 20, diskCapacity: 512 << 20)
        return URLSession(configuration: config)
    }()

    private var cacheFile: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("library.json")
    }

    init() {
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

    func streamURL(_ track: Track) -> URL? { url("stream/\(track.id).\(track.ext)") }
    func coverURL(_ key: String?) -> URL? { key.flatMap { url("cover/\($0)") } }
    func peaksURL(_ track: Track) -> URL? { url("peaks/\(track.id)") }

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
                // le Mac a déconnecté les appareils : il faut un nouveau code
                forget()
                return
            }
            guard status == 200 else { throw URLError(.badServerResponse) }
            apply(try JSONDecoder().decode(LibraryPayload.self, from: data))
            try? data.write(to: cacheFile, options: .atomic)
            link = .online
        } catch {
            link = .offline
            await rediscover()
        }
    }

    /// L'adresse du Mac a pu changer : Bonjour le retrouve sans nouvel appairage.
    private func rediscover() async {
        guard let found = await Bonjour.firstServer(timeout: 4), found != baseURL else { return }
        baseURL = found
        UserDefaults.standard.set(found.absoluteString, forKey: "server")
        await refresh()
    }

    func forget() {
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
