# SVR Campings PWA - Project Context

## Project Overview

**SVR Campings** is a Progressive Web Application (PWA) that helps users find SVR (Stichting Vrije Recreatie) campings in the Netherlands and surrounding regions. The app provides map-based and list-based views of campings, with filtering capabilities by country and facilities.

### Key Features
- **Map View**: Interactive Leaflet.js map with clustering for camping locations
- **List View**: Scrollable list of camping cards with details
- **Search**: Location-based search using Dutch municipality data (`Woonplaatsen_in_Nederland.csv`)
- **Filters**: Filter campings by country and facilities (e.g., WiFi, pets allowed, etc.)
- **Offline Support**: Service Worker caches app shell, static assets, and map tiles
- **PWA Install**: Custom install banner with beforeinstallprompt handling
- **Responsive Design**: Mobile-first with desktop split-screen layout (v0.2.35+)

### Architecture
- **Type**: Static PWA (no build step, vanilla JavaScript)
- **Frontend**: HTML5, CSS3, Vanilla JavaScript (with jQuery dependency)
- **Map Engine**: Leaflet.js 1.9.4 with MarkerCluster plugin
- **Data Source**: Pre-fetched camping data from SVR API (stored in `data/campings.json`)
- **Proxy**: Cloudflare Worker (`svr-proxy-worker.e60-manuels.workers.dev`) for API access

---

## Directory Structure

```
SVRpwa/
├── index.html              # Main app entry point
├── manifest.json           # PWA manifest (icons, theme colors, start URL)
├── sw.js                   # Service Worker (offline caching strategy)
├── offline.html            # Offline fallback page
├── build-campings-json.js  # Node.js script to fetch/update camping data
├── migration_inventory.md  # Migration notes from Android app to PWA
│
├── css/
│   ├── local_style.css     # Main app styles (744 lines)
│   ├── custom_styles.css   # Additional style overrides (336 lines)
│   ├── MarkerCluster.css   # Leaflet clustering styles
│   └── MarkerCluster.Default.css
│
├── js/
│   ├── local_app.js        # Main application logic (2043 lines)
│   ├── pwa_install.js      # PWA install banner logic (284 lines)
│   └── leaflet.markercluster.js  # Leaflet clustering plugin
│
├── data/
│   └── campings.json       # Static camping data (40k+ lines, ~13k campings)
│
├── assets/
│   └── Woonplaatsen_in_Nederland.csv  # Dutch municipality data for search
│
├── icons/
│   ├── icon-192.webp       # PWA icon (192x192)
│   └── icon-512.png        # PWA icon (512x512)
│
├── fonts/
│   └── befalow.ttf         # Custom font for headers
│
└── bestanden/              # Documentation folder
    ├── modernization_plan.md       # Code modernization recommendations
    ├── lighthouse_findings.md      # Performance audit results
    ├── filter_chips_pwa_spec.md    # Filter UI specification
    ├── local_app_map.md            # Code structure documentation
    ├── ontwerp-v0.2.29.txt         # Design doc for v0.2.29 cleanup
    ├── static-content-delivery-implementation-plan.md
    └── gemini-svr-static-delivery.md
```

---

## Building and Running

### Development Setup

1. **Serve the project locally** (any static file server):
   ```bash
   # Using Python
   python -m http.server 8000

   # Using Node.js
   npx serve .

   # Using PHP
   php -S localhost:8000
   ```

2. **Access the app**: Open `http://localhost:8000` in a browser

3. **PWA Testing**: Use Chrome DevTools > Application tab to test Service Worker and manifest

### Data Updates

To refresh the camping data from the SVR API:

```bash
# Requires environment variables
export SVR_EMAIL=your@email.com
export SVR_PASSWORD=your_password

# Run the build script
node build-campings-json.js
```

This script:
- Logs into the SVR proxy worker
- Fetches all available filters and categories
- Retrieves all camping locations
- Maps facility filters to each camping
- Outputs to `data/campings.json`

