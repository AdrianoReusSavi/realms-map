# Realms Map

An independent tool for rendering Minecraft Java worlds as interactive top-down maps. It can read a local save or download a backup from Minecraft Realms. It includes its own Anvil/NBT reader and renderer.

> **NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.**
>
> Realms Map is an independent open-source project maintained by [Adriano Reus Savi](https://github.com/AdrianoReusSavi). Minecraft and Minecraft Realms are referenced only to identify the game and service this tool works with. For project questions, contact the maintainer through [GitHub](https://github.com/AdrianoReusSavi).

![Example map](docs/map.png)

Minecraft is a trademark of Mojang Studios. All other product and service names are the property of their respective owners.

## Features

- Render local Minecraft Java saves without a Realm account.
- Download and render a Java Realm backup using Microsoft authentication.
- Generate a color-coded surface map with hill shading and a multi-zoom tile pyramid.
- Inspect the surface block, its properties, and its Y coordinate by hovering over the map.
- Deploy a Realm map to GitHub Pages on a weekly schedule or on demand.
- Read Anvil region and NBT data with project-owned TypeScript code.

The map shows the top block of each column at one pixel per block at its highest generated zoom. Zooming further preserves the pixel edges; it does not reveal block faces or texture-level detail.

## Requirements

- Node.js 22 or later
- npm
- For Realm rendering: a Microsoft account with access to a Minecraft Java Realm
- For GitHub Pages deployment: a GitHub repository fork and its Actions/Pages features enabled

## Install

```bash
git clone https://github.com/<your-username>/realms-map.git
cd realms-map
npm ci
```

Build the TypeScript packages:

```bash
npm run build
```

## Render a local world

Pass the path to a Minecraft Java save directory. It should contain `level.dat` and the dimension's `region` directory.

```powershell
npm run render -- "C:\Users\you\AppData\Roaming\.minecraft\saves\MyWorld" --open
```

The map is written to `./output` by default. `--open` opens its `index.html` after rendering. To enable block inspection reliably, serve the output over HTTP instead of opening the file directly:

```powershell
python -m http.server 8000 --directory output
```

Then open <http://localhost:8000> in a browser. The viewer loads Leaflet from unpkg, so an internet connection is required to load the map interface.

Options:

| Option | Description | Default |
| --- | --- | --- |
| `--output`, `-o <dir>` | Output directory | `./output` |
| `--dimension`, `-d <dim>` | `overworld`, `nether`, or `end` | `overworld` |
| `--zoom-in`, `-z <n>` | Extra viewer zoom levels beyond generated tiles | `4` |
| `--background`, `-b <#hex>` | Background color | `#000000` |
| `--open` | Open the generated `index.html` | off |
| `--help`, `-h` | Show command help | |

Examples:

```powershell
npm run render -- "C:\path\to\world" --dimension nether --output .\nether-map
npm run render -- "C:\path\to\world" -h
```

## Render a Minecraft Realm

### Authenticate and choose a Realm

Run the setup wizard:

```bash
npm run setup
```

Sign in at the Microsoft URL shown in the terminal and enter the device code. The wizard lists the Realms available to the account and prints `REALM_ID` and `AUTH_CACHE` values. It uses the first Realm's ID in its example; use the ID for the Realm you intend to render.

Keep `AUTH_CACHE` private: it contains authentication data. Do not commit it to the repository.

### Deploy with GitHub Actions

1. Fork the repository and install dependencies as above.
2. Add repository Actions secrets under **Settings → Secrets and variables → Actions**:
   - `REALM_ID`: the selected Realm ID.
   - `AUTH_CACHE`: the base64 value printed by the setup wizard.
3. Under **Settings → Pages**, set the source to **GitHub Actions**.
4. Run **Actions → Update Map → Run workflow**.

The workflow downloads the Realm backup, renders it into `output`, and deploys that directory to GitHub Pages. It also runs every Monday at 06:00 UTC. The published URL is shown in the workflow run summary.

### Run the Realm update locally

After setting up authentication, provide the Realm ID and auth cache path as environment variables. The default paths for backups and output are shown below:

```powershell
$env:REALM_ID = "your-realm-id"
$env:AUTH_CACHE_PATH = ".\auth-cache"
$env:BACKUP_PATH = ".\backups"
$env:OUTPUT_PATH = ".\output"
npm run update
```

## Project layout

```text
packages/
  core/       Anvil region, chunk, and NBT parsing
  renderer/   Block palette, top-down rendering, tiles, and map viewer
  local/      Local-world source and CLI
  realms/     Microsoft authentication, Realm backup, and update flow
```

Root commands:

| Command | Description |
| --- | --- |
| `npm run build` | Compile all TypeScript packages into `dist/` |
| `npm run render -- <world-path> [options]` | Render a local world |
| `npm run setup` | Authenticate and print Realm setup values |
| `npm run update` | Download and render the configured Realm |
| `npm test` | Run the Vitest suite |

## License

MIT. See [LICENSE](LICENSE).
