import AppKit
import AVFoundation
import Foundation

guard (3...6).contains(CommandLine.arguments.count) else {
  fputs("usage: swift extract_reference_frames.swift INPUT OUTPUT_DIR [FRAME_COUNT] [START_SECONDS] [END_SECONDS]\n", stderr)
  exit(2)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
let requestedFrameCount = CommandLine.arguments.count >= 4
  ? Int(CommandLine.arguments[3]) ?? 16
  : 16
let requestedStart = CommandLine.arguments.count >= 5
  ? Double(CommandLine.arguments[4]) ?? 0
  : 0

Task {
  do {
    try FileManager.default.createDirectory(
      at: outputURL,
      withIntermediateDirectories: true
    )

    let asset = AVURLAsset(url: inputURL)
    let duration = try await asset.load(.duration)
    let durationSeconds = CMTimeGetSeconds(duration)
    let tracks = try await asset.loadTracks(withMediaType: .video)
    guard let track = tracks.first else {
      throw NSError(domain: "StackRushReference", code: 1, userInfo: [
        NSLocalizedDescriptionKey: "The recording has no video track."
      ])
    }

    let naturalSize = try await track.load(.naturalSize)
    let transform = try await track.load(.preferredTransform)
    let transformedRect = CGRect(origin: .zero, size: naturalSize).applying(transform)
    let displaySize = CGSize(
      width: abs(transformedRect.width),
      height: abs(transformedRect.height)
    )

    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.requestedTimeToleranceBefore = CMTime(seconds: 0.05, preferredTimescale: 600)
    generator.requestedTimeToleranceAfter = CMTime(seconds: 0.05, preferredTimescale: 600)

    let requestedEnd = CommandLine.arguments.count >= 6
      ? Double(CommandLine.arguments[5]) ?? durationSeconds
      : durationSeconds
    let startSeconds = min(max(requestedStart, 0), durationSeconds)
    let endSeconds = min(max(requestedEnd, startSeconds), durationSeconds)
    let frameCount = max(1, requestedFrameCount)
    for index in 0..<frameCount {
      let progress = frameCount == 1 ? 0 : Double(index) / Double(frameCount - 1)
      let seconds = min(
        max(startSeconds + (endSeconds - startSeconds) * progress, 0),
        max(durationSeconds - 0.02, 0)
      )
      let requested = CMTime(seconds: seconds, preferredTimescale: 600)
      let image = try await generator.image(at: requested).image
      let bitmap = NSBitmapImageRep(cgImage: image)
      guard let data = bitmap.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "StackRushReference", code: 2, userInfo: [
          NSLocalizedDescriptionKey: "Could not encode frame \(index)."
        ])
      }
      let filename = String(format: "frame-%02d-%06.2fs.png", index, seconds)
      try data.write(to: outputURL.appendingPathComponent(filename))
    }

    print("duration=\(String(format: "%.3f", durationSeconds))")
    print("display=\(Int(displaySize.width))x\(Int(displaySize.height))")
    print("frames=\(frameCount)")
    exit(0)
  } catch {
    fputs("error: \(error.localizedDescription)\n", stderr)
    exit(1)
  }
}

RunLoop.main.run()
