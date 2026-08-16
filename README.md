# WireGuard VPN Plugin for Omarchy (`yeleticc.vpn`)

A modern, native WireGuard VPN widget and management panel for the **Omarchy Desktop Shell**.

![Omarchy Plugin](https://img.shields.io/badge/Omarchy-Quattro%20Plugin-blue?style=flat-square)
![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)
![Category: Network](https://img.shields.io/badge/Category-Network-orange?style=flat-square)

---

## Features

- **⚡ Fast Tunnel Switching**: Effortlessly connect, disconnect, and switch between WireGuard profiles (`*.conf`) located in `~/.config/omarchy/vpn/profiles/`.
- **🌐 Dynamic Public IP Display**: Real-time exit IP address detection in the header with one-click copy to clipboard (`wl-copy`). Automatically updates when switching profiles.
- **📊 2×2 Live Metric Cards**:
  - **Receiving Rate & Downloaded Total**: Real-time incoming throughput (`KiB/s`, `MiB/s`) and session totals.
  - **Sending Rate & Uploaded Total**: Real-time outgoing throughput and session totals.
  - **Live Latency & Loss Rate**: Polled round-trip ping time (`ms`) and packet loss percentage.
  - **Route & Tunnel Health**: Default route validation (`0.0.0.0/0`) and endpoint information.
- **🎨 Omarchy Theme Integration**: Seamlessly follows the active Omarchy theme colors, typography, and borders with zero hardcoded styling.
- **📂 Empty State Handling**: Prompts with an interactive `"Open Profiles Directory"` button when no configurations exist.
- **⌨️ Keyboard Accessible**: Full vim-style (`j`/`k`, `h`/`l`, `Enter`, `Esc`) navigation.
- **🤖 IPC CLI Control**: Integrated with `omarchy-shell` for scripted control and status inspection.

---

## Requirements

Ensure `wireguard-tools` and `curl` are installed on your system:

```bash
# Arch Linux / Omarchy
sudo pacman -S wireguard-tools curl
```

---

## Installation

### Via Omarchy Marketplace
1. Open the Omarchy Menu ➔ **Setup** ➔ **Plugins**.
2. Search for **VPN** (`yeleticc.vpn`) and click **Enable**.

### Manual Installation
Clone this repository directly into your Omarchy plugins directory:

```bash
git clone https://github.com/chaitanyayeleti/yeleticc.vpn.git ~/.config/omarchy/plugins/yeleticc.vpn
omarchy-shell shell rescanPlugins
```

Add `"yeleticc.vpn"` to your `~/.config/omarchy/shell.json` in the `bar.layout.right` section:

```json
{
  "id": "yeleticc.vpn"
}
```

---

## Profiles Setup

Place your WireGuard configuration files (`*.conf`) into:
```bash
~/.config/omarchy/vpn/profiles/
```

Example (`minipc_canada.conf`):
```ini
[Interface]
PrivateKey = <YourPrivateKey>
Address = 10.0.0.2/24
DNS = 1.1.1.1

[Peer]
PublicKey = <ServerPublicKey>
Endpoint = 195.242.214.130:51820
AllowedIPs = 0.0.0.0/0
```

---

## IPC Commands

You can interact with the plugin directly from the terminal or keybindings using `omarchy-shell`:

| Command | Action |
| :--- | :--- |
| `omarchy-shell yeleticc.vpn status` | Print current connection status |
| `omarchy-shell yeleticc.vpn ip` | Print current public IP |
| `omarchy-shell yeleticc.vpn toggle` | Toggle active connection |
| `omarchy-shell yeleticc.vpn connect <profile>` | Connect to a specific profile |
| `omarchy-shell yeleticc.vpn disconnect` | Disconnect active tunnel |
| `omarchy-shell yeleticc.vpn open` | Open the VPN panel |
| `omarchy-shell yeleticc.vpn refresh` | Force a refresh cycle |

---

## License

MIT License © 2026 [chaitanyayeleti](https://github.com/chaitanyayeleti)