---

## Technical Details

### Service Worker Strategy (`sw.js`)

| Resource Type | Strategy | Cache Name |
|--------------|----------|------------|
| App Shell (HTML, CSS, JS) | Network First | `svr-pwa-cache-v0.2.84` |
| Map Tiles (OSM) | Cache First | `svr-pwa-map-tiles` |
| API Requests | Network Only | Not cached |
| External Libraries | Network First | `svr-pwa-cache-v0.2.84` |

### Key Dependencies

| Library | Version | Purpose |
|---------|---------|---------|
| Leaflet.js | 1.9.4 | Map rendering |
| Leaflet.markercluster | 1.4.1 | Marker clustering |
| jQuery | 3.6.0 | DOM manipulation (being phased out) |
| Font Awesome | 6.4.2 | Icons |
| Swiper.js | Latest | Carousel/slider (if used) |

### State Management

- **Cookies**: Store filter selections, search config, view mode
- **localStorage**: PWA install state, banner dismissal
- **In-memory**: `window.staticCampsites`, `window.filterCategories`

### Version Tracking

- **App Version**: Tracked in `window.SVR_PWA_VERSION` (currently `0.2.89`)
- **Cache Version**: Embedded in Service Worker cache name (`v0.2.89`)
- **Data Version**: `data/campings.json` includes `updated` timestamp and `version` field

---

## Development Conventions

### Coding Style
- **JavaScript**: ES6+ with IIFE pattern for encapsulation
- **CSS**: CSS custom properties (variables) for theming
- **Naming**: Dutch language for UI text, English for code identifiers

### Known Issues & Technical Debt

1. **jQuery Dependency**: Heavy reliance on jQuery in `local_app.js` (47× `$(...)`, 11× `.on(`) - modernization plan exists in `bestanden/modernization_plan.md`. Plan reviewed against codebase in v0.2.59: item 4 (DOM/marker batching) is done, items 1 and 6 were already obsolete, items 2/3/5 (event listeners, `applyState` show/hide, native smooth scroll) are still open and pending joint prioritization with the maintaining developers.
2. **Performance**: Lighthouse score of 48 (LCP: 15.1s, TBT: 1060ms) - see `bestanden/lighthouse_findings.md`
3. **Main Thread Blocking**: Large data file (40k+ lines) parsed synchronously
4. **Memory**: All camping data loaded into memory at once

### Completed Modernizations

✅ **v0.2.30**: Single Source of Truth - `data/campings.json` as only data source
✅ **v0.2.30**: Removed `campsites_preset.json` and `svr_cache_campsites` localStorage
✅ **v0.2.31**: Desktop responsive breakpoints (768px, 1024px, 1440px, 1920px)
✅ **v0.2.35**: Split-screen desktop layout (50/50 list left, map right)
✅ **v0.2.36**: Contextual detail panel (opens on opposite side of click source)

### Key Achievements **v0.2.37**:

   * Desktop Layout v0.2.37 Completed:
       * Implemented a 60/40 split-screen desktop layout (60% map on the left, 40% for list/detail/filter on the right).
       * Achieved perfect alignment with no gaps or overlaps between the header and content containers.

   * Filter Panel Stability & UX:
       * Resolved issues with filter overlay positioning, scrolling behavior, and header sticking.
       * Implemented a desktop-specific close button for the filter panel.
       * Improved scrollability within the filter content area with sticky category headers.

   * Map-List Synchronization:
       * Implemented linking the "INFO" button click in the list view to synchronizing the map on desktop. Clicking
         "INFO" now centers the map on the corresponding camping marker, opens its popup, and crucially, maintains the
         current zoom level.

   * Versioning:
       * Updated app and cache versions to v0.2.37 across relevant files (local_app.js, sw.js, index.html).

