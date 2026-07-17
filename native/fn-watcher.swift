// Prints "DOWN" / "UP" to stdout whenever the physical Fn (globe) key is
// pressed or released, by watching the .maskSecondaryFn bit on system-wide
// flagsChanged events. Runs until killed.
//
// Requires the *host* process (whatever spawns this binary — Electron in
// dev, or the packaged app) to have "Input Monitoring" permission granted
// in System Settings > Privacy & Security. Without it CGEventTapCreate
// returns nil and this exits with a message on stderr.

import Cocoa

var isFnDown = false

func emit(_ s: String) {
    print(s)
    fflush(stdout)
}

let eventMask = (1 << CGEventType.flagsChanged.rawValue)

guard let tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .listenOnly,
    eventsOfInterest: CGEventMask(eventMask),
    callback: { _, _, event, _ in
        let down = event.flags.contains(.maskSecondaryFn)
        if down != isFnDown {
            isFnDown = down
            emit(down ? "DOWN" : "UP")
        }
        return Unmanaged.passRetained(event)
    },
    userInfo: nil
) else {
    FileHandle.standardError.write(
        "fn-watcher: failed to create event tap — grant Input Monitoring permission to the parent app in System Settings > Privacy & Security, then restart it.\n".data(using: .utf8)!
    )
    exit(1)
}

let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)

emit("READY")
CFRunLoopRun()
