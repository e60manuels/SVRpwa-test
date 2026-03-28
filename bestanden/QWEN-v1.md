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
├── QWEN.md                 # This file - project context
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
| App Shell (HTML, CSS, JS) | Network First | `svr-pwa-cache-v0.2.36` |
| Map Tiles (OSM) | Cache First | `svr-pwa-map-tiles` |
| API Requests | Network Only | Not cached |
| External Libraries | Network First | `svr-pwa-cache-v0.2.36` |

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

- **App Version**: Tracked in `window.SVR_PWA_VERSION` (currently `0.2.36`)
- **Cache Version**: Embedded in Service Worker cache name (`v0.2.36`)
- **Data Version**: `data/campings.json` includes `updated` timestamp and `version` field

---

## Development Conventions

### Coding Style
- **JavaScript**: ES6+ with IIFE pattern for encapsulation
- **CSS**: CSS custom properties (variables) for theming
- **Naming**: Dutch language for UI text, English for code identifiers

### Known Issues & Technical Debt

1. **jQuery Dependency**: Heavy reliance on jQuery in `local_app.js` - modernization plan exists in `bestanden/modernization_plan.md`
2. **Performance**: Lighthouse score of 48 (LCP: 15.1s, TBT: 1060ms) - see `bestanden/lighthouse_findings.md`
3. **Main Thread Blocking**: Large data file (40k+ lines) parsed synchronously
4. **Memory**: All camping data loaded into memory at once

### Completed Modernizations

✅ **v0.2.30**: Single Source of Truth - `data/campings.json` as only data source
✅ **v0.2.30**: Removed `campsites_preset.json` and `svr_cache_campsites` localStorage
✅ **v0.2.31**: Desktop responsive breakpoints (768px, 1024px, 1440px, 1920px)
✅ **v0.2.35**: Split-screen desktop layout (50/50 list left, map right)
✅ **v0.2.36**: Contextual detail panel (opens on opposite side of click source)

### Current Work In Progress (v0.2.36+)

🔧 **Desktop Split-Screen Layout** - Needs testing/fixing:
- [ ] INFO knop in lijst-tegel opent detail panel aan rechterkant
- [ ] INFO knop in map popup opent detail panel aan linkerkant
- [ ] Filter panel opent aan linkerkant (lijst zijde)
- [ ] Toggle knop cyclus: split → map-only → list-only → split
- [ ] Mobile functionality moet ongewijzigd blijven

---

## Desktop Split-Screen Layout (v0.2.35+)

### Layout Breakpoint: 768px

**Desktop (≥768px):**
```
┌─────────────────────────────────────────────────────────────┐
│  [====Zoekveld====]  [Filter] [Toggle]                     │
├──────────────────────────┬──────────────────────────────────┤
│      LIJST (50%)         │      KAART (50%)                 │
│      Links               │      Rechts                      │
│                          │                                  │
│  [Card 1] [INFO] ───────▶│  DETAIL PANEL (opent hier)       │
│                          │                                  │
└──────────────────────────┴──────────────────────────────────┘
```

**Mobile (<768px):**
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

## Testing Checklist

### Mobile (<768px)
- [ ] Map renders with camping markers
- [ ] Clustering works at zoomed-out levels
- [ ] Search suggests Dutch municipalities
- [ ] Filters apply correctly (fullscreen overlay)
- [ ] Toggle between map/list view works
- [ ] Detail view opens as fullscreen overlay
- [ ] Offline mode shows cached content
- [ ] Install banner appears (first visit)
- [ ] Help overlay displays tooltips

### Desktop (≥768px)
- [ ] Split-screen layout: 50% list left, 50% map right
- [ ] Toggle cycles: split → map-only → list-only → split
- [ ] INFO knop in lijst opent detail panel rechts
- [ ] INFO knop in map popup opent detail panel links
- [ ] Filter panel opent links (lijst zijde)
- [ ] Leaflet map resizes on window resize
- [ ] Detail panel sluit met terug knop

---

## Related Documentation

- **`migration_inventory.md`**: Original migration notes from Android native app
- **`bestanden/modernization_plan.md`**: Step-by-step code modernization guide
- **`bestanden/lighthouse_findings.md`**: Performance audit and recommendations
- **`bestanden/filter_chips_pwa_spec.md`**: Filter UI/UX specification
- **`bestanden/local_app_map.md`**: Code structure and function mapping
- **`bestanden/ontwerp-v0.2.29.txt`**: Design doc for v0.2.29 cleanup (Single Source of Truth)
- **`bestanden/gemini-svr-static-delivery.md`**: Static content delivery planning

---

## Git Remotes

- **origin**: `https://github.com/e60manuels/SVRpwa.git` (production - GitHub Pages)
- **staging**: `https://github.com/e60manuels/SVRpwa-test.git` (testing)

### Deploy Commands
```bash
git push origin main    # Deploy to production
git push staging main   # Deploy to staging
```
