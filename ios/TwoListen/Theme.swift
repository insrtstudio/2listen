import SwiftUI
import UIKit

/// Mêmes jetons que l'app Mac (styles.css). L'orange signale ce qui est actif.
enum Theme {
    static let accent = Color(hex: 0xFF4D00)
    static let sunset = Color(hex: 0xFF5A1F)
    static let background = Color(light: 0xE6E3DB, dark: 0x131210)
    static let card = Color(light: 0xF6F4EF, dark: 0x1F1E1B)
    static let well = Color(light: 0xEDEAE3, dark: 0x262421)
    static let inkSoft = Color(light: 0x77726A, dark: 0x8F897F)
    static let chrome = LinearGradient(
        stops: [
            .init(color: Color(hex: 0xFFFFFF), location: 0),
            .init(color: Color(hex: 0xA8B0BB), location: 0.65),
            .init(color: Color(hex: 0xEDF0F5), location: 1)
        ],
        startPoint: .top, endPoint: .bottom
    )
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }

    init(light: UInt32, dark: UInt32) {
        self.init(UIColor { traits in
            UIColor(Color(hex: traits.userInterfaceStyle == .dark ? dark : light))
        })
    }
}

/// Le logo de l'app : plaque encre, onde chromée, point sunset (cf. AppMark côté Mac).
struct AppMark: View {
    var size: CGFloat = 72
    private let bars: [(x: CGFloat, y: CGFloat, h: CGFloat)] = [
        (214, 384, 212), (342, 278, 424), (470, 225, 530), (598, 326, 328), (726, 410, 160)
    ]

    var body: some View {
        let u = size / 824
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 186 * u, style: .continuous).fill(Color(hex: 0x0D0D0E))
            ForEach(bars.indices, id: \.self) { i in
                Capsule()
                    .fill(Theme.chrome)
                    .frame(width: 84 * u, height: bars[i].h * u)
                    .offset(x: (bars[i].x - 100) * u, y: (bars[i].y - 100) * u)
            }
            Circle()
                .fill(Theme.sunset)
                .frame(width: 104 * u, height: 104 * u)
                .offset(x: 638 * u, y: 592 * u)
        }
        .frame(width: size, height: size)
    }
}
