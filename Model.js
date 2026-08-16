.pragma library

// Nerd Font glyphs are built from codepoints instead of raw characters so the
// file survives editing tools that mangle multi-byte sequences.
var GLYPH_VPN = String.fromCodePoint(0xF0582)
var GLYPH_CHECK = String.fromCodePoint(0xF012C)
var GLYPH_SHIELD = String.fromCodePoint(0xF0498)
var GLYPH_CHEVRON_DOWN = String.fromCodePoint(0xF0140)
var GLYPH_CHEVRON_UP = String.fromCodePoint(0xF0143)
var GLYPH_COG = String.fromCodePoint(0xF0493)
var GLYPH_REFRESH = String.fromCodePoint(0xF0450)
var GLYPH_FOLDER = String.fromCodePoint(0xF024B)
var GLYPH_GLOBE = String.fromCodePoint(0xF0AC)
var GLYPH_DOWNLOAD = String.fromCodePoint(0xF01DA)
var GLYPH_UPLOAD = String.fromCodePoint(0xF01DC)
var GLYPH_SPEED = String.fromCodePoint(0xF04D4)
var GLYPH_LOCK = String.fromCodePoint(0xF033E)

// ----------------------------------------------------------------- shared

// The exit address lookup answers with a bare address and nothing else. A
// captive portal's login page, a proxy's error body, or anything else that
// came back with it is not an answer — and this is the one number a user reads
// to decide whether the tunnel is carrying their traffic, so rendering
// whatever arrived would be the widget confirming a route it never saw.
// Returns "" for anything that is not an address literal.
function parsePublicIp(raw) {
  var text = String(raw || "").trim()
  // Longest possible IPv6 text form; anything longer is not an address.
  if (text === "" || text.length > 45) return ""

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) {
    var octets = text.split(".")
    for (var i = 0; i < octets.length; i++) {
      if (parseInt(octets[i], 10) > 255) return ""
    }
    return text
  }

  // IPv6 has too many legal spellings to re-implement here, so this checks the
  // alphabet and the shape rather than the grouping.
  if (/^[0-9a-fA-F:]+$/.test(text) && text.indexOf("::") === text.lastIndexOf("::")) {
    if (text.indexOf(":") !== -1 && !/:::/.test(text)) return text.toLowerCase()
  }
  return ""
}

function elide(text, limit) {
  var value = String(text || "").replace(/\s+/g, " ").trim()
  return value.length > limit ? value.substring(0, limit - 1) + "…" : value
}

function detail(label, value) {
  return { label: label, value: String(value || "") }
}

function toggle(key, label, description, value) {
  return { key: key, label: label, detail: description, value: value === true, busy: false }
}

function applyPendingToggles(toggles, pending) {
  if (!pending) return toggles
  return toggles.map(function(entry) {
    if (pending[entry.key] === undefined) return entry
    return { key: entry.key, label: entry.label, detail: entry.detail, value: pending[entry.key] === true, busy: true }
  })
}

// --------------------------------------------------------- widget settings

// Which tools the user told the widget to ignore, stored as one comma-separated
// string so the setting stays hand-editable in shell.json and in Omarchy's own
// settings dialog, which has no array field. WireGuard is the only backend, but
// the providers view still needs the vocabulary.
function parseBackendIds(raw) {
  var ids = []
  var parts = String(raw || "").split(",")
  for (var i = 0; i < parts.length; i++) {
    var id = parts[i].trim().toLowerCase()
    if (id !== "" && ids.indexOf(id) === -1) ids.push(id)
  }
  return ids
}

function joinBackendIds(ids) {
  return ids.join(",")
}

function toggleBackendId(ids, id) {
  var next = []
  var found = false
  for (var i = 0; i < ids.length; i++) {
    if (ids[i] === id) found = true
    else next.push(ids[i])
  }
  if (!found) next.push(id)
  return next
}

// ---------------------------------------------------------------- WireGuard
//
// WireGuard on this machine is wg-quick over plain *.conf files in a profiles
// directory, not NetworkManager profiles. The interface name is the config
// basename: wg_client.conf brings up `wg_client`. `wg show interfaces` lists
// the up interfaces without needing root, which is what makes status cheap and
// safe to poll.

// `wg show interfaces` separates interface names with whitespace. An empty
// read, or a read that failed, means nothing is up.
function parseWgInterfaces(raw) {
  var names = []
  var parts = String(raw || "").trim().split(/\s+/)
  for (var i = 0; i < parts.length; i++) {
    var name = parts[i].trim()
    if (name === "") continue
    if (names.indexOf(name) < 0) names.push(name)
  }
  return names
}

// `wg show all dump` has a five-field interface line followed by one
// tab-separated nine-field line per peer. Keep only the public health data;
// in particular, never retain private or preshared keys in widget state.
function parseWgDump(raw) {
  var health = {}
  var lines = String(raw || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var fields = lines[i].split("\t")
    var iface = String(fields[0] || "").trim()
    if (iface === "") continue
    if (!health[iface]) health[iface] = {
      endpoints: [], lastHandshake: 0, rxBytes: 0, txBytes: 0, defaultRoute: false
    }
    if (fields.length < 9) continue
    var entry = health[iface]
    var endpoint = String(fields[3] || "")
    if (endpoint !== "" && endpoint !== "(none)" && entry.endpoints.indexOf(endpoint) < 0) entry.endpoints.push(endpoint)
    var allowed = String(fields[4] || "").split(",")
    for (var j = 0; j < allowed.length; j++) {
      var cidr = allowed[j].trim()
      if (cidr === "0.0.0.0/0" || cidr === "::/0") entry.defaultRoute = true
    }
    entry.lastHandshake = Math.max(entry.lastHandshake, parseInt(fields[5], 10) || 0)
    entry.rxBytes += parseInt(fields[6], 10) || 0
    entry.txBytes += parseInt(fields[7], 10) || 0
  }
  return health
}

