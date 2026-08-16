// Tests for Model.js — the pure half of the widget, where every assumption
// about how wg-quick formats its output is written down.
//
//   node tests/run.js
//
// No dependencies and no test framework: the plugin ships no package.json and
// is not built, so a test suite that needed installing would not get run.
//
// Model.js is a QML `.pragma library`, which has no module system — just
// top-level declarations. Running it in this realm's global scope turns those
// into globals, which is as close to importing it as node gets without a QML
// engine; collecting the names it added gives back something shaped like a
// module. A fresh VM context would be tidier, but its arrays would carry that
// context's prototypes and every deepStrictEqual would fail on realm alone.

const fs = require("fs")
const path = require("path")
const vm = require("vm")
const assert = require("assert")

const source = fs.readFileSync(path.join(__dirname, "..", "Model.js"), "utf8")
  .replace(/^\s*\.pragma\s+library\s*$/m, "")

const before = new Set(Object.getOwnPropertyNames(globalThis))
vm.runInThisContext(source, { filename: "Model.js" })

const Model = {}
for (const name of Object.getOwnPropertyNames(globalThis)) {
  if (!before.has(name)) Model[name] = globalThis[name]
}

let passed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed += 1
  } catch (error) {
    failures.push({ name: name, error: error })
  }
}

const eq = assert.deepStrictEqual

// ------------------------------------------------------------------ shared

test("elide keeps short text and collapses whitespace", () => {
  eq(Model.elide("  a   b  ", 10), "a b")
  eq(Model.elide("abcdefghij", 10), "abcdefghij")
  eq(Model.elide("abcdefghijk", 10), "abcdefghi…")
  eq(Model.elide(null, 10), "")
})

test("applyPendingToggles marks only the flipped switch busy", () => {
  const toggles = [Model.toggle("a", "A", "", false), Model.toggle("b", "B", "", true)]
  const applied = Model.applyPendingToggles(toggles, { a: true })
  eq(applied[0].value, true)
  eq(applied[0].busy, true)
  eq(applied[1].value, true)
  eq(applied[1].busy, false)
  eq(Model.applyPendingToggles(toggles, null), toggles)
})

test("backend id lists round-trip through the comma-separated setting", () => {
  eq(Model.parseBackendIds(" wireguard ,, wireguard "), ["wireguard"])
  eq(Model.parseBackendIds(null), [])
  eq(Model.joinBackendIds(["wireguard"]), "wireguard")
  eq(Model.toggleBackendId(["wireguard"], "proton"), ["wireguard", "proton"])
  eq(Model.toggleBackendId(["wireguard", "proton"], "wireguard"), ["proton"])
})

// --------------------------------------------------------------- public IP

test("parsePublicIp accepts address literals", () => {
  eq(Model.parsePublicIp("1.2.3.4"), "1.2.3.4")
  eq(Model.parsePublicIp("  8.8.8.8\n"), "8.8.8.8")
  eq(Model.parsePublicIp("2001:DB8::1"), "2001:db8::1")
})

test("parsePublicIp rejects anything that is not one", () => {
  // A captive portal's login page, an error body, a spoofed answer with a
  // trailer: none of these are an exit address, and rendering one would be the
  // widget confirming a route it never saw.
  eq(Model.parsePublicIp("<html>Sign in</html>"), "")
  eq(Model.parsePublicIp("1.2.3.4 extra"), "")
  eq(Model.parsePublicIp("999.1.1.1"), "")
  eq(Model.parsePublicIp("deadbeef"), "")
  eq(Model.parsePublicIp("1:2:::3"), "")
  eq(Model.parsePublicIp("::1::2"), "")
  eq(Model.parsePublicIp(""), "")
  eq(Model.parsePublicIp(null), "")
  eq(Model.parsePublicIp("1.2.3.4".padEnd(50, "0")), "")
})

// ---------------------------------------------------------------- WireGuard

test("parseWgInterfaces reads whitespace-separated interface names", () => {
  eq(Model.parseWgInterfaces("wg_client wg0\n"), ["wg_client", "wg0"])
  eq(Model.parseWgInterfaces(""), [])
  eq(Model.parseWgInterfaces("  \n"), [])
})

test("parseWgDump exposes health data without secrets", () => {
  const health = Model.parseWgDump("wg0\tprivate\tpublic\t51820\t0\nwg0\tpeer\tpsk\tvpn.example:51820\t0.0.0.0/0, ::/0\t100\t2048\t1024\t25\n")
  eq(health.wg0.endpoints, ["vpn.example:51820"])
  eq(health.wg0.lastHandshake, 100)
  eq(health.wg0.rxBytes, 2048)
  eq(health.wg0.txBytes, 1024)
  eq(health.wg0.defaultRoute, true)
  eq(Model.formatHandshakeAge(100, 161), "1m ago")
})

test("parseSysfsStats extracts interface statistics and profile metadata without root", () => {
  const sample = "minipc_canada\t428036\t5028832\t195.242.214.130:51820\t0.0.0.0/0, ::/0\n"
  const health = Model.parseSysfsStats(sample)
  eq(health.minipc_canada.endpoints, ["195.242.214.130:51820"])
  eq(health.minipc_canada.rxBytes, 428036)
  eq(health.minipc_canada.txBytes, 5028832)
  eq(health.minipc_canada.defaultRoute, true)
})

test("wgInterfaceFor derives the interface name from the config basename", () => {
  eq(Model.wgInterfaceFor("/home/u/.config/omarchy/vpn/profiles/wg_client.conf"), "wg_client")
  eq(Model.wgInterfaceFor("wg_client.conf"), "wg_client")
  eq(Model.wgInterfaceFor("/tmp/foo.WG0.conf"), "foo.WG0")
})