### Key Achievements **v0.2.38**:

   * Desktop Header Redesign:
       * Added SVR logo to the left side of the header (desktop only).
       * Search bar centered over the 40% right panel (list/detail side) on desktop.
       * Search bar fixed at 350x36px for a more professional appearance.
       * Logo positioned with 16px top margin for visual alignment.

   * Map Zoom Controls:
       * Added zoom in/out buttons to the map (desktop only, ≥768px).
       * Positioned at bottom-right corner.
       * Button size: 28x28px (compact design).
       * Mobile users continue using two-finger pinch-to-zoom.

   * Marker Popup Fix:
       * Fixed popup not opening for campings beyond the first 10 in the list.
       * Root cause: markers split between `markerCluster` and `top10Layer` were not handled consistently.
       * Solution: `focusOnMarker()` now tracks which layer each marker belongs to and handles both correctly.
       * Popup timing improved with proper animation wait.

   * Detail Page Stacking Fix:
       * Prevented multiple detail pages from stacking when clicking INFO on multiple campings.
       * Uses `history.replaceState()` instead of `pushState()` when a detail page is already open.
       * Mobile unaffected (scenario cannot occur due to fullscreen overlay).

   * UX Improvements:
       * Default zoom level increased from 14 to 16 for better focus on camping location.
       * Desktop toggle button repurposed as scroll-to-top (appears when scrolling list).

   * Versioning:
       * Updated app and cache versions to v0.2.38 across all files.
       * Service Worker cache invalidated for fresh deployment.

### Key Achievements **v0.2.39**:

   * Desktop Filter Chips Alignment:
       * Moved active-filter-chips from far left to far right side of header (desktop only, ≥768px).
       * Replaced conflicting `flex-direction: row-reverse` with clean `justify-content: flex-end`.
       * Removed JS-injected `padding-right` override to let CSS stylesheet control layout.
       * Aligned chips to right edge of search container for consistent visual alignment.
       * Mobile UI/UX remains completely unchanged.

   * Versioning:
       * Updated app and cache versions to v0.2.39 across all files (local_app.js, sw.js, index.html, local_style.css).
       * Service Worker cache invalidated for fresh deployment.

### Key Achievements **v0.2.40**:

   * Header Border:
       * Added `border-bottom: 3px solid rgb(1, 139, 211)` to `.svr-header` in `local_style.css`.

   * Locate Button Desktop Fix:
       * Added `z-index: 2001` and `position: relative` to `.map-stack-btn` in desktop CSS.
       * Ensures locate button is clickable above list-container stacking context.

   * Search Suggestions Desktop:
       * Repositioned `.suggestions-list` to appear directly below search container on desktop.
       * Set `z-index: 1001` on `.svr-header` so suggestions dropdown appears above list view.

   * Help Overlay Desktop Repositioning:
       * Re-aligned all help tooltips to match desktop split-screen layout.
       * Search help: positioned below header, centered over 40% right panel.
       * Info help: aligned to far right, dynamically adjusts with viewport.
       * Action button stack (SVR website, Locate, Filter): repositioned to match desktop button locations.
       * Toggle help: hidden (toggle is scroll-to-top on desktop).

   * Versioning:
       * Updated app and cache versions to v0.2.40 across all files.
       * Service Worker cache invalidated for fresh deployment.

### Key Achievements **v0.2.43**:

   * Navigation Communication (postMessage):
       * Implemented `window.parent.postMessage` calls for Detail and Filter panel states.
       * Added state synchronization for "open" and "close" events to support integration with parent apps (e.g., hiding tab bars).
       * Robust handling for desktop (panel switches, closeRightPanel) and mobile (popstate, applyState).
       * Verified `window.parent !== window` check for security and stability.

   * Versioning:
       * Updated app and cache versions to v0.2.43 across all files.
       * Manual cache busting for assets in `index.html`.