function parseSysfsStats(raw) {
  var health = {}
  var lines = String(raw || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim()
    if (line === "") continue
    var fields = line.split("\t")
    var iface = String(fields[0] || "").trim()
    if (iface === "") continue
    var rx = parseInt(fields[1], 10) || 0
    var tx = parseInt(fields[2], 10) || 0
    var endpoint = String(fields[3] || "").trim()
    var allowed = String(fields[4] || "").split(",")
    var defaultRoute = false
    for (var j = 0; j < allowed.length; j++) {
      var cidr = allowed[j].trim()
      if (cidr === "0.0.0.0/0" || cidr === "::/0") defaultRoute = true
    }
    health[iface] = {
      endpoints: endpoint !== "" ? [endpoint] : [],
      lastHandshake: 0,
      rxBytes: rx,
      txBytes: tx,
      defaultRoute: defaultRoute
    }
  }
  return health
}

function formatBytes(bytes) {
  var value = Math.max(0, Number(bytes) || 0)
  var units = ["B", "KiB", "MiB", "GiB", "TiB"]
  var index = 0
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++ }
  return (index === 0 ? String(Math.floor(value)) : value.toFixed(value >= 10 ? 0 : 1)) + " " + units[index]
}

function formatRate(bytesPerSecond) {
  return formatBytes(bytesPerSecond) + "/s"
}

function formatHandshakeAge(timestamp, nowSeconds) {
  if (!timestamp) return "Never"
  var seconds = Math.max(0, Math.floor(nowSeconds - timestamp))
  if (seconds < 60) return seconds + "s ago"
  if (seconds < 3600) return Math.floor(seconds / 60) + "m ago"
  if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago"
  return Math.floor(seconds / 86400) + "d ago"
}

// The config basename is the interface name wg-quick would bring up.
function wgInterfaceFor(confFile) {
  var base = String(confFile || "").replace(/\\/g, "/").split("/").pop()
  return base.replace(/\.conf$/i, "")
}

function wgSummary(profiles) {
  for (var i = 0; i < profiles.length; i++) {
    if (profiles[i].active) return profiles[i].name
  }
  return profiles.length === 0 ? "No profiles" : "Not connected"
}

function parsePingOutput(raw) {
  var text = String(raw || "").trim()
  var result = { latencyMs: -1, packetLoss: -1 }
  if (text === "") return result

  var lossMatch = text.match(/(\d+(?:\.\d+)?)%\s+packet\s+loss/i)
  if (lossMatch) {
    result.packetLoss = parseFloat(lossMatch[1])
  }

  var rttMatch = text.match(/(?:rtt|round-trip)\s+min\/avg\/max\/(?:mdev|stddev)\s*=\s*([0-9.]+)\/([0-9.]+)\/([0-9.]+)/i)
  if (rttMatch) {
    result.latencyMs = parseFloat(rttMatch[2])
  }
  return result
}

function formatLatency(pingInfo) {
  if (!pingInfo || pingInfo.latencyMs < 0) {
    if (pingInfo && pingInfo.packetLoss === 100) return "Unavailable"
    return "Measuring…"
  }
  return Math.round(pingInfo.latencyMs) + " ms"
}

function formatPacketLoss(pingInfo) {
  if (!pingInfo || pingInfo.packetLoss < 0) return "0%"
  return Math.round(pingInfo.packetLoss) + "%"
}

function wgDetails(profiles, healthByInterface, pingInfo) {
  var rows = []
  for (var i = 0; i < profiles.length; i++) {
    if (!profiles[i].active) continue
    var health = healthByInterface ? healthByInterface[wgInterfaceFor(profiles[i].confFile)] : null
    rows.push(detail("Profile", profiles[i].name))
    rows.push(detail("Interface", wgInterfaceFor(profiles[i].confFile)))
    if (pingInfo !== undefined && pingInfo !== null) {
      rows.push(detail("Latency", formatLatency(pingInfo)))
      rows.push(detail("Packet loss", formatPacketLoss(pingInfo)))
    }
    if (health) {
      if (health.endpoints.length > 0) rows.push(detail("Endpoint", health.endpoints.join(", ")))
      rows.push(detail("Receiving", formatRate(health.rxRate || 0)))
      rows.push(detail("Sending", formatRate(health.txRate || 0)))
      rows.push(detail("Downloaded", formatBytes(health.rxBytes)))
      rows.push(detail("Uploaded", formatBytes(health.txBytes)))
      if (health.lastHandshake > 0) {
        rows.push(detail("Last handshake", formatHandshakeAge(health.lastHandshake, Date.now() / 1000)))
      }
      rows.push(detail("Default route", health.defaultRoute ? "Yes" : "No — traffic may bypass the VPN"))
    }
  }
  if (rows.length > 0) rows.push(detail("Managed by", "wg-quick"))
  return rows
}

function wgTargets(profiles) {
  var targets = []
  for (var i = 0; i < profiles.length; i++) {
    var profile = profiles[i]
    targets.push({
      key: "profile:" + profile.name,
      label: profile.name,
      detail: profile.active ? "Connected" : "WireGuard profile",
      glyph: GLYPH_SHIELD,
      confFile: profile.confFile,
      active: profile.active
    })
  }
  return targets
}

function activeWgProfile(profiles) {
  for (var i = 0; i < profiles.length; i++) {
    if (profiles[i].active) return profiles[i]
  }
  return null
}