test("wgTargets carries the conf path and the active flag", () => {
  const targets = Model.wgTargets([
    { name: "wg_client", confFile: "/p/wg_client.conf", active: true },
    { name: "wg_home", confFile: "/p/wg_home.conf", active: false }
  ])
  eq(targets.length, 2)
  eq(targets[0].key, "profile:wg_client")
  eq(targets[0].glyph, Model.GLYPH_SHIELD)
  eq(targets[0].detail, "Connected")
  eq(targets[1].detail, "WireGuard profile")
})

test("wgSummary prefers the active profile", () => {
  eq(Model.wgSummary([{ name: "a", active: false }, { name: "b", active: true }]), "b")
  eq(Model.wgSummary([{ name: "a", active: false }]), "Not connected")
  eq(Model.wgSummary([]), "No profiles")
})

test("wgDetails reports only the active profile", () => {
  const rows = Model.wgDetails([
    { name: "wg_client", confFile: "/p/wg_client.conf", active: true },
    { name: "wg_home", confFile: "/p/wg_home.conf", active: false }
  ])
  eq(rows.map(r => r.label + "=" + r.value), [
    "Profile=wg_client",
    "Interface=wg_client",
    "Managed by=wg-quick"
  ])
  eq(Model.wgDetails([{ name: "a", active: false }]), [])
})

test("activeWgProfile returns the connected one or nothing", () => {
  eq(Model.activeWgProfile([{ name: "a", active: false }]), null)
  eq(Model.activeWgProfile([{ name: "b", active: true }]).name, "b")
})

test("parsePingOutput parses round-trip time and packet loss", () => {
  const sample = "2 packets transmitted, 2 received, 0% packet loss, time 1001ms\nrtt min/avg/max/mdev = 20.974/22.450/24.120/0.010 ms\n"
  const parsed = Model.parsePingOutput(sample)
  eq(parsed.latencyMs, 22.45)
  eq(parsed.packetLoss, 0)
  eq(Model.formatLatency(parsed), "22 ms")
  eq(Model.formatPacketLoss(parsed), "0%")
})

test("parsePingOutput handles packet loss and failures", () => {
  const lossSample = "2 packets transmitted, 1 received, 50% packet loss\nrtt min/avg/max/mdev = 15.0/15.0/15.0/0.0 ms"
  const parsedLoss = Model.parsePingOutput(lossSample)
  eq(parsedLoss.packetLoss, 50)
  eq(Model.formatLatency(parsedLoss), "15 ms")
  eq(Model.formatPacketLoss(parsedLoss), "50%")

  const failSample = "2 packets transmitted, 0 received, 100% packet loss"
  const parsedFail = Model.parsePingOutput(failSample)
  eq(parsedFail.packetLoss, 100)
  eq(Model.formatLatency(parsedFail), "Unavailable")
  eq(Model.formatPacketLoss(parsedFail), "100%")
  eq(Model.formatLatency(null), "Measuring…")
})

test("wgDetails includes latency, packet loss, bandwidth rates, downloaded and uploaded metrics", () => {
  const profiles = [{ name: "wg_client", confFile: "/p/wg_client.conf", active: true }]
  const health = {
    wg_client: {
      endpoints: ["198.51.100.1:51820"],
      lastHandshake: 100,
      rxBytes: 52428800, // 50 MiB
      txBytes: 10485760, // 10 MiB
      rxRate: 204800,    // 200 KiB/s
      txRate: 10240,     // 10 KiB/s
      defaultRoute: true
    }
  }
  const pingInfo = { latencyMs: 25, packetLoss: 0 }
  const rows = Model.wgDetails(profiles, health, pingInfo)
  const map = {}
  for (const r of rows) map[r.label] = r.value

  eq(map["Profile"], "wg_client")
  eq(map["Interface"], "wg_client")
  eq(map["Latency"], "25 ms")
  eq(map["Packet loss"], "0%")
  eq(map["Receiving"], "200 KiB/s")
  eq(map["Sending"], "10 KiB/s")
  eq(map["Downloaded"], "50 MiB")
  eq(map["Uploaded"], "10 MiB")
  eq(map["Endpoint"], "198.51.100.1:51820")
  eq(map["Default route"], "Yes")
  eq(map["Managed by"], "wg-quick")
})

test("wgTargets handles empty profiles array", () => {
  eq(Model.wgTargets([]), [])
})

// ---------------------------------------------------------------- security

test("parsePublicIp sanitizes against XSS, command injection, and SSRF payloads", () => {
  eq(Model.parsePublicIp("1.2.3.4; rm -rf /"), "")
  eq(Model.parsePublicIp("<script>alert(1)</script>"), "")
  eq(Model.parsePublicIp("http://127.0.0.1:8080"), "")
  eq(Model.parsePublicIp("192.168.1.1\r\nSet-Cookie: test"), "")
  eq(Model.parsePublicIp("../../etc/passwd"), "")
})

test("wgInterfaceFor handles path traversal and special characters safely", () => {
  eq(Model.wgInterfaceFor("../../../etc/shadow.conf"), "shadow")
  eq(Model.wgInterfaceFor("/home/user/.config/vpn/work.conf"), "work")
  eq(Model.wgInterfaceFor("simple.conf"), "simple")
})

// ------------------------------------------------------------------ report

for (const failure of failures) {
  console.error("FAIL  " + failure.name)
  console.error("      " + String(failure.error.message).split("\n").join("\n      "))
}

console.log(`${passed} passed, ${failures.length} failed`)
process.exit(failures.length === 0 ? 0 : 1)