### Key Achievements **v0.2.49**:

   * Search Dropdown Overlap Fix:
       * Resolved a critical UI issue where the search suggestions dropdown-list was being rendered behind/under the active filters bar (`.filters-nav-container`).
       * Added `position: relative` and `z-index: 10` to `.search-container` globally, and `z-index: 2010 !important` on desktop layout, to ensure suggestions list is always stacked on top.
       * Prevents overlapping filter chips from blocking click/tap selection on longer suggestion lists.

   * Versioning:
       * Updated all version indicators to v0.2.49 across code, HTML, Service Worker, and data structures.
       * Service Worker cache invalidated to ensure clean rollout of CSS layout updates.

### Key Achievements **v0.2.48**:

   * Versioning:
       * Updated app version to v0.2.48.

### Key Achievements **v0.2.47**:

   * Data Healing & Enrichment:
       * Identified and resolved a critical discrepancy where SVR API IDs differed from SVR Website CMS IDs for 67 campsites, causing 500 errors.
       * Implemented `heal-campings-json.js` to map and correct these IDs, ensuring detail pages load correctly.
       * `data/campings_enriched.json` now serves as the single "UI-ready" source of truth, combining raw API data with scraped enrichment details (images, svr_id) for optimal performance.

   * Cloudflare Worker Modernization:
       * Implemented a robust 3-step login flow to simulate authentic browser sessions, including initial cookie capture and PHPSESSID synchronization.
       * Added mandatory browser navigation headers (`sec-fetch-*`, etc.) to `/object/` requests to bypass WAF/security filtering.
       * Standardized all internal domains to non-www `https://svr.nl` to prevent 301 redirect overhead and session loss.

   * PWA Performance & Stability:
       * Implemented version-based cache busting for `data/campings.json` (`?v=0.2.47`) to force data refreshes without disabling browser caching.
       * Resolved CORS header mismatches for custom headers (`X-SVR-PHPSESSID`) to fix detail page loading.

   * Versioning:
       * Updated all version indicators to v0.2.47.
       * Service Worker cache invalidated to ensure clean rollout.

---

## Data Enrichment Strategy

### `data/campings_enriched.json`
This file is the final, UI-ready dataset used by the PWA. It acts as a cache of scraped enrichment data (such as image URLs, descriptions, and the verified `svr_id` needed for stable detail page access). By keeping this file maintained, the PWA avoids real-time scraping, ensuring the UI remains fast and responsive while providing full camping details.

### Key Achievements **v0.2.45**:

   * Sticky Filter Headers:
       * Implemented `position: sticky` with dynamic CSS variable tracking for filter section headers.
       * Headers now respond dynamically to the variable height of the active filters bar, preventing overlaps.
       * Applied consistent styling across mobile and desktop for better UX.

   * Help Overlay Refinement:
       * Fine-tuned help overlay positions based on user feedback (Filter: 120px, Locate: 170px, SVR Website: 220px).
       * Updated Toggle positioning to 70px for consistent alignment.

   * Versioning:
       * Updated app and cache versions to v0.2.45 across all files.
       * Service Worker cache invalidated for fresh deployment.

### Key Achievements **v0.2.44**:

   * Map Action Stack Optimization:
       * Decreased the `gap` between map-action-btn buttons from 12px to 6px for a more compact design.
       * Adjusted `bottom` position of `.map-actions-stack` to 60px to ensure the buttons are fully visible and properly spaced from the bottom edge.

   * Versioning:
       * Updated app and cache versions to v0.2.44 across all files.
       * Service Worker cache invalidated for fresh deployment.

