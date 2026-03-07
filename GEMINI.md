# SVR PWA Project

This project is a Progressive Web Application (PWA) designed to provide a mobile-optimized interface for finding SVR (Stichting Vrije Recreatie) campsites. It serves as a modern replacement for the legacy SVR Android app, migrating logic from Kotlin/WebView to a pure web-based implementation.

## Project Overview
The **SVR PWA** provides an interactive map and list view of campsites across the Netherlands and Europe. It integrates with the SVR.nl API via a Cloudflare Worker proxy to bypass CORS restrictions and manage session state.

*   **Main Technologies:** HTML5, CSS3, JavaScript (jQuery), Leaflet.js (Mapping), Swiper.js (Carousels), and Service Workers.
*   **Architecture:** A single-page application (SPA) style interface with a full-screen Leaflet map, a toggleable list view, and an overlay-based campsite detail view.
*   **Key Features:**
    *   **Instant Load:** Uses `assets/campsites_preset.json` and `localStorage` to show results immediately upon startup.
    *   **Smart Search:** Local search suggestions using `assets/Woonplaatsen_in_Nederland.csv` for high-performance location lookups.
    *   **Offline Support:** Service worker (`sw.js`) caches all core assets and ensures the app starts fully (App Shell) even without internet.
    *   **Android Parity:** UI elements like the "Gele Veeg" (Yellow Swipe) and layout components are styled to match the native Android experience.

## Building and Running
The project consists of static files and does not require a complex build step.

*   **Development:** Use any local web server to serve the root directory.
    ```powershell
    # Using Python
    python -m http.server 8000
    # Using Node.js
    npx http-server
    ```
*   **Deployment:** Files are hosted on GitHub Pages. Staging is at `e60manuels.github.io/SVRpwa-test/` and Production is at `e60manuels.github.io/SVRpwa/`.
*   **Version Management:** The app uses **Semantic Versioning (SemVer)** (e.g., `v0.2.26`). Versions are updated in `js/local_app.js`, `sw.js`, and `index.html`.

## Development Conventions
*   **Coding Style:**
    *   **JavaScript:** Primarily uses a single-file logic approach in `js/local_app.js` with IIFEs and jQuery.
    *   **CSS:** Uses CSS variables for branding colors (e.g., `--svr-yellow: #FDCC01`, `--svr-blue: #008AD3`).
*   **PWA Standards:**
    *   `manifest.json` uses **relative paths** (`./`) for `start_url` and `scope` to ensure compatibility across different repository subfolders.
*   **API Interactions:**
    *   Requests to `svr.nl` must go through the Cloudflare Worker proxy.
*   **Deployment Workflow (Staging & Production):**
    *   **Staging:** Push to `SVRpwa-test.git`. Increments patch version.
    *   **Production:** Push current tested state to `SVRpwa.git`.

## Recent Development & Current Status (v0.2.26)

### Key Achievements:
*   **Regression Fix (v0.2.25 revert):** Reverted the offline search fallback implementation in `js/local_app.js` (introduced in v0.2.25) due to a critical regression causing map tiles and markers to disappear. This restores full map functionality.
*   **Reverted to Stable Yellow Branding:** Reverted all "Edge-to-Edge" experiments. The `theme-color` is back to `#FDCC01`, ensuring consistent yellow status and navigation bars on Android.
*   **Restored Layout:** Restored `#map-container` and `#list-container` to their stable absolute positioning with header offsets.
*   **Removed Diagnostic Labels:** Permanently deleted the temporary `Status: [reason]` labels from the login screen.
*   **Safe Area Maintenance:** Retained `env(safe-area-inset-bottom)` for the action stack and detail sheets to ensure buttons remain usable on modern gesture-based navigation.
*   **Version Increment:** Updated app version to `v0.2.26` across `local_app.js`, `sw.js`, and `index.html`.

### Future Work:
*   Continue with the **Modernization Plan** (located in `bestanden/modernization_plan.md`).

## Key Files
*   `index.html`: Main entry point.
*   `js/local_app.js`: Core logic (v0.2.26).
*   `css/local_style.css`: Primary styling.
*   `sw.js`: Service worker (v0.2.26).
*   `manifest.json`: PWA configuration (relative paths).
