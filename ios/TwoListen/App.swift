import SwiftUI

@main
struct TwoListenApp: App {
    @StateObject private var library = Library()
    @StateObject private var player = Player()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(library)
                .environmentObject(player)
                .environmentObject(player.clock)
                .tint(Theme.accent)
                .task {
                    player.attach(library)
                    #if DEBUG
                    await TestHooks.run(library: library, player: player)
                    #endif
                    await library.refresh()
                }
                .onChange(of: phase) { _, now in
                    if now == .active { Task { await library.refresh() } }
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var library: Library

    var body: some View {
        if library.baseURL == nil {
            ConnectView()
        } else {
            MainTabs()
        }
    }
}

#if DEBUG
/// Pilotage des tests sur simulateur, par variables d'environnement (jamais en Release).
enum TestHooks {
    static let env = ProcessInfo.processInfo.environment
    @MainActor static var openNowPlaying: Bool { env["TL_OPEN"] == "nowplaying" }
    static var tab: String? { env["TL_TAB"] }

    @MainActor
    static func run(library: Library, player: Player) async {
        if let server = env["TL_SERVER"], let url = URL(string: server), let code = env["TL_CODE"] {
            do {
                try await library.pair(server: url, code: code)
                NSLog("[tl-test] %@", "paired \(library.tracks.count) tracks")
            } catch {
                NSLog("[tl-test] %@", "pair failed \(error.localizedDescription)")
            }
        }
        if let wanted = env["TL_AUTOPLAY"] {
            await library.refresh()
            let list = library.tracks
            guard let start = list.first(where: { $0.title == wanted }) ?? list.first else { return }
            player.play(list, from: start)
            NSLog("[tl-test] %@", "play \(start.title)")
            Task {
                for _ in 0..<60 {
                    try? await Task.sleep(for: .seconds(2))
                    NSLog("[tl-test] %@", "t=\(String(format: "%.1f", player.clock.time)) playing=\(player.isPlaying) buffering=\(player.isBuffering) track=\(player.current?.title ?? "-") failure=\(player.failure ?? "-")")
                }
            }
        }
        if let seconds = env["TL_SEEK"].flatMap(Double.init) {
            try? await Task.sleep(for: .seconds(3))
            player.seek(to: seconds)
            NSLog("[tl-test] %@", "seek \(seconds)")
        }
    }
}
#endif
