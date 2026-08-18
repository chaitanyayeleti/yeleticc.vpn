import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import "Model.js" as Model

// WireGuard backend: manages the plain *.conf WireGuard profiles in a profiles
// directory (default ~/.config/omarchy/vpn/profiles/) with wg-quick. The
// interface name is the config basename, and `wg show interfaces` — which needs
// no root — reports what is up, so status is pollable without elevation.
// Connecting runs through pkexec because wg-quick needs root, and there is no
// passwordless sudo here. Implements the backend contract documented in
// VpnController.qml.
Item {
  id: root
  visible: false

  property var settings: ({})
  property string filter: ""

  readonly property string backendId: "wireguard"
  readonly property string label: "WireGuard"
  readonly property string glyph: Model.GLYPH_SHIELD
  readonly property bool supportsFilter: false
  readonly property string filterPlaceholder: ""

  property var profiles: []
  property var healthByInterface: ({})
  property var _previousHealth: ({})
  property double _healthSampleTime: 0
  property var pingInfo: null
  property var geoInfo: null
  property string actionStatus: ""
  property string lastError: ""

  onConnectedChanged: {
    if (!connected) {
      pingInfo = null
      _previousHealth = ({})
      _healthSampleTime = 0
    } else {
      if (!pingProcess.running) pingProcess.running = true
    }
  }

  property bool _wgPresent: false
  property bool _probed: false
  // -1 follows reality, 0/1 overrides it while a command is in flight, so the
  // switch flips the instant it is clicked instead of waiting a poll cycle.
  property int _desired: -1
  property var _pendingTarget: null
  // "" when nothing is in flight, "handover" while the old tunnel is being
  // taken down, "final" while the picked one comes up. Declared beside the
  // other state so the connect/disconnect writes bind to this property instead
  // of creating an implicit global.
  property string _stage: ""

  readonly property bool _toolsPresent: _wgPresent
  readonly property bool detected: _toolsPresent

  readonly property string profilesDir: {
    var dir = String(root.setting("profilesDir", "~/.config/omarchy/vpn/profiles"))
    if (dir.indexOf("~/") === 0) dir = (Quickshell.env("HOME") || "") + dir.substring(1)
    return dir
  }

  readonly property bool _activeNow: Model.activeWgProfile(profiles) !== null
  readonly property bool connected: _desired === -1 ? _activeNow : (_desired === 1)
  readonly property bool _working: connectProcess.running || chainTimer.running || _desired !== -1
  readonly property bool busy: _working || listProcess.running || statusProcess.running
  readonly property string summary: Model.wgSummary(profiles)
  readonly property var details: Model.wgDetails(profiles, healthByInterface, pingInfo, geoInfo)
  readonly property var targets: Model.wgTargets(profiles)
  readonly property string emptyText: "No profiles yet. Drop a WireGuard *.conf in " + profilesDir
  readonly property string setupHint: !_toolsPresent
    ? "WireGuard tools (wg / wg-quick) are not installed."
    : (profiles.length === 0 ? emptyText : "")
  readonly property var activeProfile: Model.activeWgProfile(profiles)
  readonly property var activeHealth: activeProfile ? healthByInterface[Model.wgInterfaceFor(activeProfile.confFile)] : null
  readonly property real rxRate: activeHealth ? (activeHealth.rxRate || 0) : 0
  readonly property real txRate: activeHealth ? (activeHealth.txRate || 0) : 0
  readonly property real rxBytes: activeHealth ? (activeHealth.rxBytes || 0) : 0
  readonly property real txBytes: activeHealth ? (activeHealth.txBytes || 0) : 0
  readonly property string endpoint: activeHealth && activeHealth.endpoints && activeHealth.endpoints.length > 0 ? activeHealth.endpoints[0] : ""

  readonly property string currentKey: {
    var profile = activeProfile
    return profile ? "profile:" + profile.name : ""
  }
  readonly property string healthWarning: {
    var profile = activeProfile
    if (!profile) return ""
    var health = activeHealth
    return health && !health.defaultRoute
      ? "This profile has no default route; some traffic may bypass the VPN."
      : ""
  }

  function setting(name, fallback) {
    var value = settings ? settings[name] : undefined
    return value === undefined || value === null ? fallback : value
  }

  // Probing only. `detected` depends on the profile list, so the controller
  // keeps calling this on a machine that has wg-quick but no profiles — but the
  // discovery that would settle that belongs in refresh(), which the controller
  // skips for a hidden backend. Once probed this is a no-op.
  function detect(force) {
    if (wgProbe.running) return
    if (_probed && force !== true) return
    wgProbe.running = true
  }

  function _probeFinished() {
    root._probed = true
    if (root._toolsPresent) root.refresh()
  }

  function refresh() {
    if (!_toolsPresent || listProcess.running || statusProcess.running) return
    listProcess.running = true
  }

  function connectTo(target) {
    if (!detected || _working || !target || !target.confFile) return

    if (target.blocked || target.hasHooks) {
      root.lastError = "Blocked: Profile contains executable root hooks (PostUp/PreUp). Remove hooks to connect."
      root.actionStatus = "Blocked for security"
      actionStatusTimer.restart()
      return
    }

    _desired = 1
    _pendingTarget = target
    lastError = ""
    actionStatus = "Connecting to " + target.label + "…"

    // wg-quick will happily run two tunnels at once, and picking one profile
    // is never a request for both. The controller only enforces this between
    // backends, so the profiles inside this one take each other down: the
    // active tunnel first, then the one that was asked for.
    var active = Model.activeWgProfile(profiles)
    if (active && active.confFile !== target.confFile) {
      _stage = "handover"
      connectProcess.command = ["pkexec", "wg-quick", "down", active.confFile]
    } else {
      _stage = "final"
      connectProcess.command = ["pkexec", "wg-quick", "up", target.confFile]
    }
    connectProcess.running = true
  }

  function disconnect() {
    if (!detected || _working) return

    var active = Model.activeWgProfile(profiles)
    if (!active) return

    _desired = 0
    _stage = "final"
    lastError = ""
    actionStatus = "Disconnecting…"
    connectProcess.command = ["pkexec", "wg-quick", "down", active.confFile]
    connectProcess.running = true
  }

  function reconnect() {
    if (!detected || _working) return
    var active = Model.activeWgProfile(profiles)
    if (!active) return
    _desired = 1
    _pendingTarget = active
    _stage = "handover"
    lastError = ""
    actionStatus = "Reconnecting " + active.name + "…"
    connectProcess.command = ["pkexec", "wg-quick", "down", active.confFile]
    connectProcess.running = true
  }

  function toggleConnection() {
    if (connected) {
      disconnect()
      return
    }
    if (profiles.length === 1) {
      connectTo(targets[0])
    } else if (profiles.length === 0) {
      actionStatus = "No profiles. Drop a .conf in " + profilesDir
      actionStatusTimer.restart()
    } else {
      actionStatus = "Pick a profile below"
      actionStatusTimer.restart()
    }
  }

  function openProfilesFolder() {
    Quickshell.execDetached(["xdg-open", root.profilesDir])
  }

  function pickAndImport() {
    if (pickerProcess.running) return
    pickerProcess.running = true
  }

  Process {
    id: pickerProcess
    running: false
    command: [
      "bash", "-c",
      "picker=\"$HOME/.config/omarchy/plugins/yeleticc.vpn/scripts/pick-conf\"; " +
      "dest=" + Util.shellQuote(root.profilesDir) + "; " +
      "mkdir -m 0700 -p \"$dest\" 2>/dev/null; " +
      "picked=\"\"; " +
      "if [[ -x \"$picker\" ]]; then " +
      "  picked=$(\"$picker\" 2>/dev/null || true); " +
      "elif command -v zenity >/dev/null 2>&1; then " +
      "  picked=$(zenity --file-selection --file-filter='WireGuard Config (*.conf) | *.conf' --title='Select WireGuard Configuration' 2>/dev/null || true); " +
      "elif command -v kdialog >/dev/null 2>&1; then " +
      "  picked=$(kdialog --getopenfilename \"$HOME/Downloads\" \"*.conf|WireGuard Config (*.conf)\" 2>/dev/null || true); " +
      "fi; " +
      "[[ -z \"$picked\" ]] && exit 0; " +
      "[[ ! -r \"$picked\" ]] && { echo \"Cannot read file\" >&2; exit 1; }; " +
      "base=$(basename \"$picked\"); " +
      "[[ \"$base\" != *.conf ]] && { echo \"Must be a .conf file\" >&2; exit 1; }; " +
      "clean=$(echo \"$base\" | tr -cd 'a-zA-Z0-9_.-'); " +
      "[[ -z \"$clean\" ]] && clean=\"wg_imported.conf\"; " +
      "cp -f \"$picked\" \"$dest/$clean\"; " +
      "chmod 0600 \"$dest/$clean\"; " +
      "chmod 0700 \"$dest\"; " +
      "echo \"$clean\""
    ]
    stdout: StdioCollector { id: pickerStdout; waitForEnd: true }
    stderr: StdioCollector { id: pickerStderr; waitForEnd: true }
    onExited: function(exitCode) {
      if (exitCode !== 0) {
        root.lastError = Model.elide(String(pickerStderr.text || "") || "Failed to import profile", 140)
        return
      }
      var name = String(pickerStdout.text || "").trim()
      if (name !== "") {
        root.lastError = ""
        root.actionStatus = "Imported " + name
        actionStatusTimer.restart()
        root.refresh()
      }
    }
  }

  function removeProfile(target) {
    if (!target) return
    var name = typeof target === "object" ? (target.name || target.label) : String(target)
    if (!name) return

    if (root.activeProfile && (root.activeProfile.name === name || root.activeProfile.label === name)) {
      root.disconnect()
    }

    removeProcess.command = [
      "bash", "-c",
      "dest=" + Util.shellQuote(root.profilesDir) + "; " +
      "target=" + Util.shellQuote(name) + "; " +
      "f=\"$dest/${target}.conf\"; " +
      "if [[ -f \"$f\" ]]; then " +
      "  rm -f \"$f\"; " +
      "  echo \"$target\"; " +
      "else " +
      "  echo \"File not found\" >&2; exit 1; " +
      "fi"
    ]
    removeProcess.running = true
  }

  Process {
    id: removeProcess
    running: false
    stdout: StdioCollector { id: removeStdout; waitForEnd: true }
    stderr: StdioCollector { id: removeStderr; waitForEnd: true }
    onExited: function(exitCode) {
      if (exitCode !== 0) {
        root.lastError = Model.elide(String(removeStderr.text || "") || "Failed to remove profile", 140)
        return
      }
      var name = String(removeStdout.text || "").trim()
      if (name !== "") {
        root.lastError = ""
        root.actionStatus = "Removed " + name
        actionStatusTimer.restart()
        root.refresh()
      }
    }
  }

  // A config appearing mid-session (or being renamed) should show up, so the
  // list carries a raw conf path to the parser instead of a name the widget
  // invented. The active flag comes from `wg show interfaces`, matched on the
  // interface name wg-quick derives from the basename.
  function applyProfiles(entries) {
    var list = []
    for (var i = 0; i < entries.length; i++) {
      var item = entries[i]
      var confFile = typeof item === "string" ? item : item.path
      var hasHooks = typeof item === "object" ? item.hasHooks === true : false
      var name = Model.wgInterfaceFor(confFile)
      if (name === "") continue
      list.push({
        name: name,
        confFile: confFile,
        hasHooks: hasHooks,
        active: root.upInterfaces.indexOf(name) !== -1
      })
    }
    root.profiles = list
    if (_desired !== -1 && (Model.activeWgProfile(list) !== null) === (_desired === 1)) _desired = -1
  }

  Timer {
    id: actionStatusTimer
    interval: 2600
    repeat: false
    onTriggered: root.actionStatus = ""
  }

  Process {
    id: wgProbe
    command: ["omarchy-cmd-present", "wg"]
    running: true
    onExited: function(exitCode) {
      root._wgPresent = exitCode === 0
      root._probeFinished()
    }
  }

  // List *.conf profiles in the profiles directory and scan for dangerous root
  // execution hooks (PostUp/PreUp/PreDown/PostDown) before offering to connect.
  Process {
    id: listProcess
    running: false
    command: [
      "bash", "-c",
      "mkdir -m 0700 -p " + Util.shellQuote(root.profilesDir) + " 2>/dev/null; " +
      "chmod 0700 " + Util.shellQuote(root.profilesDir) + " 2>/dev/null; " +
      "for f in " + Util.shellQuote(root.profilesDir) + "/*.conf; do " +
      "  [[ -r \"$f\" ]] || continue; " +
      "  h=\"safe\"; " +
      "  if grep -Eiq '^[[:space:]]*(preup|postup|predown|postdown)[[:space:]]*=' \"$f\" 2>/dev/null; then " +
      "    h=\"has_hooks\"; " +
      "  elif (($? != 1)); then " +
      "    h=\"has_hooks\"; " +
      "  fi; " +
      "  printf \"%s\\t%s\\n\" \"$f\" \"$h\"; " +
      "done || true"
    ]
    stdout: StdioCollector { id: listStdout; waitForEnd: true }
    stderr: StdioCollector { id: listStderr; waitForEnd: true }
    onExited: function(exitCode) {
      if (exitCode !== 0) {
        root.lastError = Model.elide(String(listStderr.text || "") || "Could not list WireGuard profiles", 140)
        return
      }
      root.lastError = ""
      var entries = Model.parseProfileListing(String(listStdout.text || ""))
      root._pendingFiles = entries
      statusProcess.running = true
    }
  }

  // `wg show interfaces` needs no root and reports the up interfaces by name.
  // Status lags a beat after wg-quick returns, so the settle timer re-asks a
  // few times before letting _desired lapse.
  Process {
    id: statusProcess
    running: false
    command: ["wg", "show", "interfaces"]
    stdout: StdioCollector { id: statusStdout; waitForEnd: true }
    stderr: StdioCollector { id: statusStderr; waitForEnd: true }
    onExited: function(exitCode) {
      root.upInterfaces = exitCode === 0
        ? Model.parseWgInterfaces(String(statusStdout.text || ""))
        : []
      root.applyProfiles(root._pendingFiles || [])
      root._pendingFiles = null
      if (!healthProcess.running) healthProcess.running = true
    }
  }

  property var _pendingFiles: null
  property var upInterfaces: []

  Process {
    id: healthProcess
    running: false
    command: [
      "bash", "-c",
      "for iface in $(wg show interfaces 2>/dev/null); do " +
      "[[ \"$iface\" =~ ^[a-zA-Z0-9_.-]+$ ]] || continue; " +
      "rx=0; tx=0; ep=\"\"; allowed=\"\"; " +
      "[[ -r \"/sys/class/net/$iface/statistics/rx_bytes\" ]] && read -r rx < \"/sys/class/net/$iface/statistics/rx_bytes\"; " +
      "[[ -r \"/sys/class/net/$iface/statistics/tx_bytes\" ]] && read -r tx < \"/sys/class/net/$iface/statistics/tx_bytes\"; " +
      "conf=" + Util.shellQuote(root.profilesDir) + "/\"${iface}.conf\"; " +
      "if [[ -r \"$conf\" ]]; then " +
      "  while IFS=\"=\" read -r rawk rawv || [[ -n \"$rawk\" ]]; do " +
      "    k=\"${rawk//[[:space:]]/}\"; v=\"${rawv//[[:space:]]/}\"; " +
      "    case \"${k,,}\" in " +
      "      endpoint) ep=\"$v\" ;; " +
      "      allowedips) allowed=\"$v\" ;; " +
      "    esac; " +
      "  done < \"$conf\"; " +
      "fi; " +
      "printf \"%s\\t%s\\t%s\\t%s\\t%s\\n\" \"$iface\" \"$rx\" \"$tx\" \"$ep\" \"$allowed\"; " +
      "done"
    ]
    stdout: StdioCollector { id: healthStdout; waitForEnd: true }
    onExited: function(exitCode) {
      if (exitCode !== 0) return
      var now = Date.now()
      var next = Model.parseSysfsStats(String(healthStdout.text || ""))
      var previous = root._previousHealth
      var elapsed = root._healthSampleTime > 0 ? Math.max(0.001, (now - root._healthSampleTime) / 1000) : 0
      for (var iface in next) {
        var prior = previous[iface]
        if (prior && elapsed > 0) {
          next[iface].rxRate = Math.max(0, next[iface].rxBytes - prior.rxBytes) / elapsed
          next[iface].txRate = Math.max(0, next[iface].txBytes - prior.txBytes) / elapsed
        }
      }
      root.healthByInterface = next
      root._previousHealth = next
      root._healthSampleTime = now

      if (root.connected && !pingProcess.running) {
        pingProcess.running = true
      }
    }
  }

  Process {
    id: pingProcess
    running: false
    command: ["ping", "-c", "2", "-W", "1", "1.1.1.1"]
    stdout: StdioCollector { id: pingStdout; waitForEnd: true }
    stderr: StdioCollector { id: pingStderr; waitForEnd: true }
    onExited: function(exitCode) {
      if (root.connected) {
        root.pingInfo = Model.parsePingOutput(String(pingStdout.text || ""))
      } else {
        root.pingInfo = null
      }
    }
  }

  Process {
    id: connectProcess
    running: false
    command: []
    stdout: StdioCollector { id: connectStdout; waitForEnd: true }
    stderr: StdioCollector { id: connectStderr; waitForEnd: true }
    onExited: function(exitCode) {
      var output = String(connectStderr.text || "") + "\n" + String(connectStdout.text || "")

      // The old tunnel is down (or refused to come down, which is not a reason
      // to swallow the connect the user asked for). Either way, bring up the
      // one they picked.
      if (root._stage === "handover") {
        root._stage = ""
        chainTimer.restart()
        return
      }

      root._stage = ""
      if (exitCode !== 0) {
        root._desired = -1
        root.lastError = Model.elide(output, 140)
      } else {
        root.lastError = ""
      }
      root._pendingTarget = null
      root.actionStatus = ""
      settleTimer.ticks = 0
      settleTimer.restart()
      root.refresh()
    }
  }

  // Starting the second command from inside onExited would re-enter the process
  // that is still finishing, so the handover hops through the event loop first.
  Timer {
    id: chainTimer
    interval: 0
    repeat: false
    onTriggered: {
      var target = root._pendingTarget
      if (!target) {
        root._stage = ""
        return
      }
      root._stage = "final"
      connectProcess.command = ["pkexec", "wg-quick", "up", target.confFile]
      connectProcess.running = true
    }
  }

  Timer {
    id: settleTimer
    property int ticks: 0
    interval: 1500
    repeat: true
    running: false
    onTriggered: {
      settleTimer.ticks += 1
      root.refresh()
      if (settleTimer.ticks >= 4) {
        settleTimer.ticks = 0
        settleTimer.running = false
        root._desired = -1
      }
    }
  }
}
