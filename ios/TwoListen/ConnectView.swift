import Network
import SwiftUI

/// Premier lancement : trouver le Mac, saisir le code affiché dans ses Réglages.
struct ConnectView: View {
    @EnvironmentObject private var library: Library
    @StateObject private var bonjour = Bonjour()
    @State private var selected: Bonjour.Server?
    @State private var manualAddress = ""
    @State private var showManual = false
    @State private var code = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var codeFocused: Bool

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(spacing: 14) {
                        AppMark(size: 84)
                        Text("Écoute ta bibliothèque")
                            .font(.title2.weight(.bold))
                        Text("Sur le Mac, ouvre 2Listen, puis Réglages, et active « Écouter depuis l'iPhone ».")
                            .font(.subheadline)
                            .foregroundStyle(Theme.inkSoft)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .listRowBackground(Color.clear)
                }

                Section("Mac") {
                    if bonjour.servers.isEmpty {
                        HStack(spacing: 10) {
                            ProgressView()
                            Text("Recherche sur le réseau…").foregroundStyle(Theme.inkSoft)
                        }
                    }
                    ForEach(bonjour.servers) { server in
                        Button {
                            selected = server
                            showManual = false
                            codeFocused = true
                        } label: {
                            HStack {
                                Label(server.name, systemImage: "desktopcomputer").foregroundStyle(.primary)
                                Spacer()
                                if selected == server { Image(systemName: "checkmark").foregroundStyle(Theme.accent) }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                    if showManual {
                        TextField("192.168.1.20:47810", text: $manualAddress)
                            .keyboardType(.numbersAndPunctuation)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                            .font(.system(.body, design: .monospaced))
                    } else {
                        Button("Saisir l'adresse") {
                            showManual = true
                            selected = nil
                        }
                    }
                }
                .listRowBackground(Theme.card)

                if selected != nil || showManual {
                    Section {
                        TextField("000000", text: $code)
                            .keyboardType(.numberPad)
                            .focused($codeFocused)
                            .font(.system(.title2, design: .monospaced))
                        Button {
                            Task { await connect() }
                        } label: {
                            HStack {
                                Text("Connecter").fontWeight(.semibold)
                                Spacer()
                                if busy { ProgressView() }
                            }
                        }
                        .disabled(busy || code.count != 6)
                    } header: {
                        Text("Code d'appairage")
                    } footer: {
                        if let error { Text(error).foregroundStyle(Theme.accent) }
                    }
                    .listRowBackground(Theme.card)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
        }
        .onAppear { bonjour.start() }
        .onDisappear { bonjour.stop() }
    }

    private func connect() async {
        busy = true
        error = nil
        defer { busy = false }
        let target: URL?
        if let selected {
            target = await Bonjour.resolve(selected.endpoint)
        } else {
            let text = manualAddress.trimmingCharacters(in: .whitespaces)
            let withPort = text.contains(":") ? text : "\(text):47810"
            target = URL(string: "http://\(withPort)")
        }
        guard let target else {
            error = Library.PairError.unreachable.localizedDescription
            return
        }
        do {
            try await library.pair(server: target, code: code)
        } catch let failure {
            self.error = failure.localizedDescription
        }
    }
}
