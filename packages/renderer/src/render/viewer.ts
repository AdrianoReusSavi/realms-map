import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface ViewerOptions {
  worldName: string;
  sourceName: string;
  widthBlocks: number;
  heightBlocks: number;
  minZoom: number;
  maxNativeZoom: number;
  zoomIn: number;
  tileSize: number;
  background: string;
  outputPath: string;
  githubUrl?: string;
  minBlockX: number;
  minBlockZ: number;
  regions: { regionX: number; regionZ: number; dataPath: string; palette: string[] }[];
}

export async function writeViewer(opts: ViewerOptions): Promise<void> {
  await mkdir(opts.outputPath, { recursive: true });
  
  const html = buildHtml(opts);
  
  await writeFile(join(opts.outputPath, "index.html"), html);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtml(opts: ViewerOptions): string {
  const world = escapeHtml(opts.worldName);
  const source = escapeHtml(opts.sourceName);
  const updated = new Date().toISOString();
  const bg = opts.background;
  const gh = opts.githubUrl
    ? `<a href="${escapeHtml(opts.githubUrl)}" target="_blank" rel="noopener">GitHub</a> · <a href="${escapeHtml(opts.githubUrl)}/blob/master/LICENSE" target="_blank" rel="noopener">License</a>`
    : "";
  const regionIndex = JSON.stringify(opts.regions).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${world} — Map</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
  html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: ${bg}; }
  #map { position: absolute; top: 0; left: 0; }
  .leaflet-tile { image-rendering: pixelated; }
  .bar { position: fixed; left: 0; right: 0; padding: 8px 16px; z-index: 1000;
         font: 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         background: rgba(0,0,0,0.8); pointer-events: none; }
  .bar a { color: #aaa; text-decoration: none; pointer-events: auto; }
  .bar a:hover { color: #ddd; }
  #header { top: 0; border-bottom: 1px solid #333; display: flex; justify-content: space-between; }
  #header .title { color: #e0e0e0; font-weight: 600; }
  #header .updated { color: #666; font-size: 11px; }
  #footer { bottom: 0; border-top: 1px solid #333; text-align: center; color: #555; }
  #block-info { display: none; position: fixed; z-index: 1100; padding: 7px 10px; border: 1px solid #454b50;
                border-radius: 5px; background: rgba(16,19,22,0.95); color: #eee; pointer-events: none;
                font: 12px ui-monospace, monospace; }
</style>
</head>
<body>
<div id="map"></div>
<div id="header" class="bar">
  <span class="title">${source} — ${world}</span>
  <span class="updated" data-updated="${updated}"></span>
</div>
<div id="footer" class="bar">${gh}</div>
<div id="block-info"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function () {
  var el = document.querySelector('.updated');
  var d = new Date(el.getAttribute('data-updated'));
  el.textContent = 'Updated ' + d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  var W = ${opts.widthBlocks}, H = ${opts.heightBlocks};
  var maxNativeZoom = ${opts.maxNativeZoom};
  var maxZoom = maxNativeZoom + ${opts.zoomIn};
  var tileSize = ${opts.tileSize};
  var minBlockX = ${opts.minBlockX}, minBlockZ = ${opts.minBlockZ};
  var regionData = new Map();
  ${regionIndex}.forEach(function (r) { regionData.set(r.regionX + ',' + r.regionZ, r); });
  var hoverToken = 0;
  var scale = Math.pow(2, maxNativeZoom);
  var bounds = [[0, 0], [H / scale, W / scale]];
  var map = L.map('map', {
    crs: L.CRS.Simple,
    minZoom: 0,
    maxZoom: maxZoom,
    zoomSnap: 0.25,
    zoomControl: false,
    attributionControl: false,
    fadeAnimation: false
  });
  map.fitBounds(bounds, { padding: [20, 20] });
  L.tileLayer('tiles/{z}/{x}/{y}.png', {
    tileSize: tileSize,
    minNativeZoom: 0,
    maxNativeZoom: maxNativeZoom,
    maxZoom: maxZoom,
    noWrap: true
  }).addTo(map);

  var info = document.getElementById('block-info');
  map.on('mousemove', async function (e) {
    var token = ++hoverToken;
    var ev = e.originalEvent;
    var x = Math.floor(minBlockX + e.latlng.lng * scale);
    var z = Math.floor(minBlockZ + H - e.latlng.lat * scale);
    var rx = Math.floor(x / 512), rz = Math.floor(z / 512);
    var region = regionData.get(rx + ',' + rz);
    if (!region) { info.style.display = 'none'; return; }
    info.style.display = 'block';
    info.style.left = (ev.clientX + 12) + 'px';
    info.style.top = (ev.clientY + 12) + 'px';
    info.textContent = 'Loading block…';
    try {
      if (!region.view) {
        var response = await fetch(region.dataPath);
        var stream = response.body.pipeThrough(new DecompressionStream('deflate'));
        region.view = new DataView(await new Response(stream).arrayBuffer());
      }
      if (token !== hoverToken) return;
      var localX = x - rx * 512, localZ = z - rz * 512;
      var offset = (localZ * 512 + localX) * 4;
      var paletteIndex = region.view.getUint16(offset, true);
      var y = region.view.getInt16(offset + 2, true);
      info.textContent = paletteIndex ? region.palette[paletteIndex - 1] + ' · Y ' + y : 'No surface block';
    } catch (_) {
      if (token === hoverToken) info.textContent = 'Block information unavailable';
    }
  });
  map.on('mouseout', function () { hoverToken++; info.style.display = 'none'; });
})();
</script>
</body>
</html>`;
}