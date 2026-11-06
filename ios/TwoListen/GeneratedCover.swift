import SwiftUI

/// Générateur reproductible : une même graine donne toujours la même pochette.
struct SeededRandom: RandomNumberGenerator {
    private var state: UInt64

    init(seed: String) {
        // FNV-1a : `hashValue` change à chaque lancement de l'app
        var hash: UInt64 = 0xCBF2_9CE4_8422_2325
        for byte in seed.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x0000_0100_0000_01B3
        }
        state = hash
    }

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

/// La pochette d'un morceau qui n'en a pas : un style et des couleurs tirés de son album.
struct GeneratedCover: View {
    let seed: String

    private static let palettes: [(back: UInt32, main: UInt32, spot: UInt32)] = [
        (0x16181D, 0xFF5A1F, 0xF2EDE4), (0x1B2A41, 0x6FA8DC, 0xF4D35E), (0x2B193D, 0xC86FC9, 0xFFD6A5),
        (0x0F3D3E, 0x66D2B0, 0xF1E9DA), (0x3A0F14, 0xE4572E, 0xF3D9B1), (0xEFE9DD, 0x1A1A1A, 0xFF5A1F),
        (0xDDE5E8, 0x2F4858, 0xF26419), (0x22223B, 0x9A8C98, 0xF2E9E4), (0x102A1E, 0xA3C94A, 0xEDEDC4),
        (0xF4C95D, 0x1F1F1F, 0xD1495B)
    ]

    var body: some View {
        Canvas { context, size in
            var random = SeededRandom(seed: seed)
            let palette = Self.palettes[Int.random(in: 0..<Self.palettes.count, using: &random)]
            let colors = (main: Color(hex: palette.main), spot: Color(hex: palette.spot))
            context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Color(hex: palette.back)))
            let side = max(size.width, size.height)
            switch Int.random(in: 0..<6, using: &random) {
            case 0: drawWave(&context, side, colors, &random)
            case 1: drawRings(&context, side, colors, &random)
            case 2: drawSun(&context, side, colors, &random)
            case 3: drawStripes(&context, side, colors, &random)
            case 4: drawDots(&context, side, colors, &random)
            default: drawArcs(&context, side, colors, &random)
            }
        }
        .accessibilityHidden(true)
    }

    private typealias Colors = (main: Color, spot: Color)

    /// Des capsules à la façon du logo.
    private func drawWave(_ context: inout GraphicsContext, _ side: CGFloat, _ colors: Colors, _ random: inout SeededRandom) {
        let count = Int.random(in: 7...13, using: &random)
        let step = side / CGFloat(count + 1)
        let highlighted = Int.random(in: 0..<count, using: &random)
        for i in 0..<count {
            let height = side * CGFloat.random(in: 0.12...0.78, using: &random)
            let rect = CGRect(x: step * CGFloat(i + 1) - step * 0.28, y: (side - height) / 2, width: step * 0.56, height: height)
            context.fill(Path(roundedRect: rect, cornerRadius: step * 0.28), with: .color(i == highlighted ? colors.spot : colors.main))
        }
    }

    private func drawRings(_ context: inout GraphicsContext, _ side: CGFloat, _ colors: Colors, _ random: inout SeededRandom) {
        let center = CGPoint(x: side * .random(in: 0.2...0.8, using: &random), y: side * .random(in: 0.2...0.8, using: &random))
        let count = Int.random(in: 4...8, using: &random)
        let gap = side * 1.2 / CGFloat(count)
        for i in 1...count {
            let radius = gap * CGFloat(i)
            let circle = Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
            context.stroke(circle, with: .color(i % 3 == 0 ? colors.spot : colors.main), lineWidth: gap * 0.34)
        }
    }

    /// Un astre coupé par des bandes qui s'épaississent vers le bas.
    private func drawSun(_ context: inout GraphicsContext, _ side: CGFloat, _ colors: Colors, _ random: inout SeededRandom) {
        let radius = side * .random(in: 0.26...0.38, using: &random)
        let center = CGPoint(x: side / 2, y: side * .random(in: 0.42...0.58, using: &random))
        let disc = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
        context.fill(Path(ellipseIn: disc), with: .color(colors.main))
        var cut = context
        cut.blendMode = .normal
        let bands = Int.random(in: 3...6, using: &random)
        for i in 0..<bands {
            let y = center.y + radius * CGFloat(i) / CGFloat(bands)
            let height = side * 0.012 * CGFloat(i + 1)
            cut.fill(Path(CGRect(x: disc.minX, y: y, width: disc.width, height: height)), with: .color(colors.spot))
        }
    }

    private func drawStripes(_ context: inout GraphicsContext, _ side: CGFloat, _ colors: Colors, _ random: inout SeededRandom) {
        var layer = context
        layer.translateBy(x: side / 2, y: side / 2)
        layer.rotate(by: .degrees(Double.random(in: 0...3, using: &random).rounded() * 45 - 45))
        var x = -side
        while x < side {
            let width = side * .random(in: 0.02...0.14, using: &random)
            let color = Bool.random(using: &random) ? colors.main : colors.spot
            layer.fill(Path(CGRect(x: x, y: -side, width: width, height: side * 2)), with: .color(color))
            x += width + side * .random(in: 0.02...0.1, using: &random)
        }
    }

    private func drawDots(_ context: inout GraphicsContext, _ side: CGFloat, _ colors: Colors, _ random: inout SeededRandom) {
        let count = Int.random(in: 5...9, using: &random)
        let cell = side / CGFloat(count)
        for row in 0..<count {
            for column in 0..<count {
                let radius = cell * .random(in: 0.08...0.46, using: &random)
                let rect = CGRect(
                    x: cell * (CGFloat(column) + 0.5) - radius,
                    y: cell * (CGFloat(row) + 0.5) - radius,
                    width: radius * 2, height: radius * 2
                )
                let color = Int.random(in: 0..<6, using: &random) == 0 ? colors.spot : colors.main
                context.fill(Path(ellipseIn: rect), with: .color(color))
            }
        }
    }

    /// Une mosaïque de quarts de cercle.
    private func drawArcs(_ context: inout GraphicsContext, _ side: CGFloat, _ colors: Colors, _ random: inout SeededRandom) {
        let count = Int.random(in: 3...5, using: &random)
        let cell = side / CGFloat(count)
        for row in 0..<count {
            for column in 0..<count {
                let origin = CGPoint(x: cell * CGFloat(column), y: cell * CGFloat(row))
                let corner = Int.random(in: 0..<4, using: &random)
                let center = CGPoint(x: origin.x + (corner % 2 == 0 ? 0 : cell), y: origin.y + (corner < 2 ? 0 : cell))
                let start = Double(corner == 0 ? 0 : corner == 1 ? 90 : corner == 2 ? 270 : 180)
                var arc = Path()
                arc.move(to: center)
                arc.addArc(center: center, radius: cell, startAngle: .degrees(start), endAngle: .degrees(start + 90), clockwise: false)
                arc.closeSubpath()
                let color = Int.random(in: 0..<4, using: &random) == 0 ? colors.spot : colors.main
                context.fill(arc, with: .color(color))
            }
        }
    }
}