### Key Achievements **v0.2.89**:

   * Geïnstalleerde PWA op tablets (desktop 2-pane liggend) én oude tablets in portrait:
       * Oorzaak 1 — `manifest.json` had `"orientation": "portrait"`: browsers passen dat niet toe in een browsertab, maar Android/Chrome WEL bij een geïnstalleerde (standalone) PWA → de app kon nooit landscape worden → desktop 2-pane verscheen niet op een geïnstalleerde tablet, ook niet liggend (via URL in Chrome werkte het wél).
       * Fix 1: `"orientation": "portrait"` verwijderd uit `manifest.json`. Geïnstalleerde tablet draait nu vrij mee → liggend = desktop 2-pane view. Telefoons behouden de portrait-UX via het bestaande `#portrait-lock`-overlay (`@media (orientation: landscape) and (max-width: 900px)`).
       * Oorzaak 2 — CSS-breakpoint-kloof 768–1023px: de v0.2.88-mobiele overlay-styles gelden tot `max-width: 767px`, desktop pas vanaf `min-width: 1024px` én landscape. Een 1280×800-tablet (bv. oude Samsung Galaxy Tab A) heeft in portrait ~800px CSS-breedte → géén van beide media-queries matcht → de JS-aangemaakte `#svr-filter-overlay` kreeg géén styling/verberg-transform en toonde de filter-headers ("Zoek op land", "Populaire faciliteiten") over de kaart op het home-screen. (Geen PWA-compatibiliteitsprobleem van Android 8.1: dat ondersteunt PWA's gewoon.)
       * Fix 2: mobiele media-query in de inline overlay-CSS van `js/local_app.js` verruimd naar `@media (max-width: 1023px), (orientation: portrait)` — alle niet-desktop viewports (768–1023px én rechtop ≥1024px) krijgen nu de mobiele fullscreen-view, geen unstyled gat meer.

   * Versioning:
       * App en cache naar v0.2.89 gebumpt (local_app.js, pwa_install.js, index.html, sw.js, version.json, merge-and-enrich.js).

### Key Achievements **v0.2.88**:

   * Tablet Two-View (mobiel rechtop, desktop liggend):
       * Kantelpunt verlegd van breedte-only (`min-width: 768px`) naar **liggend én ≥1024px** (`isDesktopView()` in `js/local_app.js` + `@media (min-width: 1024px) and (orientation: landscape)` via alle desktop-blocks in `css/local_style.css` en de inline overlay-CSS).
       * Doel: een 10"-tablet toont rechtop (portrait) de mobiele fullscreen-view en liggend (landscape) de desktop 2-pane-view (kaart links, lijst rechts). Brede telefoons in landscape (max ~950px CSS) blijven de mobiele view houden.
       * Alle ~22 JS-breakpointchecks (`window.innerWidth >= 768`) vervangen door de centrale helper; toelichting + randgeval onderaan de changelog.
       * Dynamisch wisselen bij draaien: `resize` + `orientationchange` handler (`applyViewportMode()`) schakelt layout om, ruimt panelen/geschiedenis op en laat `map.invalidateSize()` lopen.
       * Randgeval: exacte inch-detectie is in CSS/JS niet mogelijk; 1024px is de praktische scheiding tussen 10"-tablets (liggend ≥1024px) en brede telefoons (≤~950px). Sub-10"-tablets-met-brede-landscape (bv. iPad-mini) kunnen hierdoor tóch desktop-view krijgen.

### Key Achievements **v0.2.84**:

   * Robuuste release-update óók voor installaties met een verouderde Service Worker:
       * Symptoom: na deploys bleef de geïnstalleerde PWA soms (lang) op een oude versie hangen, óók ná de v0.2.63 SW-rolout-fix — pas na site-data/cookies wissen kwam de nieuwe versie door.
       * Oorzaak: de SW-updatecheck rust op byte-vergelijking van `sw.js`. GitHub Pages/Fastly cachet `sw.js` tot 10 minuten (`max-age=600`); landt de check in dat venster, dan retourneert de CDN-edge de byte-identieke oude `sw.js` → geen update gedetecteerd (dezelfde staleness als bij v0.2.63, maar nu via een late edge-refresh i.p.v. `updateViaCache`).
       * Fix (versiepobe): bij opstart wordt `version.json` gecheryst met unieke querystring (`?t=Date.now()`, `cache:'no-store'` → altijd CDN-miss). Bij mismatch met `window.SVR_PWA_VERSION` → toast "Nieuwe versie beschikbaar" en éénmalige automatische reload per sessie (guard via `sessionStorage`). Onafhankelijk van SW-update-timing en de CDN-edge.
       * `version.json` staat bewust NIET in de SW-precache (nooit stale); `update-version.js` bumped hem voortaan automatisch mee.
       * Veldtest: beide PWAs kwamen na een deploy binnen één opstart op de nieuwe versie, zonder cookies te wissen — ook met een oude actieve SW.

### Key Achievements **v0.2.64**:

   * Dummy release test (na de v0.2.63 SW-rolout-fix):
       * Doel: verifiëren dat een nieuwe versie nu direct doorkomt — zonder de 10-minutenwachttijd (max-age=600) — door alleen een versiebump te publiceren.
       * Verwacht resultaat: na volledig sluiten/ heropenen van de geïnstalleerde PWA staat het infoscherm meteen op v0.2.64.

### Key Achievements **v0.2.63**:

   * Service Worker-update blijft (te) lang uit op productie — oude versie bleef terugkomen:
       * Symptoom: na deploys bleef productie op v0.2.60 hangen; pas na cookies/site-data wissen kwam de nieuwe versie door.
       * Oorzaak: GitHub Pages/Fastly serveert `sw.js` en `index.html` met `Cache-Control: max-age=600`, en de registratie gebruikte `{ updateViaCache: 'all' }`. Browsers moesten bij een SW-updatecheck de gecachte (oude) `sw.js` zónder hervalidatie gebruiken → de oude SW bleef actief, oude caches bleven staan en serveerden cache-first de oude assets.
       * Fix (SW-rolout-mechanisme):
           * `index.html`: registratie met `updateViaCache: 'none'` zodat updatechecks `sw.js` altijd opnieuw ophalen, registratie direct bij laden, en een `controllerchange`-listener die éénmalig herlaadt zodra een nieuwe SW (`skipWaiting` + `clients.claim`) de controle overneemt.
           * `sw.js`: de network-first fetch van `index.html` gebruikt `{ cache: 'no-cache' }`, zodat de HTML altijd hervalideert i.p.v. de tot-10-minuten-oude gecachte HTML te serveren.
       * Geen backdoor: gebruikers met een oude SW pakken de fix bij hun eerstvolgende bezoek op; daarna is een update binnen één extra reload actief.

### Key Achievements **v0.2.62**:

   * Geen Underline op Campingnaam-Link:
       * Na testen bleek de hover-underline (`text-decoration: underline` op `.camping-name-link:hover`) ongewenst: bij klikken flitst de naam kort als link onderstreept, en bij sluiten van de detailpagina blijft de streep staan zolang de pointer boven de tile hangt.
       * Fix: hover-underline-regel verwijderd. Alleen `cursor: pointer` op `.camping-name-link` resteert; geen onderstreping zichtbaar bij hover of na sluiten van de detailpagina.

### Key Achievements **v0.2.61**:

   * Klikbare Campingnaam in Lijstweergave:
       * De campingnaam (`<h3>`) bovenaan elke tile in de lijstweergave is nu ook klikbaar en opent dezelfde detailpagina als de INFO-knop.
       * Gebruikt dezelfde aanroep (`window.showSVRDetailPage(id, 'list')`) en hetzelfde patroon als de bestaande naam-link op map-popups.
       * CSS: `.camping-name-link` met `cursor: pointer` en underline-on-hover zodat het klikbare karakter zichtbaar is.

### Key Achievements **v0.2.60**:

   * Filter-paneel Heropent Onterecht na Detailpagina (Navigatie-bug):
       * Root cause: de X-sluitknop in de filteroverlay riep `window.hideFilterOverlay()` aan (alleen visueel verbergen), niet `window.closeFilterOverlay()` (dat ook de `{view:'filters'}` history-entry opruimt via `history.back()`) zoals de "Toepassen"- en "Wis filters"-knoppen wel deden.
       * Reproductie: filter openen → sluiten via X zonder optie te kiezen → detailpagina openen → detailpagina sluiten. De history-stack bleef `[kaart, filters, detail]` i.p.v. de 'filters'-entry netjes te poppen, waardoor `history.back()` bij het sluiten van de detailpagina op de filter-state landde en het paneel opnieuw opende.
       * Fix: X-knop roept nu ook `window.closeFilterOverlay()` aan.
       * Nader onderzocht (v0.2.60, bevestigd op een onafhankelijke kopie van de app): de sluit-check in `toggle_filters()` op de desktop-route (`filterEl.style.display === 'block'`) is dode code — `openRightPanel('filter')` zet het paneel altijd op `display: 'flex'`, dus die branch matcht nooit. Alle overige aanroepen van `closeRightPanel()`/`hideFilterOverlay()` zijn reactieve opruim-calls ná een reeds veranderde history-state, niet zelf een sluit-trigger. Geen verder risico gevonden; geen actie nodig.

### Key Achievements **v0.2.57 - v0.2.59** (voorbereiding bestuurs-/developersmeeting):

   * Offline Cache-Key Mismatch Fix (v0.2.57):
       * Root cause gevonden: lokale assets (`css/local_style.css`, `css/custom_styles.css`, `js/local_app.js`, `js/pwa_install.js`, `data/campings.json`) worden runtime opgevraagd met een cache-busting querystring (`?v=X.X.X`), maar door `sw.js` precachet zonder querystring — een cache-key-mismatch die offline tot een onopgemaakte, kapotte app-shell leidde.
       * Fix: `caches.match(event.request, { ignoreSearch: true })` in de generieke cache-first strategie, zodat versie-URL's altijd de precachete versie vinden.
       * Bevestigd met een live offline-test op Android/Chrome (geïnstalleerde PWA, volledig gesloten en heropend).

   * Duidelijke Offline-Foutmeldingen (v0.2.58):
       * Zoeken, filterpaneel en detailpagina hangen alle drie af van een live netwerkaanroep (Nominatim-geocoding resp. de SVR-proxy) die `fetchWithRetry()` bij een netwerkfout stil opving en als lege string teruggaf — dit leidde tot misleidende meldingen ("Plaats niet gevonden", "Geen filters beschikbaar", "SVR response invalid or empty") in plaats van een herkenbare offline-melding.
       * Alle drie tonen nu een duidelijke "geen internetverbinding"-melding wanneer `navigator.onLine` false is. Functioneel blijven deze onderdelen offline niet beschikbaar (bewuste architectuurkeuze, live data), alleen de foutmelding is verbeterd.

   * Marker- en DOM-rendering performance (v0.2.59):
       * `renderResults` bouwde voorheen per camping-kaart een losse jQuery `.append()`-call op en voegde kaartmarkers één voor één toe via `markerCluster.addLayer()` — beide raken de bekende performance-bevinding (Lighthouse-score 48, TBT 1060ms).
       * Nu: alle camping-kaarten worden als array opgebouwd en in één `insertAdjacentHTML`-call ingevoegd; cluster-markers (buiten de top 10) worden gebatcht via `markerCluster.addLayers()`. `top10Layer` (max. 10 items, `L.featureGroup()`) is ongewijzigd — geen batch-API beschikbaar, geen meetbare winst bij dat aantal.
       * Zie `bestanden/modernization_plan.md` voor de volledige jQuery-modernisatiestatus per punt.

   * Repo-opruiming:
       * Losse debug-/rapportbestanden verplaatst van de root naar `bestanden/` resp. `bestanden/reports/`.
       * `README.md` toegevoegd als ontbrekend startpunt voor de repository.
       * `GEMINI.md` vervangen door een verwijzing naar dit bestand (enige bron van waarheid, conform de AGENTS.md-standaard).

### Current Work In Progress (v0.2.36+)

🔧 **Install Prompt**:
- [ ] Install banner not triggering on installed PWA — Chrome's `beforeinstallprompt` only fires once per origin.
- [ ] User must clear Chrome site data or uninstall/reinstall to re-trigger native prompt.
- [ ] Manual fallback: `showInstallPromotion()` called when ⓘ help button is clicked.

---

## Desktop Split-Screen Layout (v0.2.35+)

### Layout Breakpoint (sinds v0.2.88): ≥1024px én liggend

Kantelpunt tussen mobiele view en desktop 2-pane: **liggend én breedte ≥1024px** (zie `isDesktopView()` in `js/local_app.js` en `@media (min-width: 1024px) and (orientation: landscape)` in CSS). Vóór v0.2.88 was dit `min-width: 768px`; daarvoor geldt 768–1023px nu de mobiele fullscreen-view (sinds v0.2.89 geen unstyled gat meer).

**Desktop (≥1024px én liggend):**
```
┌─────────────────────────────────────────────────────────────┐
│  [SVR Logo]    [====Zoekveld====]  [Filter Chips →]        │
├──────────────────────────┬──────────────────────────────────┤
│      LIJST (60%)         │      KAART (40%)                 │
│      Links               │      Rechts                      │
│                          │                                  │
│  [Card 1] [INFO] ───────▶│  DETAIL PANEL (opent hier)       │
│                          │                                  │
└──────────────────────────┴──────────────────────────────────┘
```

**Mobile (overige viewports: <1024px of rechtop):**
- Toggle wisselt tussen kaart en lijst (fullscreen)
- Detail opent als fullscreen overlay
- Filter opent als fullscreen overlay

### CSS Classes for Desktop Modes

**Body Classes:**
- `split-mode` - Beide panelen zichtbaar (50/50)
- `map-only-mode` - Alleen kaart (100%)
- `list-only-mode` - Alleen lijst (100%)

**Detail Panel Classes:**
- `detail-from-list` - Panel opent rechts (replaces map)
- `detail-from-map` - Panel opent links (replaces list)

### Key Functions

```javascript
// Toggle button handler (desktop: 3 modes, mobile: 2 modes)
$('#toggleView').on('click', () => { ... });

// Set desktop view mode
function setDesktopViewMode(mode) { ... }

// Show detail page with context-aware positioning
window.showSVRDetailPage = function(objectId, source = 'auto') { ... }

// Apply state (mobile-only, desktop uses CSS)
function applyState(state) { ... }
```

---

## API Reference

### SVR Proxy Worker Endpoints

```
POST /login
  Body: { email, password }
  Response: { session_id }

GET /api/objects?page=0&lat={lat}&lng={lng}&distance={meters}&limit={count}
  Headers: X-SVR-Session: {session_id}
  Response: { objects: [...], total: number }

GET /objects
  Headers: X-SVR-Session, X-SVR-Filters, X-SVR-Config
  Response: HTML (filter options parsed from page)
```

### Data Structure (`campings.json`)

```json
{
  "updated": "ISO-8601 timestamp",
  "version": "1.0.0",
  "categories": [
    { "name": "Category Name", "ids": ["guid-1", "guid-2"] }
  ],
  "campings": [
    {
      "id": "camping-id",
      "naam": "Camping Name",
      "stad": "City",
      "lat": 52.1234,
      "lng": 5.5678,
      "type": "Camping type",
      "filters": ["facility-guid-1", "facility-guid-2"]
    }
  ]
}
```

---

## Git Remotes

- **origin**: `https://github.com/e60manuels/SVRpwa.git` (production - GitHub Pages)
- **staging**: `https://github.com/e60manuels/SVRpwa-test.git` (testing)

### Deploy Commands
```bash
git push origin main    # Deploy to production
git push staging main   # Deploy to staging
```
