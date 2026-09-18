// VERSION COUNTER - UPDATE THIS WITH EACH COMMIT FOR VISIBILITY
window.SVR_PWA_VERSION = "0.2.88"; // Increment this number with each commit

// Tablet/desktop-detectie voor de two-view PWA:
// - Rechtop (portrait) of smal scherm  => mobiele view (fullscreen, toggle).
// - Liggend (landscape) EN breed >= 1024px => desktop view (kaart links, lijst rechts).
// Een breedte van 1024px scheidt een 10"-tablet in landscape (>=1024px) van een
// brede telefoon in landscape (max ~950px CSS), die dus de mobiele view houdt.
function isDesktopView() {
    return window.innerWidth >= 1024 && window.innerHeight < window.innerWidth;
}

// Normaliseer zoektekst: kleine letters, diakritiek weg, aanhalingstekens
// genormaliseerd, meerdere spaties ingedikt.
function normalizeSearchText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[‘’`´]/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

// Zoekt campingnamen in de (eenmalig opgebouwde) lokale dataset en retourneert
// de campings gesorteerd op relevantie (0=naam start met zoekterm, 1=een woord
// start ermee, 2=zoekterm komt er elders in voor).
function getCampingNameMatches(q) {
    const index = window.campingSearchIndex;
    if (!Array.isArray(index)) return [];

    const query = normalizeSearchText(q);
    if (!query) return [];

    const matches = [];
    for (let i = 0; i < index.length; i++) {
        const entry = index[i];
        if (!entry.name || !entry.n.includes(query)) continue;

        let rank = 2;
        if (entry.n.startsWith(query)) {
            rank = 0;
        } else if (entry.n.split(/\s+/).some(word => word.startsWith(query))) {
            rank = 1;
        }
        matches.push({ camping: entry.camping, name: entry.name, rank });
    }

    return matches
        .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'nl'))
        .map(x => x.camping);
}

// [SECTION: INITIALIZATION]
(function () {
    // Typewriter effect for splash screen (now using CSS class)
    function typewriterEffect(elementId, text) {
        const targetElement = document.getElementById(elementId);
        if (!targetElement) return;

        targetElement.textContent = text;
        targetElement.classList.remove('typewriter');
        void targetElement.offsetWidth; // Force reflow to restart animation
        targetElement.classList.add('typewriter');
    }
    window.typewriterEffect = typewriterEffect; // Expose globally

    if (window.SVR_FILTER_OVERLAY_INJECTED) return;
    window.SVR_FILTER_OVERLAY_INJECTED = true;

    // Static data storage - The SINGLE SOURCE OF TRUTH for markers and filters
    window.staticCampsites = null;
    window.filterCategories = {}; // id -> category_name

    // Flag to track if we already have some data on screen
    window.hasDataOnScreen = false;

    // Zoekintentie na klik op een suggestie ('camping' of 'place'), zodat
    // performSearch weet welk type de gebruiker bedoelde.
    window._searchIntent = null;

    // Introduce a flag to control PWA prompt visibility after help overlay interaction
    window.shouldShowPWAAfterHelp = false; // Initialize the flag

    // --- DEBUG LOGGING ---
    function logDebug(msg) {
        console.log(`[v${window.SVR_PWA_VERSION}] ${msg}`);
    }
    window.logDebug = logDebug;
    logDebug("SVR PWA v2.5 Start");

    // --- DATA LOADING LOGIC ---
    window.loadStaticCampsites = async function() {
        performance.mark('data-load-start');
        try {
            // Plaats de rode punaise direct op de startlocatie (Nederland)
            const startLat = 52.1326, startLng = 5.2913;
            if (centerMarker) map.removeLayer(centerMarker);
            centerMarker = L.marker([startLat, startLng], { 
                icon: L.divIcon({ 
                    className: 'search-marker', 
                    html: '<i class="fa-solid fa-map-pin" style="color:#c0392b;font-size:30px;"></i>', 
                    iconSize:[30,30], 
                    iconAnchor:[15,30] 
                }),
                zIndexOffset: 2000 
            }).addTo(map);

            logDebug("Laden van data/campings.json (Unified Delivery)...");
            const res = await fetch('./data/campings.json?v=' + window.SVR_PWA_VERSION);
            if (res.ok) {
                const data = await res.json();
                window.staticCampsites = data.campings || [];

                // Eenmalig opgebouwde zoekindex voor campingnamen (i.p.v. bij elke
                // toetsaanslag alle campings opnieuw te normaliseren).
                window.campingSearchIndex = window.staticCampsites
                    .filter(c => c && c.naam)
                    .map(c => ({
                        camping: c,
                        name: String(c.naam).trim(),
                        n: normalizeSearchText(c.naam)
                    }));

                // Store categories for search decision
                if (data.categories) {
                    data.categories.forEach(cat => {
                        cat.ids.forEach(id => {
                            window.filterCategories[id] = cat.name;
                        });
                    });
                }

                // Render de initiële kaart (Nederland) direct vanuit de geladen data
                const sLat = 52.1326, sLng = 5.2913;
                const objects = window.staticCampsites.map(c => ({
                    id: c.id,
                    geometry: { coordinates: [c.lng, c.lat] },
                    properties: { name: c.naam, city: c.stad, type_camping: c.type },
                    distM: calculateDistance(sLat, sLng, c.lat, c.lng)
                }));
                
                objects.sort((a, b) => a.distM - b.distM);
                
                // Direct renderen (gebruik skipFitBounds om verspringen te voorkomen bij start)
                window.skipFitBounds = true;
                renderResults(objects, sLat, sLng);
                window.skipFitBounds = false;
                
                window.hasDataOnScreen = true;
                logDebug(`Static data geladen en gerenderd: ${window.staticCampsites.length} campings.`);
                return true;
            }
        } catch (e) {
            logDebug("Static Data Fout: " + e.message);
        } finally {
            performance.mark('data-load-end');
            performance.measure('Unified Data Loading', 'data-load-start', 'data-load-end');
        }
        return false;
    };

    // [SECTION: CSV_SEARCH_LOGIC]
    window.allLocations = [];
    async function loadLocations() {
        try {
            const res = await fetch('assets/Woonplaatsen_in_Nederland.csv');
            const text = await res.text();
            const lines = text.split('\n');
            window.allLocations = lines.slice(1).map(line => {
                const parts = line.split(';');
                if (parts.length >= 2) return { name: parts[0].trim(), province: parts[1].trim() };
                return null;
            }).filter(l => l && l.name);
            logDebug("CSV OK: " + window.allLocations.length);
        } catch (e) { logDebug("CSV Fout: " + e.message); }
    }
    loadLocations();

    window.getSuggestionsLocal = function(q) {
        const queryLower = normalizeSearchText(q);
        if (!queryLower) return [];

        // Plaatsnamen zijn primair in de zoekhulp; campingnamen vullen daarna de
        // resterende plekken (eindafkap op 10 via de combine-rule hieronder).

        const placeSuggestions = window.allLocations
            .filter(l => {
                const name = normalizeSearchText(l.name);
                return name.startsWith(queryLower) ||
                       name.includes(" " + queryLower);
            })
            .slice(0, 7)
            .map(l => ({
                type: 'place',
                label: `${l.name} (${l.province})`,
                value: l.name,
                province: l.province
            }));

        const campingSuggestions = getCampingNameMatches(q)
            .slice(0, 10)
            .map(c => ({
                type: 'camping',
                label: String(c.naam || '').trim() + (c.stad ? ` (${c.stad})` : ''),
                value: String(c.naam || '').trim(),
                id: c.id,
                camping: c
            }));

        // Combineer: plaatsen eerst, campings als aanvulling (max 10).
        return [...placeSuggestions, ...campingSuggestions].slice(0, 10);
    };

    window.findLocalCampingMatches = function(q) {
        return getCampingNameMatches(q);
    };

    window.getCoordinatesWeb = async function(place) {
        const locationName = place.includes(" (") ? place.split(" (")[0] : place;
        try {
            // If the place name is not in our local Dutch list and doesn't already have a country suffix, 
            // search globally. Otherwise, prefer Netherlands for common names.
            let query = locationName;
            const isLocal = window.allLocations.some(l => l.name.toLowerCase() === locationName.toLowerCase());
            if (isLocal && !locationName.includes(",")) {
                query += ", Nederland";
            }

            const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
            logDebug(`Fetching coordinates for "${query}" via Worker proxy.`);
            const contents = await fetchWithRetry(nominatimUrl); // Use fetchWithRetry
            const data = JSON.parse(contents);
            if (data && data.length > 0) {
                return { latitude: parseFloat(data[0].lat), longitude: parseFloat(data[0].lon) };
            }
        } catch (e) { logDebug("Geocode Fout: " + e.message); }
        return null;
    };

    // [SECTION: NETWORK_PROXY]
    window.proxyUrl = function(url, provider = 'ao') {
        if (provider === 'ao') return "https://api.allorigins.win/get?url=" + encodeURIComponent(url);
        return "https://corsproxy.io/?" + encodeURIComponent(url);
    }

    async function fetchWithRetry(url) {
        logDebug("Fetch via Cloudflare Worker Proxy...");
        // Replace with your deployed Cloudflare Worker URL
        const PROXY_BASE_URL = 'https://svr-proxy-worker.e60-manuels.workers.dev'; 
    
        const originalUrl = new URL(url); // Parse original URL once
        let fetchUrl = url;
        const options = { headers: {}, credentials: 'include' }; // Initialize options with credentials: 'include'

        // Determine if we need to add X-SVR-Session.
        // This is needed if the request is for svr.nl or www.svr.nl (to be proxied through worker)
        // OR if the request is already directly to the PROXY_BASE_URL (meaning it's
        // already going to the worker, and the worker needs the session).
        const isSVRDomain = originalUrl.hostname === 'svr.nl' || originalUrl.hostname === 'www.svr.nl';
        const isProxyDomain = originalUrl.hostname === new URL(PROXY_BASE_URL).hostname;
        const needsSVRSession = isSVRDomain || isProxyDomain;

        // If the URL is originally for svr.nl or nominatim, construct the worker-proxied URL
        if (isSVRDomain || originalUrl.hostname === 'nominatim.openstreetmap.org') {
            // Construct the URL to hit our proxy's forwarding endpoint
            let pathForProxy = originalUrl.pathname;

            // For Nominatim, use the full path and hostname directly
            if (originalUrl.hostname === 'nominatim.openstreetmap.org') {
                pathForProxy = originalUrl.hostname + originalUrl.pathname;
            }

            const pathSeparator = pathForProxy.startsWith('/') ? '' : '/';
            fetchUrl = `${PROXY_BASE_URL}${pathSeparator}${pathForProxy}${originalUrl.search}`;
            logDebug(`Proxying original request: ${url} -> ${fetchUrl}`);
        } else {
            // If the URL is ALREADY the proxy base URL, then we treat it as a direct proxy request
            if (isProxyDomain) {
                logDebug(`Direct request to Worker: ${url}`);
                // No need to re-construct fetchUrl, it's already the target.
            } else {
                logDebug(`Fetching non-proxied request directly: ${url}`);
            }
        }

        // Manually add session ID, PHPSESSID, and Filters from state/localStorage only for SVR requests
        if (needsSVRSession) {
            // 1. Session
            const sessionId = localStorage.getItem('svr_session_id');
            const phpSessionId = localStorage.getItem('svr_phpsessid');
            
            if (sessionId) {
                options.headers['X-SVR-Session'] = sessionId;
                logDebug(`Adding X-SVR-Session header: ${sessionId.substring(0, 20)}...`);
            } else {
                logDebug('No session ID found in localStorage for SVR request.');
            }

            if (phpSessionId) {
                options.headers['X-SVR-PHPSESSID'] = phpSessionId;
                logDebug(`Adding X-SVR-PHPSESSID header: ${phpSessionId.substring(0, 10)}...`);
            } else {
                logDebug('No PHPSESSID found in localStorage for SVR request.');
            }

            // 2. Filters & Config (Headers instead of Cookies)
            if (window.currentFilters && window.currentFilters.length > 0) {
                const filtersJson = JSON.stringify(window.currentFilters);
                const configJson = JSON.stringify({
                    filters: window.currentFilters,
                    geo: {},
                    search_free: {},
                    favorite: "0"
                });
                
                options.headers['X-SVR-Filters'] = filtersJson;
                options.headers['X-SVR-Config'] = configJson;
                logDebug(`Adding Filter headers. Count: ${window.currentFilters.length}`);
            }
        }

        // options.credentials = 'include'; // Removed, as we manually manage session via custom header

        try {
            const res = await fetch(fetchUrl, options);

            // Check for 401 = sessie expired (for any SVR-bound request, whether
            // called via svr.nl directly or already via the proxy base URL —
            // e.g. renderDetail() calls the proxy URL directly, so isSVRDomain
            // alone would miss it here)
            if (needsSVRSession && res.status === 401) {
                console.warn('⚠️ Sessie verlopen, opnieuw inloggen vereist');
                logDebug('⚠️ Sessie verlopen (401)');
                window.logoutSVR("Sessie verlopen");
                throw new Error('Session expired');
            }

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`HTTP error! Status: ${res.status}, Response: ${errorText}`);
            }

            // Handle Set-Cookie headers from the response
            // This is important for filters and other server-side state
            const setCookieHeaders = res.headers.get('Set-Cookie');
            if (setCookieHeaders && isSVRDomain) {
                // In a real browser, these would be automatically stored and sent with future requests
                // For our PWA, we need to handle them manually
                logDebug(`Received Set-Cookie headers: ${setCookieHeaders.substring(0, 100)}...`);
            }

            return await res.text();
        } catch (e) {
            logDebug("Fetch via Proxy mislukt: " + e.message);
            if (e.message === 'Session expired') throw e;
            return "";
        }
    }    window.fetchWithRetry = fetchWithRetry;

    window.openNavHelper = function(lat, lng, nameEnc) {
        try {
            const name = decodeURIComponent(escape(window.atob(nameEnc)));
            const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
            window.open(url, '_blank');
        } catch(e) { logDebug("Nav Fout: " + e.message); }
    };

    const css = `
        #svr-filter-backdrop { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1400; display: none; opacity: 0; transition: opacity 0.3s ease; }
        #svr-filter-backdrop.open { display: block; opacity: 1; }
        
        /* MOBILE STYLES (default) */
        @media (max-width: 767px) {
            #svr-filter-overlay, #svr-favorites-overlay {
                position: fixed; bottom: 0; left: 0; width: 100%; height: 90vh;
                background-color: #f0f0f0; z-index: 9995; display: flex; flex-direction: column;
                box-sizing: border-box; transform: translateY(100%); transition: transform 0.4s cubic-bezier(0.25, 0.1, 0.25, 1);
                border-top-left-radius: 12px; border-top-right-radius: 12px; box-shadow: 0 -2px 10px rgba(0,0,0,0.1);
            }
            #svr-filter-overlay.open, #svr-favorites-overlay.open { transform: translateY(0); }
            .svr-overlay-header { 
                background-color: #f0f0f0; 
                padding: 8px 15px 12px 15px; 
                display: flex; 
                flex-direction: row;
                align-items: center; 
                justify-content: space-between;
                border-top-left-radius: 12px;
                border-top-right-radius: 12px;
                cursor: ns-resize; 
            }
            .svr-overlay-header > div:first-child {
                display: none !important;
            }
            .svr-overlay-title { 
                margin: 0;
                text-align: left;
                flex: 1;
            }
            .svr-overlay-close {
                width: 32px; 
                height: 32px; 
                background: transparent;
                border-radius: 50%; 
                display: flex; 
                align-items: center;
                justify-content: center; 
                cursor: pointer; 
                color: #333;
                flex-shrink: 0;
            }
        }

        /* SHARED STYLES (Both Mobile & Desktop) */
        .svr-overlay-title { font-size: 1.2rem; font-weight: bold; margin: 0; color: #008AD3; font-family: 'Befalow', sans-serif; text-align: left; }
        #svr-filter-overlay-content, #svr-favorites-overlay-content { flex-grow: 1; overflow-y: auto; width: 100%; background-color: #f0f0f0; padding: 15px; box-sizing: border-box; scroll-behavior: smooth; }
        #active-filters-holder { background: #FDCC01; border-radius: 12px; padding: 12px 15px; margin-bottom: 15px; display: none; box-sizing: border-box; width: 100%; position: sticky; top: 0; z-index: 100; }
        .active-filter-tag { display: inline-flex; align-items: center; background: white; padding: 4px 10px; border-radius: 15px; margin: 4px; font-size: 12px; font-weight: bold; color: #008AD3; border: 1px solid #ddd; }
        .filter-section-card { background: white; border-radius: 12px; margin-bottom: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); overflow: visible !important; }
        .filter-section-header { 
            padding: 12px 15px; 
            background: #FDCC01; 
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
            cursor: pointer; 
            position: sticky; 
            top: calc(var(--filters-height, 0px) - 15px); 
            z-index: 10; 
        }
        .filter-section-header h4 { margin: 0; font-size: 22px; color: #333; font-family: 'Befalow', sans-serif; }
        .filter-section-body { padding: 0 15px; display: none; }
        .filter-section-body.show { display: block; padding-bottom: 10px; }
        .svr-overlay-footer { padding: 12px 15px; border-top: 1px solid #ddd; display: flex; gap: 15px; background: #f0f0f0; }
        .svr-footer-btn { flex: 1; height: 40px; border-radius: 20px; font-size: 0.9rem; font-weight: bold; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        #svr-filter-apply-btn { background-color: #FDCC01; color: #333; }
        #svr-filter-reset-btn { background-color: white; color: #c0392b; border: 1px solid #ddd; }
        #svr-favorites-reset-btn { background-color: white; color: #c0392b; border: 1px solid #ddd; }
        .filter-item { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid #f9f9f9; }
        
        /* Filter Sub-Dropdown Styles */
        .filter-sub-toggle { 
            padding: 10px 0; border-bottom: 1px solid #f9f9f9; cursor: pointer; 
            display: flex; justify-content: space-between; align-items: center; 
            font-size: 15px; color: #333; 
        }
        .filter-sub-toggle i { transition: transform 0.3s ease; color: #008AD3; }
        .filter-sub-toggle.active i { transform: rotate(90deg); }
        .filter-sub-content { display: none; padding-left: 20px; background: #fafafa; }
        .filter-sub-content.show { display: block; }
        
        .filters-nav-container {
            position: relative; /* Ensure positioning context for absolute children */
            display: flex; /* Make it a flex container */
            align-items: center; /* Vertically center content */
            overflow: hidden; /* Hide overflowing content, especially for scrolling chips */
            width: 100%; /* Take full width of parent */
            height: 36px; /* Explicitly set height */
        }
        
        .active-filters-bar {
            position: relative; /* Positioning context for arrows */
            flex: 1; /* Ensure it takes all available horizontal space */
            height: 100%; /* Take full height of parent */
            overflow-x: auto; /* Re-enable */
            white-space: nowrap; /* Re-enable */
            padding: 0 40px; /* Space for arrows */
            box-sizing: border-box;
            display: flex;
            align-items: center;
            scrollbar-width: none;
            scroll-behavior: smooth;
        }

        .filter-nav-arrow {
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            background: rgba(255, 255, 255, 0.8);
            border: none;
            padding: 0 5px;
            cursor: pointer;
            height: 100%; /* Take full height of active-filters-bar */
            display: flex;
            align-items: center;
            z-index: 1;
            font-size: 1.2rem;
            color: var(--svr-blue);
            opacity: 0;
            transition: opacity 0.2s;
        }
        .filter-nav-arrow.visible {
            opacity: 1;
        }
        .filter-nav-arrow.left {
            left: 0;
            border-right: 1px solid rgba(0,0,0,0.1);
        }
        .filter-nav-arrow.right {
            right: 0;
            border-left: 1px solid rgba(0,0,0,0.1);
        }

        /* DESKTOP SPECIFIC (min-width: 1024px && landscape) */
        @media (min-width: 1024px) and (orientation: landscape) {
            #svr-filter-overlay, #svr-favorites-overlay { 
                display: flex; flex-direction: column; background-color: #f0f0f0; 
                border-radius: 0; transform: none !important; transition: none !important;
                overflow: hidden;
            }
            .svr-overlay-header { 
                background-color: var(--svr-yellow) !important; padding: 15px 20px; 
                display: flex !important; flex-direction: row !important; 
                align-items: center; justify-content: space-between; 
                border-bottom: 1px solid rgba(0,0,0,0.1); flex-shrink: 0;
                height: 60px; box-sizing: border-box;
            }
            /* Hide the drag handle div explicitly */
            .svr-overlay-header > div:first-child { display: none !important; }
            
            .svr-overlay-title { padding: 0; margin: 0; color: #333 !important; font-size: 1.3rem; flex-grow: 1; text-align: left; }
            .svr-overlay-close { 
                width: 32px; height: 32px; background: rgba(0,0,0,0.1); 
                border-radius: 50%; display: flex; align-items: center; 
                justify-content: center; cursor: pointer; color: #333; 
                transition: background 0.2s; flex-shrink: 0;
            }
            .svr-overlay-close:hover { background: rgba(0,0,0,0.2); }

            /* Sticky categorie-headers voor een betere UX */
            .filter-section-card { overflow: visible !important; }
            .filter-section-header { 
                position: sticky !important; 
                top: calc(var(--filters-height, 0px) - 15px) !important; 
                z-index: 10 !important; 
                box-shadow: 0 2px 5px rgba(0,0,0,0.1);
            }

            /* Content scrollable maken zonder header te pushen */
            #svr-filter-overlay-content, #svr-favorites-overlay-content {
                flex: 1 1 auto;
                overflow-y: auto !important;
                background-color: #f8f8f8;
            }
            .svr-overlay-footer {
                flex-shrink: 0;
                background-color: #f0f0f0;
            }

            /* Specific styles for active filter bar within injected CSS */
            .filters-nav-container {
                width: calc(100% - 24px); /* Account for svr-header's 12px horizontal padding on each side */
                margin: 0 auto; /* Center it */
                /* height and other properties remain from general styles */
            }

            .active-filters-bar {
                justify-content: flex-end;
                /* padding-right handled by local_style.css for desktop alignment */
                padding-left: 40px; /* Space for arrow */
            }

            /* Spacing between chips */
            .active-filters-bar .active-filter-chip {
                margin-right: 8px;
                margin-left: 0;
            }

            /* No specific positioning for arrows here, general styles apply */
        }
    `;
    const style = document.createElement('style'); style.appendChild(document.createTextNode(css)); document.head.appendChild(style);

    const backdrop = document.createElement('div'); backdrop.id = 'svr-filter-backdrop'; document.body.appendChild(backdrop);
    const overlay = document.createElement('div'); overlay.id = 'svr-filter-overlay';
    overlay.innerHTML = `
        <div class="svr-overlay-header" id="filter-drag-header">
            <div style="width: 100%; display: flex; justify-content: center; margin-bottom: 10px; pointer-events: none;"><div style="width: 40px; height: 5px; background: #BBB; border-radius: 3px;"></div></div>
            <h3 class="svr-overlay-title">Filters</h3>
            <div class="svr-overlay-close" onclick="window.closeFilterOverlay()"><i class="fas fa-times"></i></div>
        </div>
        <div id="svr-filter-overlay-content">
            <div id="active-filters-holder"><div id="active-tags-container"></div></div>
            <div id="filter-loading" style="text-align:center; padding: 40px;"><i class="fas fa-spinner fa-spin fa-2x" style="color:#008AD3"></i><p>Filters ophalen...</p></div>
            <div id="filter-container"></div>
        </div>
        <div class="svr-overlay-footer">
            <button id="svr-filter-reset-btn" class="svr-footer-btn">Wis filters</button>
            <button id="svr-filter-apply-btn" class="svr-footer-btn">Toepassen</button>
        </div>
    `;
    document.body.appendChild(overlay);

    const content = overlay.querySelector('#filter-container');
    const loading = overlay.querySelector('#filter-loading');

    // Generic Swipe-to-Close Logic
    window.enableSwipeToClose = function(element, closeCallback, dragHandleSelector) {
        let startY = 0;
        let currentY = 0;
        let isDragging = false;
        const dragHandle = element.querySelector(dragHandleSelector || '.svr-overlay-header, .detail-header');

        if (!dragHandle) return;

        dragHandle.addEventListener('touchstart', (e) => {
            startY = e.touches[0].clientY;
            isDragging = true;
            element.style.transition = 'none'; // Disable transition for direct tracking
        }, {passive: true});

        dragHandle.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            currentY = e.touches[0].clientY;
            const deltaY = currentY - startY;

            if (deltaY > 0) { // Only allow dragging downwards
                e.preventDefault(); // Prevent scrolling
                element.style.transform = `translateY(${deltaY}px)`;
            }
        }, {passive: false});

        dragHandle.addEventListener('touchend', (e) => {
            if (!isDragging) return;
            isDragging = false;
            element.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.1, 0.25, 1)'; // Restore transition
            
            const deltaY = currentY - startY;
            const threshold = 100; // Pixel threshold to close

            if (deltaY > threshold) {
                element.style.transform = 'translateY(100%)'; // Visual close immediately
                setTimeout(() => {
                    closeCallback(); // Trigger full cleanup after animation start
                }, 10);
            } else {
                element.style.transform = 'translateY(0)'; // Snap back
            }
            startY = 0;
            currentY = 0;
        });
    };

window.hideFilterOverlay = function() {
    if (window.parent !== window) {
        window.parent.postMessage({ type: 'svr-nav', panel: 'filter', open: false }, '*');
    }
    const isDesktop = isDesktopView();
    const filterEl = document.getElementById('svr-filter-overlay');
    const backdropEl = document.getElementById('svr-filter-backdrop');

    if (isDesktop) {
        closeRightPanel();
        filterEl.style.display = 'none';
        filterEl.classList.remove('open');
    } else {
        filterEl.classList.remove('open');
        backdropEl.classList.remove('open');
        filterEl.style.transform = '';
        setTimeout(() => {
            if (!filterEl.classList.contains('open')) {
                backdropEl.style.display = 'none';
            }
        }, 500);
    }
};

    window.closeFilterOverlay = function() { 
        // If we are in the 'filters' or 'detail' history state, going back will trigger onpopstate
        // which will call hideFilterOverlay() or handle the detail close animation.
        if (history.state && (history.state.view === 'filters' || history.state.view === 'detail')) {
            history.back();
        } else {
            // Fallback if state is already gone
            window.hideFilterOverlay();
        }
    };
    backdrop.onclick = window.closeFilterOverlay;

    // Enable swipe for filter overlay
    window.enableSwipeToClose(overlay, window.closeFilterOverlay, '.svr-overlay-header');

    // --- FAVORIETEN OVERLAY (zelfde opbouw als de Filters-overlay) ---
    const favOverlay = document.createElement('div'); favOverlay.id = 'svr-favorites-overlay';
    favOverlay.innerHTML = `
        <div class="svr-overlay-header" id="favorites-drag-header">
            <div style="width: 40px; height: 5px; background: #BBB; border-radius: 3px;"></div>
            <h3 class="svr-overlay-title">Favorieten</h3>
            <div class="svr-overlay-close" onclick="window.closeFavoritesOverlay()"><i class="fas fa-times"></i></div>
        </div>
        <div id="svr-favorites-overlay-content">
            <div id="favorites-container"></div>
        </div>
        <div class="svr-overlay-footer">
            <button id="svr-favorites-reset-btn" class="svr-footer-btn" onclick="window.clearFavorites()">Wis favorieten</button>
        </div>
    `;
    document.body.appendChild(favOverlay);
    window.enableSwipeToClose(favOverlay, window.closeFavoritesOverlay, '.svr-overlay-header');

    window.toggle_filters = async function() {
        const isDesktop = isDesktopView();

        if (window.parent !== window) {
            window.parent.postMessage({ type: 'svr-nav', panel: 'filter', open: true }, '*');
        }

        if (isDesktop) {
            const filterEl = document.getElementById('svr-filter-overlay');
            
            // Toggle: als filter al open is, sluit het
            if (document.body.classList.contains('panel-open') && filterEl.style.display === 'block') {
                if (window.parent !== window) {
                    window.parent.postMessage({ type: 'svr-nav', panel: 'filter', open: false }, '*');
                }
                closeRightPanel();
                return;
            }

            // Open filter rechts
            openRightPanel('filter');
            filterEl.classList.add('open');

            // Push state voor backknop
            history.pushState({ view: 'filters' }, "");

            if (content.children.length === 0 && !window.isFetchingFilters) await fetchFilterData();
        } else {
            // Mobile: fullscreen overlay met backdrop
            backdrop.style.display = 'block';
            overlay.style.transform = '';
            setTimeout(() => { overlay.classList.add('open'); backdrop.classList.add('open'); }, 10);
            history.pushState({ view: 'filters' }, "");
            if (content.children.length === 0 && !window.isFetchingFilters) await fetchFilterData();
        }
    };

    window.isFetchingFilters = false;
    async function fetchFilterData() {
        if (window.isFetchingFilters) return;
        window.isFetchingFilters = true;
        try {
            logDebug("Filters ophalen...");
            const contents = await fetchWithRetry('https://www.svr.nl/objects');

            if (contents.includes("<!doctype") || contents.includes("<html")) {
                const doc = new DOMParser().parseFromString(contents, 'text/html');

                // Check if it's an error page by looking for common error indicators
                // Only consider it an error if it contains error indicators AND it's not the expected page
                const errorIndicators = ['login', 'inloggen', 'error', '404', 'not found', 'access denied', 'forbidden', 'sessie verlopen', 'session expired'];
                const lowerContents = contents.toLowerCase();
                const titleText = doc.title ? doc.title.toLowerCase() : '';

                // Consider it an error page only if it contains error indicators but NOT the expected page content
                const hasErrorIndicators = errorIndicators.some(indicator => lowerContents.includes(indicator));
                const hasExpectedContent = titleText.includes('camping') || lowerContents.includes('zoeker') || lowerContents.includes('filter');

                const isErrorPage = hasErrorIndicators && !hasExpectedContent;

                if (isErrorPage) {
                    logDebug("Foutpagina ontvangen: " + (doc.title || "Onbekende fout"));
                    loading.style.display = 'none';
                    content.innerHTML = '<div style="padding:20px;text-align:center;">Fout bij ophalen filters</div>';
                    window.isFetchingFilters = false;
                    return;
                }

                loading.style.display = 'none';
                content.innerHTML = '';


                // Zoek alle koppen met de klasse 'befalow' zoals in de originele Android app
                const befalowElements = Array.from(doc.querySelectorAll('.befalow')).filter(el => {
                    const txt = el.innerText.trim();
                    // We pakken alle koppen met tekst, behalve de hele korte
                    return txt.length > 2 && !txt.includes('Kamperen bij de boer');
                });

                befalowElements.forEach((headerEl) => {
                    const title = headerEl.innerText.trim().replace(/:$/, '');
                    // De header-container op de site is de div die de befalow bevat
                    const headerContainer = headerEl.closest('div.w-100') || headerEl.parentElement;

                    const sectionCard = document.createElement('div');
                    sectionCard.className = 'filter-section-card';

                    const header = document.createElement('div');
                    header.className = 'filter-section-header';
                    header.innerHTML = `<h4>${title}</h4><i class="fas fa-chevron-down"></i>`;

                    const body = document.createElement('div');
                    body.className = 'filter-section-body';

                    header.onclick = () => {
                        const isOpening = !header.classList.contains('active');
                        header.classList.toggle('active');
                        body.classList.toggle('show');
                        if (isOpening) {
                            setTimeout(() => sectionCard.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
                        }
                    };

                    // Lineaire collectie van siblings vanaf de header-container
                    let itemsAdded = 0;
                    let nextSib = headerContainer.nextElementSibling;

                    while (nextSib) {
                        // Stop als we de volgende header tegenkomen
                        if (nextSib.querySelector('.befalow') || nextSib.tagName === 'HR') break;

                        // Case 1: Directe checkbox
                        if (nextSib.classList.contains('form-check')) {
                            const item = createFilterItem(nextSib);
                            if (item) { body.appendChild(item); itemsAdded++; }
                        }

                        // Case 2: Sub-dropdown trigger (A) en bijbehorende content (DIV.collapse)
                        else if (nextSib.tagName === 'A' && (nextSib.classList.contains('btn') || nextSib.hasAttribute('data-bs-toggle'))) {
                            const subTitle = nextSib.innerText.trim();
                            const collapseDiv = nextSib.nextElementSibling;

                            if (collapseDiv && collapseDiv.classList.contains('collapse') && subTitle) {
                                const subToggle = document.createElement('div');
                                subToggle.className = 'filter-sub-toggle';
                                subToggle.innerHTML = `<span>${subTitle}</span><i class="fas fa-caret-right"></i>`;

                                const subBody = document.createElement('div');
                                subBody.className = 'filter-sub-content';

                                subToggle.onclick = (e) => {
                                    e.stopPropagation();
                                    subToggle.classList.toggle('active');
                                    subBody.classList.toggle('show');
                                };

                                // Vul sub-body met checkboxes uit de collapse div
                                let subItemsCount = 0;
                                collapseDiv.querySelectorAll('.form-check').forEach(subCheck => {
                                    const subFilterItem = createFilterItem(subCheck);
                                    if (subFilterItem) {
                                        subBody.appendChild(subFilterItem);
                                        subItemsCount++;
                                    }
                                });

                                if (subItemsCount > 0) {
                                    body.appendChild(subToggle);
                                    body.appendChild(subBody);
                                    itemsAdded++;
                                }
                            }
                        }

                        // Case 3: Sub-titels (zoals Laagseizoen/Hoogseizoen)
                        else if (nextSib.innerText.trim().length > 1 && nextSib.innerText.trim().length < 50 && !nextSib.querySelector('input')) {
                            const txt = nextSib.innerText.trim();
                            const subTitle = document.createElement('div');
                            subTitle.style.fontWeight = 'bold';
                            subTitle.style.marginTop = '10px';
                            subTitle.style.fontSize = '14px';
                            subTitle.style.color = '#666';
                            subTitle.textContent = txt;
                            body.appendChild(subTitle);
                        }

                        nextSib = nextSib.nextElementSibling;
                    }

                    if (itemsAdded > 0) {
                        sectionCard.appendChild(header);
                        sectionCard.appendChild(body);
                        content.appendChild(sectionCard);
                    }
                });

                logDebug("Filters succesvol verwerkt");
            } else {
                logDebug("Geen HTML ontvangen voor filters");
                loading.style.display = 'none';
                const filterFallbackMsg = !navigator.onLine
                    ? 'Filters zijn alleen beschikbaar met een internetverbinding.'
                    : 'Geen filters beschikbaar';
                content.innerHTML = `<div style="padding:20px;text-align:center;">${filterFallbackMsg}</div>`;
            }
        } catch (e) {
            logDebug("Filter Fout: " + e.message);
            loading.style.display = 'none';
            content.innerHTML = '<div style="padding:20px;text-align:center;">Fout bij ophalen filters</div>';
        } finally {
            window.isFetchingFilters = false;
        }
    }

    // Hulpfunctie om filteritems te maken zoals in de originele Android app
    function createFilterItem(webNode) {
        const input = webNode.querySelector('input');
        if (!input) return null;
        const guid = input.getAttribute('data-filter-id') || input.value || input.id;
        const name = webNode.querySelector('label')?.innerText.trim() || "Onbekend";

        if (!guid || guid === "null") return null;

        const checked = (window.currentFilters || []).includes(guid) ? 'checked' : '';

        const div = document.createElement('div');
        div.className = 'filter-item';
        div.innerHTML = `<input type="checkbox" value="${guid}" ${checked} onchange="window.onFilterChange()"><label style="flex-grow: 1; cursor: pointer;" onclick="this.previousElementSibling.click()">${name}</label>`;
        return div;
    }

    // Functie om de navigatiepijltjes van de filterbalk bij te werken
    function updateFilterArrows() {
        const bar = document.getElementById('active-filters-bar');
        const leftArrow = document.getElementById('filter-arrow-left');
        const rightArrow = document.getElementById('filter-arrow-right');
        
        if (!bar || !leftArrow || !rightArrow) return;

        // Check if there is overflow
        const hasOverflow = bar.scrollWidth > bar.clientWidth;
        
        if (!hasOverflow) {
            leftArrow.classList.remove('visible');
            rightArrow.classList.remove('visible');
            return;
        }

        // Show/hide left arrow
        if (bar.scrollLeft > 5) {
            leftArrow.classList.add('visible');
        } else {
            leftArrow.classList.remove('visible');
        }

        // Show/hide right arrow
        // Gebruik een marge van 5px voor afrondingsverschillen
        if (bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 5) {
            rightArrow.classList.add('visible');
        } else {
            rightArrow.classList.remove('visible');
        }
    }

    // Initialiseer de navigatiepijltjes
    function initFilterNav() {
        const bar = document.getElementById('active-filters-bar');
        const leftArrow = document.getElementById('filter-arrow-left');
        const rightArrow = document.getElementById('filter-arrow-right');

        if (bar) {
            bar.addEventListener('scroll', updateFilterArrows);
            // Ook checken bij resize van het venster
            window.addEventListener('resize', updateFilterArrows);
        }

        if (leftArrow) {
            leftArrow.onclick = () => {
                if (bar) bar.scrollBy({ left: -150, behavior: 'smooth' });
            };
        }

        if (rightArrow) {
            rightArrow.onclick = () => {
                if (bar) bar.scrollBy({ left: 150, behavior: 'smooth' });
            };
        }
    }

    // Functie om de actieve filters UI bij te werken
    // target: 'overlay' (menu tags), 'header' (top chips), or 'both'
    function updateActiveFiltersUI(selectedItems, target = 'both') {
        // --- 1. Overlay Tags (Inside the filter menu) ---
        if (target === 'overlay' || target === 'both') {
            const tagsContainer = overlay.querySelector('#active-tags-container');
            const activeHolder = overlay.querySelector('#active-filters-holder');
            const overlayContent = overlay.querySelector('#svr-filter-overlay-content');

            tagsContainer.innerHTML = '';
            const oldHeight = activeHolder.style.display !== 'none' ? activeHolder.offsetHeight : 0;

            if (selectedItems.length > 0) {
                activeHolder.style.display = 'block';
                selectedItems.forEach(item => {
                    const tag = document.createElement('span');
                    tag.className = 'active-filter-tag';
                    tag.innerText = item.name;
                    tagsContainer.appendChild(tag);
                });
            } else {
                activeHolder.style.display = 'none';
            }

            setTimeout(() => {
                const newHeight = activeHolder.style.display !== 'none' ? activeHolder.offsetHeight : 0;
                const diff = newHeight - oldHeight;
                
                // Update dynamic CSS variable for sticky headers
                overlayContent.style.setProperty('--filters-height', newHeight + 'px');

                if (newHeight > 0) {
                    overlayContent.style.scrollPaddingTop = (newHeight + 15) + 'px';
                } else {
                    overlayContent.style.scrollPaddingTop = '15px';
                }
                if (diff !== 0 && overlayContent.scrollTop > 0) {
                    overlayContent.scrollBy({ top: -diff, behavior: 'instant' });
                }
            }, 1);
        }

        // --- 2. Header Chips (Top search bar) ---
        if (target === 'header' || target === 'both') {
            const headerBar = document.getElementById('active-filters-bar');
            const svrHeader = document.querySelector('.svr-header');
            
            if (headerBar) {
                headerBar.innerHTML = '';
                if (selectedItems.length > 0) {
                    document.body.classList.add('has-filters');
                    svrHeader.classList.add('has-filters');
                    selectedItems.forEach(item => {
                        const chip = document.createElement('div');
                        chip.className = 'active-filter-chip';
                        chip.innerHTML = `${item.name}<i class="fas fa-times-circle" data-guid="${item.guid}"></i>`;
                        headerBar.appendChild(chip);

                        chip.querySelector('i').onclick = (e) => {
                            e.stopPropagation();
                            const guid = e.target.getAttribute('data-guid');
                            window.removeFilterByGuid(guid);
                        };
                    });
                    
                    // Check pijltjes na het vullen van de chips
                    setTimeout(updateFilterArrows, 100);
                } else {
                    document.body.classList.remove('has-filters');
                    svrHeader.classList.remove('has-filters');
                }
            }
        }
    }

    window.updateActiveFiltersUI = updateActiveFiltersUI;

    /**
     * Verwijdert een enkel filter via de chip en ververst de resultaten.
     */
    window.removeFilterByGuid = function(guid) {
        logDebug(`Verwijderen filter via chip: ${guid}`);
        
        const cb = overlay.querySelector(`input[type="checkbox"][value="${guid}"]`);
        if (cb) cb.checked = false;

        window.currentFilters = (window.currentFilters || []).filter(f => f !== guid);

        const btn = document.getElementById('filterBtn');
        if (window.currentFilters.length === 0) {
            btn.style.background = 'white';
            btn.style.color = '#333';
        }

        const selected = [];
        overlay.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
            selected.push({ guid: cb.value, name: cb.parentElement.querySelector('label').innerText });
        });
        // Update BEIDE UI locaties bij handmatige verwijdering
        updateActiveFiltersUI(selected, 'both');

        // Wis zoekveld: filteractie overschrijft eerdere zoekopdracht.
        $searchInput.val(''); $('#searchResetBtn').hide();
        window.performSearch(true);
    };

    window.onFilterChange = function() {
        const selected = [];
        overlay.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
            selected.push({ guid: cb.value, name: cb.parentElement.querySelector('label').innerText });
        });
        // CRITICAL FIX: Update alleen de 'overlay', nog GEEN chips in de header
        updateActiveFiltersUI(selected, 'overlay'); 
    };

    overlay.querySelector('#svr-filter-apply-btn').onclick = function() {
        const selectedGuids = [];
        const selectedItems = [];
        overlay.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
            selectedGuids.push(cb.value);
            selectedItems.push({ guid: cb.value, name: cb.parentElement.querySelector('label').innerText });
        });
        window.currentFilters = selectedGuids;

        const btn = document.getElementById('filterBtn');
        if (selectedGuids.length > 0) {
            btn.style.background = 'var(--svr-blue)';
            btn.style.color = 'white';
        } else {
            btn.style.background = 'white';
            btn.style.color = '#333';
        }

        // NU pas de header chips updaten
        updateActiveFiltersUI(selectedItems, 'header');

        window.closeFilterOverlay();
        // Wis zoekveld: filteractie overschrijft eerdere zoekopdracht (camping-
        // of plaatsnaam) zodat een "schone filtering" plaatsvindt.
        $searchInput.val(''); $('#searchResetBtn').hide();
        window.performSearch(true); 
    };

    // Wis filters functionaliteit
    window.resetFilters = function() {
        overlay.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
        window.currentFilters = [];
        const btn = document.getElementById('filterBtn');
        btn.style.background = 'white';
        btn.style.color = '#333';

        // Leeg de UI overal
        updateActiveFiltersUI([], 'both');

        // CRITICAL: Clear cache to prevent "hanging" filter results
        localStorage.removeItem('svr_cache_campsites');

        const expires = "; expires=Thu, 01 Jan 1970 00:00:00 GMT";
        document.cookie = "filters=[]; expires=" + expires + "; path=/; domain=svr.nl";

        // Reset URL hash
        if (window.location.hash.includes('detail/')) {
            // Keep detail view if that's what we are looking at
        } else {
            history.replaceState({ view: isListView ? 'list' : 'map' }, "", window.location.pathname);
        }

        window.closeFilterOverlay();
        // Wis zoekveld: filterwis overschrijft eerdere zoekopdracht.
        $searchInput.val(''); $('#searchResetBtn').hide();
        window.performSearch(true); 
    };

    // Voeg click handler toe aan de reset knop
    overlay.querySelector('#svr-filter-reset-btn').onclick = window.resetFilters;

    window.fetchFilterData = fetchFilterData;

    // Start de navigatiepijltjes logica
    initFilterNav();

})();

// --- MAP & CORE LOGIC ---
let isListView = false;
let isSearching = false;
logDebug("Map init...");
const map = L.map('map', { zoomControl: false }).setView([52.1326, 5.2913], 8);
const markerCluster = L.markerClusterGroup();
const top10Layer = L.featureGroup();
let centerMarker = null;
let currentUserLatLng = null;
let userLocationMarker = null;
// Android back-bevestiging: tijdstip waarop de 'verlaat de app'-toast getoond
// is. Een tweede back binnen 3 seconden bevestigt het verlaten.
let exitConfirmArmed = 0;

// Add zoom control positioned at bottom right (desktop only)
const isDesktop = isDesktopView();
if (isDesktop) {
    L.control.zoom({
        position: 'bottomright'
    }).addTo(map);
}

const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OSM' }).addTo(map);
tiles.on('tileload', () => { if(!window.tilesLogged) { logDebug("Tegels OK"); window.tilesLogged=true; } });
map.addLayer(markerCluster); map.addLayer(top10Layer);

map.on('locationfound', (e) => { 
    if (!currentUserLatLng || currentUserLatLng.distanceTo(e.latlng) > 100) {
        logDebug("Loc: " + e.latlng.lat.toFixed(3) + "," + e.latlng.lng.toFixed(3));
        currentUserLatLng = e.latlng;
    }

    // Update or create user location marker
    if (userLocationMarker) {
        userLocationMarker.setLatLng(e.latlng);
    } else {
        userLocationMarker = L.marker(e.latlng, {
            icon: L.divIcon({
                className: 'user-location-dot',
                iconSize: [12, 12],
                iconAnchor: [6, 6]
            }),
            zIndexOffset: 1000
        }).addTo(map);
    }
});
map.locate({ watch: false, enableHighAccuracy: true });

$('#locateBtn').on('click', () => {
    if (currentUserLatLng) map.setView(currentUserLatLng, 10);
    else map.locate({ setView: true, maxZoom: 10 });
});

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; const p1 = lat1 * Math.PI/180, p2 = lat2 * Math.PI/180;
    const dLat = (lat2-lat1) * Math.PI/180, dLon = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Geometrisch middelpunt (centroid van de bounding box) van een reeks campings.
// Retourneert null als geen enkele camping een geldige positie heeft.
function centroidOf(campings) {
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity, valid = false;
    for (const c of campings || []) {
        const lat = parseFloat(c.lat), lng = parseFloat(c.lng);
        if (!isFinite(lat) || !isFinite(lng)) continue;
        valid = true;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
    }
    if (!valid) return null;
    return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
}

// Verplaatst de rode punaise (zoekcentrum) naar de opgegeven locatie.
// In de favorieten-context (KAART-knop) wordt de punaise onderdrukt: de favoriet
// wordt dan via de marker-popup aangeduid i.p.v. door een rode pin.
function placeSearchMarker(lat, lng) {
    if (centerMarker) map.removeLayer(centerMarker);
    if (window.suppressSearchMarker) return;
    centerMarker = L.marker([lat, lng], {
        icon: L.divIcon({
            className: 'search-marker',
            html: '<i class="fa-solid fa-map-pin" style="color:#c0392b;font-size:30px;"></i>',
            iconSize:[30,30],
            iconAnchor:[15,30]
        }),
        zIndexOffset: 2000
    }).addTo(map);
}

// Geeft dezelfde kaartweergave als een plaatsnaam-zoekopdracht rond (lat,lng):
// het middelpunt uitgebreid met de tien dichtstbijzijnde campings. Zo verwijdt
// een enkele campingmatch uit een naam-zoekopdracht niet maximaal in te zoomen.
function getPlaceSearchViewBounds(lat, lng) {
    const bounds = L.latLngBounds([lat, lng]);
    if (Array.isArray(window.staticCampsites)) {
        window.staticCampsites
            .map(c => ({ c, d: calculateDistance(lat, lng, c.lat, c.lng) }))
            .sort((a, b) => a.d - b.d)
            .slice(0, 10)
            .forEach(({ c }) => bounds.extend([c.lat, c.lng]));
    }
    return bounds;
}

// Geeft de dichtstbijzijnde campings rondom (lat,lng). Gebruikt door de
// favorieten-KAART-knop om de omgeving van een favoriet te tonen (i.p.v. alleen
// de enkele favoriet), zodat de kaart net als op desktop contextmarkers toont.
function nearestCampingsAround(lat, lng, count = 10) {
    if (!Array.isArray(window.staticCampsites)) return [{ lat, lng }];
    return window.staticCampsites
        .map(c => ({ c, d: calculateDistance(lat, lng, c.lat, c.lng) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, count)
        .map(({ c }) => c);
}

// Renders lokale campingmatches: filters toepassen, zoekcentrum bepalen,
// lijst + kaart vullen en de punaise op de juiste plaats zetten.
function renderCampingResults(campings, opts) {
    let filtered = campings;

    // Bestaande filters blijven van toepassing.
    if (window.currentFilters && window.currentFilters.length > 0) {
        filtered = campings.filter(c =>
            window.currentFilters.every(f => c.filters && c.filters.includes(f))
        );
    }

    // Zoekcentrum = middelpunt van de gevonden campings (bij één match de
    // positie van die camping). Dit houdt de rode punaise en de weergegeven
    // afstanden consistent met wat er op de kaart staat.
    const center = centroidOf(filtered);
    const sLat = center ? center.lat : 52.1326;
    const sLng = center ? center.lng : 5.2913;

    const objects = filtered.map(c => ({
        id: c.id,
        geometry: { coordinates: [c.lng, c.lat] },
        properties: { name: c.naam, city: c.stad, type_camping: c.type },
        distM: calculateDistance(sLat, sLng, c.lat, c.lng)
    }));

    objects.sort((a, b) => a.distM - b.distM);

    if (filtered.length === 1 && opts && opts.campingName) {
        // Enkele match uit een campingnaam-zoekopdracht: net als bij een favoriet
        // op de kaart wordt de camping mét zijn dichtstbijzijnde buren getoond en
        // wordt géén rode punaise geplaatst — de match zelf wordt via de
        // marker-popup aangeduid. De recursieve aanroep past de actieve filters
        // toe op de buren en regelt zelf de kaartweergave (fitBounds op de buren).
        const one = filtered[0];
        window.suppressSearchMarker = true;
        window.suppressDistance = true;
        renderCampingResults(nearestCampingsAround(one.lat, one.lng, 10));
        window.suppressDistance = false;
        window.suppressSearchMarker = false;
        // Open de popup van de gekozen camping zodat duidelijk is welke match je
        // hebt geselecteerd tussen de omringende markers (zelfde flow als de
        // favorieten-KAART: pan naar de marker + popup na de fitBounds-animatie).
        setTimeout(() => window.focusOnMarker(one.lat, one.lng, one.id), 300);
    } else if (filtered.length === 1) {
        // Enkele match uit een andere route (bijv. plaats-zoekopdracht met één
        // resultaat): zoom rond deze camping zoals een plaatsnaam-zoekopdracht,
        // mét de rode punaise op het zoekcentrum en zonder buren te tekenen.
        placeSearchMarker(sLat, sLng);
        window.skipFitBounds = true;
        renderResults(objects, sLat, sLng);
        window.skipFitBounds = false;
        const viewBounds = getPlaceSearchViewBounds(sLat, sLng);
        window.lastMapBounds = viewBounds;
        if (!isListView) {
            map.fitBounds(viewBounds, { padding: [50, 50] });
        }
    } else {
        placeSearchMarker(sLat, sLng);
        renderResults(objects, sLat, sLng);
    }

    window.hasDataOnScreen = true;
    setTimeout(() => map.invalidateSize(), 500);
}

// Toont de volledige default kaart + lijst zoals bij het laden van de app:
// alle campings, zoekcentrum Nederland, punaise op de default-positie.
function renderDefaultView() {
    if (!window.staticCampsites) return;
    const sLat = 52.1326, sLng = 5.2913;
    const objects = window.staticCampsites.map(c => ({
        id: c.id,
        geometry: { coordinates: [c.lng, c.lat] },
        properties: { name: c.naam, city: c.stad, type_camping: c.type },
        distM: calculateDistance(sLat, sLng, c.lat, c.lng)
    }));
    objects.sort((a, b) => a.distM - b.distM);
    placeSearchMarker(sLat, sLng);
    renderResults(objects, sLat, sLng);
    window.hasDataOnScreen = true;
    setTimeout(() => map.invalidateSize(), 100);
}

// Reset: zoekveld leegmaken, actieve filters wissen en de default kaart + lijst
// tonen (alle campings rond het Nederlandse startpunt).
window.resetSearch = function() {
    window._searchIntent = null;
    $('#searchResetBtn').hide();
    $searchInput.val('');
    $suggestionsList.hide();

    // Filters ook leegmaken zodat "volledige default" echt compleet is.
    if (window.currentFilters && window.currentFilters.length > 0) {
        const overlay = document.getElementById('svr-filter-overlay');
        if (overlay) {
            overlay.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
        }
        window.currentFilters = [];
        const btn = document.getElementById('filterBtn');
        if (btn) { btn.style.background = 'white'; btn.style.color = '#333'; }
        updateActiveFiltersUI([], 'both');
        const expires = "; expires=Thu, 01 Jan 1970 00:00:00 GMT";
        document.cookie = "filters=[]; expires=" + expires + "; path=/; domain=svr.nl";
    }

    renderDefaultView();
};

// === FAVORIETEN (lokaal, geen serverafhankelijkheid) ===
const FAVORITES_KEY = 'svr_favorites';

function getFavoriteIds() {
    try {
        const raw = localStorage.getItem(FAVORITES_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

function saveFavoriteIds(ids) {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
}

window.isSVRFavorite = function(id) {
    return getFavoriteIds().includes(id);
};

// Toggle voor de hartje-knop in de detailheader. Werkt offline en onafhankelijk
// van de SVR-sessie; favorieten worden lokaal opgeslagen.
window.toggleSVRFavorite = function(id) {
    if (!id) return;
    const favs = getFavoriteIds();
    const isFav = favs.includes(id);
    const next = isFav ? favs.filter(f => f !== id) : favs.concat(id);
    saveFavoriteIds(next);

    // De svr.nl-knop in de embedded body is het enige hartje op de pagina.
    const icon = document.querySelector('#detail-container button[id^="heart_"] i');
    if (icon) {
        icon.classList.toggle('fa-solid', !isFav);
        icon.classList.toggle('fa-regular', isFav);
    }
    return !isFav;
};

// Toont de favorietenlijst in een overlay die qua opbouw en stijl identiek is
// aan de Filters-pagina (header met sluitknop, content scrollbaar).
window.showFavorites = function(withHistory = true) {
    const favOverlay = document.getElementById('svr-favorites-overlay');
    const backdrop = document.getElementById('svr-filter-backdrop');
    if (!favOverlay) return;
    const isDesktop = isDesktopView();

    renderFavoritesOverlayContent();

    if (isDesktop) {
        openRightPanel('favorites');
        favOverlay.classList.add('open');
    } else {
        backdrop.style.display = 'block';
        favOverlay.style.transform = '';
        setTimeout(() => { favOverlay.classList.add('open'); backdrop.classList.add('open'); }, 10);
    }
    if (withHistory) {
        history.pushState({ view: 'favorites' }, "");
    }
};

window.hideFavoritesOverlay = function() {
    if (window.parent !== window) {
        window.parent.postMessage({ type: 'svr-nav', panel: 'favorites', open: false }, '*');
    }
    const isDesktop = isDesktopView();
    const favOverlay = document.getElementById('svr-favorites-overlay');
    const backdrop = document.getElementById('svr-filter-backdrop');
    if (!favOverlay) return;

    if (isDesktop) {
        closeRightPanel();
        favOverlay.style.display = 'none';
        favOverlay.classList.remove('open');
    } else {
        favOverlay.classList.remove('open');
        backdrop.classList.remove('open');
        favOverlay.style.transform = '';
        setTimeout(() => {
            if (!favOverlay.classList.contains('open')) {
                // De backdrop wordt ook door de detail-/filteroverlay gebruikt:
                // laat 'm staan als er ondertussen een andere overlay open is
                // (bijv. detail dat direct uit een favorieten-tegel opent).
                const detailEl = document.getElementById('detail-container');
                const filterEl = document.getElementById('svr-filter-overlay');
                if (!detailEl.classList.contains('open') && !filterEl.classList.contains('open')) {
                    backdrop.style.display = 'none';
                }
            }
        }, 500);
    }
};

window.closeFavoritesOverlay = function() {
    const isDesktop = isDesktopView();
    // Desktop: de KAART-knop pan-te de kaart naar een favoriet terwijl de
    // favorieten-popup open bleef. Bij sluiten herstellen we het laatste
    // zoekvenster zodat je teruggaat naar de laatst getoonde zoekopdracht.
    if (isDesktop && window.favoriteMapPanned) {
        window.favoriteMapPanned = false;
        if (window.lastMapBounds) {
            map.fitBounds(window.lastMapBounds, { padding: [50, 50] });
        }
    }
    if (history.state && (history.state.view === 'favorites' || history.state.view === 'detail')) {
        history.back();
    } else {
        window.hideFavoritesOverlay();
    }
};

// Opent de detailpagina vanuit de favorietenlijst. De overlay wordt alleen
// visueel gesloten — de favorites history-entry blijft staan, zodat sluiten van
// de detailpagina (history.back) weer op de favorieten uitkomt.
window.openFavoriteDetail = function(id) {
    window.hideFavoritesOverlay();
    const openDetail = () => window.showSVRDetailPage(id, 'list');
    if (isDesktopView()) {
        openDetail();
    } else {
        // Mobiel: laat de favorites-sheet eerst wegzakken voordat de detail-sheet
        // omhoog komt, zodat ze elkaar niet visueel bevechten.
        setTimeout(openDetail, 150);
    }
};

// Toont een favoriet op de kaart:
// - Desktop: de favorieten-popup blijft open en de kaart pan/zoomt naar de
//   camping. De lijst/zoekresultaten worden niet vervangen.
// - Mobiel: de sheet wordt visueel gesloten, de camping wordt op de kaart
//   getoond en een map-history-entry komt bovenop de (behouden) favorites-entry,
//   zodat Android-back terugkeert naar de favorietenlijst i.p.v. de app te verlaten.
window.openFavoriteMap = function(lat, lng, id) {
    const isDesktop = isDesktopView();
    if (isDesktop) {
        window.favoriteMapPanned = true;
        // Herbind de bestaande marker-popup met GPS-afstand (i.p.v. zoekcentrum-afstand)
        if (currentUserLatLng) {
            let favMarker = null;
            markerCluster.eachLayer(m => { if (m.objId === id) favMarker = m; });
            if (!favMarker) top10Layer.eachLayer(m => { if (m.objId === id) favMarker = m; });
            if (favMarker) {
                const ll = favMarker.getLatLng();
                const gpsDistKm = (calculateDistance(currentUserLatLng.lat, currentUserLatLng.lng, ll.lat, ll.lng) / 1000).toFixed(1);
                const popup = favMarker.getPopup();
                if (popup) {
                    popup.setContent(popup.getContent().replace(/Afstand: [\d.]+ km/, 'Afstand: ' + gpsDistKm + ' km'));
                }
            }
        }
        window.focusOnMarker(lat, lng, id);
        return;
    }
    // Mobiel: alleen visueel sluiten (history blijft) zodat back naar favorieten gaat
    window.hideFavoritesOverlay();
    setTimeout(() => {
        const camping = (window.staticCampsites || []).find(c => c.id === id);
        if (camping) {
            // Net als op desktop de omgeving van de favoriet tonen (de favoriet
            // wordt via de marker-popup aangeduid) i.p.v. alleen de ene camping.
            // suppressDistance (GPS-afstand in popup) + suppressSearchMarker
            // (geen rode punaise) blijven in de favorieten-context actief.
            window.suppressDistance = true;
            window.suppressSearchMarker = true;
            renderCampingResults(nearestCampingsAround(camping.lat, camping.lng, 10));
            window.suppressSearchMarker = false;
            window.suppressDistance = false;
            setTimeout(() => {
                window.focusOnMarker(camping.lat, camping.lng, camping.id);
            }, 300);
        } else {
            window.focusOnMarker(lat, lng, id);
        }
        // Push map-state bovenop de favorites-entry zodat back eerst weer de
        // favorietenlijst opent (alleen als favorites nog onderaan de stack staat).
        if (history.state && history.state.view === 'favorites') {
            history.pushState({ view: 'map', fromFavorites: true }, '');
        }
    }, 150);
};

// Leegt de favorietenlijst via de "Wis favorieten"-knop en hertekent de overlay
// (toont dan de lege-staatmelding). Zelfde gedrag als "Wis filters".
window.clearFavorites = function() {
    saveFavoriteIds([]);
    renderFavoritesOverlayContent();
};

// Vult de favorieten-overlay met dezelfde campingkaarten als de lijstweergave.
function renderFavoritesOverlayContent() {
    const container = document.getElementById('favorites-container');
    if (!container) return;
    const favs = getFavoriteIds();
    const campings = (window.staticCampsites || []).filter(c => favs.includes(c.id));

    if (campings.length === 0) {
        container.innerHTML =
            '<div style="padding:20px;text-align:center;">Nog geen favorieten. Klik op het hartje op een campingdetailpagina om een camping favoriet te maken.</div>';
        return;
    }

    const cardsHtml = campings.map(c => {
        const lat = c.lat, lng = c.lng;
        const safeName = btoa(unescape(encodeURIComponent(c.naam)));
        return `<div class="camping-card">
            <div class="card-body">
                <h3 class="camping-name-link" onclick="window.openFavoriteDetail('${c.id}'); return false;">${c.naam}</h3>
                <div class="card-location"><i class="fa-solid fa-map-pin"></i> ${c.stad}</div>
            </div>
            <div class="camping-actions">
                <a href="#" class="action-btn btn-kaart" onclick="window.openFavoriteMap(${lat},${lng}, '${c.id}'); return false;"><i class="fa-solid fa-map"></i> KAART</a>
                <a href="#" class="action-btn btn-route" onclick="window.openNavHelper(${lat}, ${lng}, '${safeName}'); return false;"><i class="fa-solid fa-route"></i> ROUTE</a>
                <a href="#" class="action-btn btn-info" onclick="window.openFavoriteDetail('${c.id}'); return false;"><i class="fa-solid fa-circle-info"></i> INFO</a>
            </div>
        </div>`;
    }).join('');
    container.innerHTML = cardsHtml;
}

function applyState(state) {
    if (!state) return;
    
    const isDesktop = isDesktopView();

    // Only hide detail container if the new state is NOT a detail view
    // This prevents the hide/show flash when updating detail content
    if (state.view !== 'detail') {
        if ($('#detail-container').hasClass('open') && window.parent !== window) {
            window.parent.postMessage({ type: 'svr-nav', panel: 'detail', open: false }, '*');
        }
        $('#detail-container').hide().removeClass('open');
    }

    // On desktop, don't hide containers - let CSS handle visibility via body classes
    if (!isDesktop) {
        // Hide main containers (mobile only)
        $('#map-container').hide();
        $('#list-container').hide();

        // Reset button visibility
        $('#locateBtn').hide();
        $('#scroll_top_btn').removeClass('visible').hide();
    }

    switch (state.view) {
        case 'list':
            isListView = true;
            if (!isDesktop) {
                $('#list-container').show();
                $('#toggleView i').attr('class', 'fas fa-map');
                $('#scroll_top_btn').addClass('visible').show();
            }
            // Desktop: hide toggle button (will show on scroll)
            if (isDesktop) {
                $('#toggleView').hide().removeClass('visible');
            }
            break;
        case 'map':
            isListView = false;
            if (!isDesktop) {
                $('#map-container').show();
                $('#toggleView i').attr('class', 'fas fa-list');
                setTimeout(() => {
                    map.invalidateSize();
                    if (window.lastMapBounds) {
                        map.fitBounds(window.lastMapBounds, { padding: [50, 50] });
                    }
                }, 100);
            }
            // Desktop: hide toggle button (will show on scroll)
            if (isDesktop) {
                $('#toggleView').hide().removeClass('visible');
            }
            // Locate button: show on map view (both mobile and desktop)
            $('#locateBtn').show();
            break;
        case 'detail':
            isListView = false;
            if (!isDesktop) {
                $('#detail-container').show(); // Ensure visible, but showSVRDetailPage handles the 'open' class
            }
            break;
        default:
            isListView = false;
            if (!isDesktop) {
                $('#map-container').show();
                $('#toggleView i').attr('class', 'fas fa-list');
                setTimeout(() => map.invalidateSize(), 100);
            }
            // Desktop: hide toggle button (will show on scroll)
            if (isDesktop) {
                $('#toggleView').hide().removeClass('visible');
            }
            // Locate button: show on map view (both mobile and desktop)
            $('#locateBtn').show();
            break;
    }
}

// --- SCROLL TO TOP LOGIC ---
$('#list-container').on('scroll', function() {
    const isDesktop = isDesktopView();
    if (isListView || isDesktop) {
        if ($(this).scrollTop() > 300) {
            $('#scroll_top_btn').css('opacity', '1');
            // Desktop: toon toggle knop als scroll-to-top
            if (isDesktop) {
                $('#toggleView').addClass('visible').show();
                $('#toggleView i').attr('class', 'fas fa-chevron-up');
            }
        } else {
            $('#scroll_top_btn').css('opacity', '0.5');
            if (isDesktop) {
                $('#toggleView').removeClass('visible').hide();
            }
        }
    }
});

$('#scroll_top_btn').on('click', function() {
    $('#list-container').animate({ scrollTop: 0 }, 400);
});

// Function to handle showing the detail page with context-aware positioning
// source: 'map' (clicked from map marker) or 'list' (clicked from list card) or 'auto' (detect)
window.showSVRDetailPage = function(objectId, source = 'auto') {
    if (window.parent !== window) {
        window.parent.postMessage({ type: 'svr-nav', panel: 'detail', open: true }, '*');
    }
    const detailOverlay = document.getElementById('detail-container');
    const detailSheet = detailOverlay.querySelector('.detail-sheet-content');
    const splashScreen = document.getElementById('detail-splash');
    const backdrop = document.getElementById('svr-filter-backdrop');
    const isDesktop = isDesktopView();

    // If a detail page is already open, replace it (prevent stacking)
    const wasDetailOpen = history.state && history.state.view === 'detail';
    
    if (wasDetailOpen) {
        // Clear existing content without animation
        const elementsToClear = Array.from(detailSheet.children);
        elementsToClear.forEach(el => {
            if (el.id !== 'detail-splash') el.remove();
        });
        // Replace the current history state instead of pushing a new one
        history.replaceState({ view: 'detail', objectId: objectId, source: source }, "", `#detail/${objectId}`);
    }

    // Determine source context
    if (source === 'auto') {
        if (isDesktop) {
            // On desktop, detect based on current mode
            if (document.body.classList.contains('list-only-mode')) {
                source = 'list';
            } else if (document.body.classList.contains('map-only-mode')) {
                source = 'map';
            } else {
                // Split mode - default to opening in map panel (right side)
                source = 'map'; // Clicked from map, open in list panel area
            }
        } else {
            source = isListView ? 'list' : 'map';
        }
    }

    // Desktop: Open as panel, Mobile: Open as fullscreen overlay
    if (isDesktop) {
        // Verwijder eventuele oude context-klassen (niet meer nodig maar veilig)
        detailOverlay.classList.remove('detail-from-map', 'detail-from-list');

        // Splash verbergen op desktop (CSS doet dit al, maar voor zekerheid)
        if (splashScreen) splashScreen.style.display = 'none';

        // Verwijder bestaande inhoud (behalve splash)
        const elementsToClear = Array.from(detailSheet.children);
        elementsToClear.forEach(el => {
            if (el.id !== 'detail-splash') el.remove();
        });

        // Open het rechter paneel
        openRightPanel('detail');

        // Synchroniseer kaart op desktop als we vanuit de lijst komen
        if (source === 'list' && window.staticCampsites) {
            const camping = window.staticCampsites.find(c => c.id === objectId);
            if (camping && window.focusOnMarker) {
                // Focus op marker met HUIDIGE zoomniveau
                window.focusOnMarker(camping.lat, camping.lng, objectId, map.getZoom());
            }
        }

        // Push state voor backknop-ondersteuning (only if not replacing)
        if (!wasDetailOpen) {
            history.pushState({ view: 'detail', objectId: objectId, source: source }, "", `#detail/${objectId}`);
        }
        renderDetail(objectId);
        return; // Vroeg terugkeren, rest van de functie is mobile-only
    }

    // CRITICAL FIX: Explicitly remove transform property and force reflow
    detailSheet.style.removeProperty('transform');
    detailSheet.style.transition = 'none';
    void detailSheet.offsetWidth;
    detailSheet.style.transition = '';

    // Clear actual content area
    if (!isDesktop) {
        const elementsToClear = Array.from(detailSheet.children).filter(el => el.id !== 'detail-splash');
        elementsToClear.forEach(el => el.remove());
    } else {
        // On desktop, clear everything except splash (which is hidden)
        const elementsToClear = Array.from(detailSheet.children);
        elementsToClear.forEach(el => el.remove());
    }

    // Show backdrop (mobile only)
    if (backdrop && !isDesktop) {
        backdrop.style.display = 'block';
        setTimeout(() => backdrop.classList.add('open'), 10);
    }

    detailOverlay.style.display = 'block';

    if (!isDesktop) {
        setTimeout(() => {
            detailOverlay.classList.add('open');
        }, 10);
    }

    // Push state and fetch content
    history.pushState({ view: 'detail', objectId: objectId, source: source }, "", `#detail/${objectId}`);
    renderDetail(objectId);
};

// Function to handle the back action for the detail sheet
window.handleDetailBack = function() {
    if (window.parent !== window) {
        window.parent.postMessage({ type: 'svr-nav', panel: 'detail', open: false }, '*');
    }
    const detailOverlay = document.getElementById('detail-container');
    const detailSheet = detailOverlay.querySelector('.detail-sheet-content');
    const backdrop = document.getElementById('svr-filter-backdrop');
    const splashScreen = document.getElementById('detail-splash');
    const isDesktop = isDesktopView();

    // Remove desktop panel context classes
    detailOverlay.classList.remove('detail-from-map', 'detail-from-list');

    if (isDesktop) {
        closeRightPanel();
        detailOverlay.classList.remove('detail-from-map', 'detail-from-list');
        detailOverlay.style.display = 'none';
        if (splashScreen) splashScreen.style.display = 'none';

        if (history.state && history.state.view === 'detail') {
            history.back();
        }
        return;
    }
        // Mobile: Animate out
        detailSheet.classList.remove('open');
        detailOverlay.classList.remove('open');
        if (backdrop) backdrop.classList.remove('open');
        if (splashScreen) splashScreen.classList.add('hide');

        setTimeout(() => {
            detailOverlay.style.display = 'none';
            if (backdrop && !document.getElementById('svr-filter-overlay').classList.contains('open')) {
                backdrop.style.display = 'none';
            }
            if (splashScreen) {
                splashScreen.classList.remove('hide');
            }
        }, 400);

    // Navigate back in history
    if (history.state && history.state.view === 'detail') {
        history.back();
    }
};


// Toont een tijdelijke toast-melding (wordt na ~2.8s automatisch verwijderd).
function showAppExitToast() {
    let toast = document.getElementById('app-exit-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'app-exit-toast';
        toast.className = 'app-exit-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = 'Nogmaals terug-drukken om de app te verlaten';
    toast.classList.add('visible');
    clearTimeout(showAppExitToast._timer);
    showAppExitToast._timer = setTimeout(() => {
        toast.classList.remove('visible');
    }, 2800);
}


// Update onpopstate to handle the sheet animation on history changes
window.onpopstate = (e) => {
    const detailOverlay = document.getElementById('detail-container');
    const detailSheet = detailOverlay.querySelector('.detail-sheet-content');
    const backdrop = document.getElementById('svr-filter-backdrop');
    const splashScreen = document.getElementById('detail-splash');
    const filterOverlay = document.getElementById('svr-filter-overlay');

    // ---- Android back-exit bevestiging (alleen mobiel + niet-geïnstalleerd) ----
    // Een 'laatste' back-press (binnen de app niets meer om terug te keren,
    // gemarkeerd via de __svrBase-entry) verlaat de app NIET meteen, maar toont
    // eerst een toast. Een tweede back binnen 3s bevestigt het verlaten.
    if (e.state && e.state.__svrBase === true && !isDesktopView()) {
        const installed = typeof window.isAppInstalled === 'function' && window.isAppInstalled();
        if (!installed) {
            const now = Date.now();
            if (exitConfirmArmed && (now - exitConfirmArmed) < 3000) {
                // Bevestigd: naar de entry vóór de basis-entry navigeren = app verlaten
                exitConfirmArmed = 0;
                history.back();
                return;
            }
            exitConfirmArmed = now;
            showAppExitToast();
            // Guard opnieuw pushen zodat een volgende back wéér deze branch raakt
            history.pushState({ view: 'map' }, "", window.location.pathname);
            setTimeout(() => { exitConfirmArmed = 0; }, 3000);
            return;
        }
    }
    // ---- Einde Android back-exit bevestiging ----

    if (e.state) {
        const isDesktopPop = isDesktopView();
        if (isDesktopPop) {
            // Op desktop: herstel body-class en sluit panelen indien nodig
            if (!e.state || (e.state.view !== 'detail' && e.state.view !== 'filters')) {
                closeRightPanel();
            }
            if (e.state && e.state.view === 'detail' && e.state.objectId) {
                // Detail heropenen via history (bijv. forward-navigatie)
                openRightPanel('detail');
                renderDetail(e.state.objectId);
            }
            if (e.state && e.state.view === 'favorites') {
                // Favorieten heropenen via history (bijv. forward-navigatie)
                window.showFavorites(false);
            }
            if (!e.state || e.state.view === 'map' || e.state.view === 'list' || e.state.view === 'split') {
                // Standaard desktop: niets te doen, kaart en lijst zijn altijd zichtbaar
                if (map) setTimeout(() => map.invalidateSize(), 100);
            }
            return; // Desktop afgehandeld, mobile-logica overslaan
        }

        applyState(e.state);
        
        // Handle Filters View
        if (e.state.view === 'filters') {
            if (window.parent !== window) {
                window.parent.postMessage({ type: 'svr-nav', panel: 'filter', open: true }, '*');
            }
            // This is reached if we navigate FORWARD to filters (rare but possible via history)
            backdrop.style.display = 'block';
            setTimeout(() => { 
                filterOverlay.classList.add('open'); 
                backdrop.classList.add('open'); 
            }, 10);
        } else {
            // For any other view, if the filters were open, hide them
            if (filterOverlay && filterOverlay.classList.contains('open')) {
                window.hideFilterOverlay();
            }
        }

        // Handle Favorites View
        const favOverlayPop = document.getElementById('svr-favorites-overlay');
        if (e.state.view === 'favorites') {
            if (window.parent !== window) {
                window.parent.postMessage({ type: 'svr-nav', panel: 'favorites', open: true }, '*');
            }
            // This is reached if we navigate FORWARD to favorites (rare but possible via history)
            backdrop.style.display = 'block';
            setTimeout(() => {
                favOverlayPop.classList.add('open');
                backdrop.classList.add('open');
            }, 10);
        } else {
            // For any other view, if favorites were open, hide them
            if (favOverlayPop && favOverlayPop.classList.contains('open')) {
                window.hideFavoritesOverlay();
            }
        }

        // Handle Detail View
        if (e.state.view === 'detail' && e.state.objectId) {
            if (window.parent !== window) {
                window.parent.postMessage({ type: 'svr-nav', panel: 'detail', open: true }, '*');
            }
            // Show splash and start typewriter effect
            if (splashScreen) {
                splashScreen.classList.remove('hide');
                typewriterEffect('detail-splash-text', 'Kamperen bij de boer');
                 // Clear actual content area, but don't remove splash
                const elementsToClear = Array.from(detailSheet.children).filter(el => el.id !== 'detail-splash');
                elementsToClear.forEach(el => el.remove());
            }

            if (backdrop) {
                backdrop.style.display = 'block';
                setTimeout(() => backdrop.classList.add('open'), 10);
            }
            detailOverlay.style.display = 'block';
            setTimeout(() => {
                detailOverlay.classList.add('open');
                detailSheet.classList.add('open'); // This will trigger the slide up animation
                renderDetail(e.state.objectId); // This will fetch content and hide splash
            }, 10);
        } else if (e.state.view === 'list' || e.state.view === 'map') {
            if (detailOverlay.classList.contains('open') && window.parent !== window) {
                window.parent.postMessage({ type: 'svr-nav', panel: 'detail', open: false }, '*');
            }
            detailSheet.classList.remove('open');
            detailOverlay.classList.remove('open');
            if (backdrop && !filterOverlay.classList.contains('open')) backdrop.classList.remove('open');
            if (splashScreen) splashScreen.classList.add('hide'); // Hide splash instantly on state change

            setTimeout(() => {
                detailOverlay.style.display = 'none';
                if (backdrop && !filterOverlay.classList.contains('open')) backdrop.style.display = 'none';
            }, 400);
        }
    } else {
        // Fallback if state is null (e.g., initial page load or unmanaged history entry)
        applyState({ view: 'map' }); // Default to map view
        
        if (filterOverlay && filterOverlay.classList.contains('open')) {
            window.hideFilterOverlay();
        }

        const favOverlayNull = document.getElementById('svr-favorites-overlay');
        if (favOverlayNull && favOverlayNull.classList.contains('open')) {
            window.hideFavoritesOverlay();
        }

        if (detailOverlay.classList.contains('open') && window.parent !== window) {
            window.parent.postMessage({ type: 'svr-nav', panel: 'detail', open: false }, '*');
        }

        detailSheet.classList.remove('open');
        detailOverlay.classList.remove('open');
        if (backdrop) backdrop.classList.remove('open');
        if (splashScreen) splashScreen.classList.add('hide'); // Hide splash instantly on fallback

        setTimeout(() => {
            detailOverlay.style.display = 'none';
            if (backdrop) backdrop.style.display = 'none';
        }, 400);
    }
};

// Toggle knop:
// - Desktop: scroll-to-top voor lijst (wordt zichtbaar bij scrollen)
// - Mobile: wissel tussen kaart en lijst
$('#toggleView').on('click', () => {
    const isDesktop = isDesktopView();

    if (isDesktop) {
        // Desktop: scroll naar boven
        $('#list-container').animate({ scrollTop: 0 }, 400);
    } else {
        // Mobile: toggle tussen kaart en lijst
        isListView = !isListView;
        applyState({ view: isListView ? 'list' : 'map' });
        history.pushState({ view: isListView ? 'list' : 'map' }, "");
    }
});

// Helper function to set desktop view mode
function setDesktopViewMode(mode) {
    // Op desktop is er maar één layout: kaart links, lijst/paneel rechts.
    // De body-class split-mode/map-only/list-only is niet meer nodig.
    // We houden 'split-mode' als standaard body-class voor backward compatibility.
    document.body.classList.remove('split-mode', 'map-only-mode', 'list-only-mode');
    document.body.classList.add('split-mode');
    isListView = false;

    // Sluit eventuele open panelen
    closeRightPanel();

    // Zorg dat de kaart de juiste grootte heeft
    setTimeout(() => {
        if (map && typeof map.invalidateSize === 'function') {
            map.invalidateSize();
        }
    }, 100);
}

/**
 * Opent een paneel rechts op desktop (detail of filter).
 * Sluit eerst het andere paneel als dat open is.
 * @param {'detail'|'filter'} type
 */
function openRightPanel(type) {
    const isDesktop = isDesktopView();
    if (!isDesktop) return; // Mobile heeft eigen logica

    const detailEl = document.getElementById('detail-container');
    const filterEl = document.getElementById('svr-filter-overlay');
    const favEl = document.getElementById('svr-favorites-overlay');

    // Sluit beide eerst (schone lei)
    if (window.parent !== window) {
        if (detailEl.classList.contains('open') && type !== 'detail') {
            window.parent.postMessage({ type: 'svr-nav', panel: 'detail', open: false }, '*');
        }
        if (filterEl.classList.contains('open') && type !== 'filter') {
            window.parent.postMessage({ type: 'svr-nav', panel: 'filter', open: false }, '*');
        }
        if (favEl.classList.contains('open') && type !== 'favorites') {
            window.parent.postMessage({ type: 'svr-nav', panel: 'favorites', open: false }, '*');
        }
    }

    detailEl.style.display = 'none';
    detailEl.classList.remove('open');
    filterEl.style.display = 'none';
    filterEl.classList.remove('open');
    favEl.style.display = 'none';
    favEl.classList.remove('open');

    // Toon de gevraagde met FLEX (belangrijk voor header fix)
    if (type === 'detail') {
        detailEl.style.display = 'flex';
        detailEl.classList.add('open');
    } else if (type === 'filter') {
        filterEl.style.display = 'flex';
        filterEl.classList.add('open');
    } else if (type === 'favorites') {
        favEl.style.display = 'flex';
        favEl.classList.add('open');
    }

    document.body.classList.add('panel-open');
    // Desktop: verberg toggle knop als paneel open is
    if (isDesktop) {
        $('#toggleView').hide();
    } else {
        // Mobile: toon sluit-icoon
        $('#toggleView i').attr('class', 'fas fa-xmark');
    }
}

/**
 * Sluit het actieve rechter paneel en toont de lijst weer.
 */
function closeRightPanel() {
    const isDesktop = isDesktopView();
    if (!isDesktop) return;

    const detailEl = document.getElementById('detail-container');
    const filterEl = document.getElementById('svr-filter-overlay');
    const favEl = document.getElementById('svr-favorites-overlay');

    if (window.parent !== window) {
        if (detailEl.classList.contains('open')) {
            window.parent.postMessage({ type: 'svr-nav', panel: 'detail', open: false }, '*');
        }
        if (filterEl.classList.contains('open')) {
            window.parent.postMessage({ type: 'svr-nav', panel: 'filter', open: false }, '*');
        }
        if (favEl.classList.contains('open')) {
            window.parent.postMessage({ type: 'svr-nav', panel: 'favorites', open: false }, '*');
        }
    }

    detailEl.style.display = 'none';
    detailEl.classList.remove('open');
    filterEl.style.display = 'none';
    filterEl.classList.remove('open');
    favEl.style.display = 'none';
    favEl.classList.remove('open');

    document.body.classList.remove('panel-open');
    // Desktop: verberg toggle knop (wordt getoond bij scrollen)
    $('#toggleView').hide().removeClass('visible');
}

// Expose voor gebruik in event handlers
window.closeRightPanel = closeRightPanel;

// Initialiseer desktop layout
if (isDesktopView()) {
    document.body.classList.add('split-mode');
    // Forceer schone lei voor panelen
    closeRightPanel();
    // Zorg dat kaart correct geladen wordt
    setTimeout(() => { if (map) map.invalidateSize(); }, 200);
    // Toon locate button op desktop
    $('#locateBtn').show();
}

// Wissel bij het draaien van een tablet (rechtop <-> liggend) automatisch
// tussen de mobiele en de desktop-layout.
let lastDesktopMode = isDesktopView();
function applyViewportMode() {
    const nowDesktop = isDesktopView();
    if (nowDesktop === lastDesktopMode) return;
    lastDesktopMode = nowDesktop;

    if (nowDesktop) {
        // Mobiel -> desktop (tablet liggend): split-layout activeren.
        document.body.classList.add('split-mode');
        document.body.classList.remove('map-only-mode', 'list-only-mode');
        // Mobiele applyState heeft containers mogelijk inline verborgen; op
        // desktop zijn beide panelen tegelijk zichtbaar.
        $('#map-container').show();
        $('#list-container').show();
        closeRightPanel();
    } else {
        // Desktop -> mobiel (tablet rechtop): panelen opruimen en terug naar map-view.
        document.body.classList.remove('split-mode', 'map-only-mode', 'list-only-mode', 'panel-open');
        ['detail-container', 'svr-filter-overlay', 'svr-favorites-overlay'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.style.display = ''; el.classList.remove('open'); }
        });
        const backdrop = document.getElementById('svr-filter-backdrop');
        if (backdrop) { backdrop.style.display = 'none'; backdrop.classList.remove('open'); }
        try { history.replaceState({ view: 'map' }, "", window.location.pathname); } catch (e) {}
        applyState({ view: 'map' });
    }

    setTimeout(() => {
        if (map && typeof map.invalidateSize === 'function') {
            map.invalidateSize();
        }
    }, 200);
}

let resizeTimeout;
const handleViewportChange = () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        applyViewportMode();
        if (map && typeof map.invalidateSize === 'function') {
            map.invalidateSize();
        }
    }, 100);
};
window.addEventListener('resize', handleViewportChange);
const orientationQuery = window.matchMedia('(orientation: landscape)');
if (typeof orientationQuery.addEventListener === 'function') {
    orientationQuery.addEventListener('change', handleViewportChange);
} else if (typeof orientationQuery.addListener === 'function') {
    orientationQuery.addListener(handleViewportChange);
}
const $searchInput = $('#searchInput'); const $suggestionsList = $('#suggestionsList');

// Clear search input on click if it has a value
$searchInput.on('click', function() {
    if ($(this).val().length > 0) {
        $(this).val('');
        $suggestionsList.hide();
    }
});

// Trigger search on Enter key
$searchInput.on('keydown', function(e) {
    if (e.key === 'Enter') {
        $suggestionsList.hide();
        window.performSearch();
    }
});

// Trigger search on Icon click
$searchInput.on('input', function() {
    const q = $(this).val();
    $('#searchResetBtn').toggle(q.length > 0);
    if (q.length < 3) { $suggestionsList.hide(); return; }
    const suggestions = window.getSuggestionsLocal(q);
    $suggestionsList.empty();
    if (suggestions.length === 0) { $suggestionsList.hide(); return; }
    suggestions.forEach(suggestion => {
        const $li = $('<li class="suggestion-item"></li>');
        if (suggestion.type === 'camping') {
            $li.append($('<span class="suggestion-camp-icon"></span>'));
            $li.append(document.createTextNode(' ' + suggestion.label));
        } else {
            $li.text(`📍 ${suggestion.label}`);
        }
        $li.on('click', (e) => {
            e.stopPropagation();
            window._searchIntent = suggestion.type;
            $searchInput.val(suggestion.value);
            $suggestionsList.hide();
            // Desktop: sluit een open detail-/filterpaneel zodat de zoekresultaten
            // zichtbaar worden en ruim de bijbehorende history-entry op.
            if (isDesktopView()) {
                window.closeRightPanel();
                if (history.state && (history.state.view === 'detail' || history.state.view === 'filters' || history.state.view === 'favorites')) {
                    history.back();
                }
            }
            window.performSearch();
        });
        $suggestionsList.append($li);
    });
    $suggestionsList.show();
});

window.performSearch = async function(forceAPI = false) {
    if (isSearching) return;
    isSearching = true;

    // Hide keyboard
    $searchInput.blur();

    const q = $searchInput.val().trim();
    let sLat = 52.1326, sLng = 5.2913;

    // De intentie uit een suggestie-klik (eenmalig verbruiken). Bij een expliciet
    // gekozen plaats ('place') gaat de zoekopdracht altijd naar die plaats, bij een
    // expliciet gekozen camping ('camping') direct naar de lokale campingnamen.
    const searchIntent = window._searchIntent;
    window._searchIntent = null;

    // Expliciet gekozen camping-suggestie: direct lokaal op naam zoeken.
    if (searchIntent === 'camping' && q) {
        const matches = window.findLocalCampingMatches(q);
        if (matches.length > 0) {
            // Campingnaam-zoek: actieve filters wissen zodat de camping altijd
            // getoond wordt, ongeacht welke filters er actief waren.
            if (window.currentFilters && window.currentFilters.length > 0) {
                window.currentFilters = [];
                const fOverlay = document.getElementById('svr-filter-overlay');
                if (fOverlay) fOverlay.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
                const btn = document.getElementById('filterBtn');
                if (btn) { btn.style.background = 'white'; btn.style.color = '#333'; }
                window.updateActiveFiltersUI([], 'both');
            }
            renderCampingResults(matches, { campingName: true });
            isSearching = false;
            return;
        }
    }

    // Plaats-primair: de zoekhulp is vooral op plaatsnaam gericht, dus eerst
    // de plaats proberen te geocoden — niet eerst naar campingnamen kijken.
    let coords = null;
    if (q) {
        coords = await window.getCoordinatesWeb(q);
        if (coords) { sLat = coords.latitude; sLng = coords.longitude; }
    } else if (currentUserLatLng) {
        sLat = currentUserLatLng.lat; sLng = currentUserLatLng.lng;
    }

    // Plaats niet gevonden: val terug op campingnamen uit de lokale dataset
    // (niet bij een expliciet gekozen plaats-suggestie). Werkt ook offline.
    if (!coords && q && searchIntent !== 'place') {
        const matches = window.findLocalCampingMatches(q);
        if (matches.length > 0) {
            // Campingnaam-zoek (fallback): actieve filters wissen zodat de
            // camping altijd getoond wordt.
            if (window.currentFilters && window.currentFilters.length > 0) {
                window.currentFilters = [];
                const fOverlay = document.getElementById('svr-filter-overlay');
                if (fOverlay) fOverlay.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
                const btn = document.getElementById('filterBtn');
                if (btn) { btn.style.background = 'white'; btn.style.color = '#333'; }
                window.updateActiveFiltersUI([], 'both');
            }
            renderCampingResults(matches, { campingName: true });
            isSearching = false;
            return;
        }
    }

    // Echte foutmelding als noch plaats noch campingnaam iets opleverde.
    if (q && !coords) {
        const originalPlaceholder = $searchInput.attr('placeholder');
        const notFoundMsg = !navigator.onLine ? 'Geen internetverbinding...' : 'Plaats niet gevonden...';
        $searchInput.val('').attr('placeholder', notFoundMsg).addClass('search-error');
        setTimeout(() => {
            $searchInput.attr('placeholder', originalPlaceholder).removeClass('search-error');
        }, 3000);
        isSearching = false;
        return;
    }

    // Update de rode punaise naar de nieuwe locatie
    placeSearchMarker(sLat, sLng);

    // UNIFIED SEARCH & FILTER LOGIC (Static Delivery)
    if (window.staticCampsites) {
        logDebug(`Unified Search/Filter: ${q ? "Zoeken naar " + q : "Alleen filters"}`);
        
        let filtered = window.staticCampsites;
        
        // 1. Filter op geselecteerde faciliteiten/landen/gebieden
        if (window.currentFilters && window.currentFilters.length > 0) {
            filtered = window.staticCampsites.filter(c => {
                // Alle geselecteerde filters moeten aanwezig zijn in de camping data
                return window.currentFilters.every(f => c.filters && c.filters.includes(f));
            });
        }

        // 2. Map naar formaat voor renderResults and bereken afstanden
        const objects = filtered.map(c => ({
            id: c.id,
            geometry: { coordinates: [c.lng, c.lat] },
            properties: {
                name: c.naam,
                city: c.stad,
                type_camping: c.type
            },
            distM: calculateDistance(sLat, sLng, c.lat, c.lng)
        }));

        // 3. Sorteer op afstand vanaf de zoeklocatie (rode punaise)
        objects.sort((a, b) => a.distM - b.distM);
        
        // 4. Toon resultaten
        renderResults(objects, sLat, sLng);
        
        window.hasDataOnScreen = true;
        isSearching = false;
        setTimeout(() => map.invalidateSize(), 500);
        return;
    } else {
        logDebug("Fout: Geen statische campingdata beschikbaar.");
        isSearching = false;
    }
}

async function renderDetail(objectId) {
    const detailSheet = document.querySelector('#detail-container .detail-sheet-content');
    const splashScreen = document.getElementById('detail-splash');

    // Ensure splash is visible before fetch
    if (splashScreen) {
        splashScreen.classList.remove('hide');
        // Typewriter effect already started in showSVRDetailPage
    }

    try {
        const PROXY_BASE_URL = 'https://svr-proxy-worker.e60-manuels.workers.dev';
        const detailUrl = `${PROXY_BASE_URL}/object/${objectId}`;

        logDebug(`Fetching SVR detail page for ${objectId} via proxy: ${detailUrl}`);
        const htmlContent = await fetchWithRetry(detailUrl);

        if (!htmlContent || htmlContent.includes("Internal Server Error")) {
            throw new Error("SVR response invalid or empty");
        }

        // --- SESSION VALIDITY FALLBACK ---
        // Defensive check: the Worker now detects an invalid/expired session for
        // /object/* requests and returns HTTP 401 (handled above by fetchWithRetry's
        // 401 branch, which already throws before we get here). This check remains
        // as a safety net in case the Worker's detection ever misses a case and the
        // fallback HTML still slips through with a 200.
        if (htmlContent.includes("Mail met link is verstuurd") || htmlContent.includes("We hebben je zojuist een mailtje gestuurd")) {
            logDebug(`Sessie ongeldig/verlopen gedetecteerd bij detailpagina: ${detailUrl}`);
            window.logoutSVR("Sessie verlopen");
            throw new Error("Sessie verlopen, log opnieuw in.");
        }
        // --- END: SESSION VALIDITY FALLBACK ---

        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, 'text/html');

        const bodyContent = doc.body;

        bodyContent.querySelectorAll('nav, header, .navbar, .container-fluid.p-0.text-center, .modal, #map_detail').forEach(el => {
            el.remove();
        });

        if (bodyContent.innerHTML.trim().length > 0) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = bodyContent.innerHTML;

            tempDiv.querySelectorAll('script, link').forEach(el => el.remove());

            tempDiv.querySelectorAll('img').forEach(img => {
                img.classList.remove('d-none');
                img.removeAttribute('loading');
            });

            // De oorspronkelijke svr.nl "Favoriet"-knop (rechts van de campingnaam,
            // zoals op mobiel) blijven gebruiken, maar ombouwen naar de PWA-toggle:
            // set_fav bestaat in de PWA niet (scripts worden gestript). We koppelen
            // de knop aan de lokale favorietenfunctie en tonen meteen de juiste
            // staat: leeg hartje (alleen rode rand) = geen favoriet, vol rood
            // hartje = favoriet.
            tempDiv.querySelectorAll('button[id^="heart_"], button[onclick*="set_fav"]').forEach(btn => {
                btn.removeAttribute('onclick');
                btn.setAttribute('onclick', `window.toggleSVRFavorite('${objectId}'); return false;`);
                const icon = btn.querySelector('i');
                if (icon) {
                    const isFav = window.isSVRFavorite(objectId);
                    icon.classList.toggle('fa-solid', isFav);
                    icon.classList.toggle('fa-regular', !isFav);
                }
            });

            const SVR_BASE = 'https://www.svr.nl';
            tempDiv.querySelectorAll('[src], [href]').forEach(element => {
                const attr = element.hasAttribute('src') ? 'src' : 'href';
                let url = element.getAttribute(attr);
                if (url && url.startsWith('/') && !url.startsWith('//')) {
                    element.setAttribute(attr, SVR_BASE + url);
                }

                // NEW: Ensure all links open in a new tab/Chrome Custom Tab
                if (element.tagName === 'A' && element.hasAttribute('href')) {
                    element.setAttribute('target', '_blank');
                    element.setAttribute('rel', 'noopener noreferrer'); // Security best practice
                }
            });

            const containerStyle = document.createElement('style');
            containerStyle.innerHTML = `
                #detail-container .container, #detail-container .container-fluid {
                    width: 100% !important; max-width: 100vw !important;
                    padding: 0 !important; margin: 0 !important;
                    box-sizing: border-box !important;
                }
                #detail-container .row {
                    width: 100% !important; margin: 0 !important; padding: 0 !important;
                    display: flex !important; flex-direction: column !important;
                    box-sizing: border-box !important;
                }
                #detail-container .col-md-8, #detail-container .col-md-4,
                #detail-container .col-sm-8, #detail-container .col-sm-4,
                #detail-container .col-sm-6, #detail-container .col-sm-12,
                #detail-container .col-6, #detail-container .col-12 {
                    width: 100% !important; max-width: 100% !important;
                    padding: 10px 15px !important; margin: 0 !important;
                    box-sizing: border-box !important;
                    float: none !important;
                    display: block !important;
                }
                #detail-container img, #detail-container iframe {
                    max-width: 100% !important;
                    height: auto !important;
                    box-sizing: border-box !important;
                }
                /* Specific fix for iframe aspect ratio */
                #detail-container iframe { aspect-ratio: 16 / 9; }

                /* Fix for Tarieven (Pricing Table) */
                #detail-container .object_pricing {
                    font-size: 16px !important;
                    width: 100% !important;
                    overflow-x: auto !important;
                }
                #detail-container .object_pricing table {
                    width: 100% !important;
                    table-layout: auto !important;
                    border-collapse: collapse !important;
                }
                #detail-container .object_pricing td {
                    width: auto !important; /* Overrule hardcoded 380px */
                    padding: 8px 5px !important;
                    border-bottom: 1px solid #eee !important;
                }
                #detail-container .object_pricing td:not(:first-child) {
                    width: 65px !important; /* Fixed width for 'Normaal' and 'All-in' columns */
                    text-align: center !important;
                }

                /* Fix for Faciliteiten (Facilities List) */
                #detail-container .restorelines {
                    line-height: 1.6 !important;
                    font-size: 16px !important;
                    padding-left: 0 !important; /* Force 0 to align with description */
                    padding-top: 2px !important;
                    padding-bottom: 2px !important;
                    display: block !important;
                }
                /* Remove column padding for facilities to prevent double indentation */
                #detail-container .col-sm-12:has(.restorelines),
                #detail-container .col-sm-6:has(.restorelines),
                #detail-container .col-12:has(.restorelines),
                #detail-container .col-6:has(.restorelines) {
                    padding-left: 0 !important;
                }

                /* Align and expand the yellow header bar for Facilities */
                #detail-container .p-2[style*="background-color:#FDCC01"] {
                    padding-left: 0 !important;
                    margin-left: -15px !important;
                    width: calc(100% + 30px) !important;
                    box-sizing: border-box !important;
                }
                #detail-container .p-2[style*="background-color:#FDCC01"] h5 {
                    margin: 0 !important;
                    padding-left: 15px !important; /* Keep text indent in the bar */
                    font-family: 'Befalow', sans-serif !important;
                }

                #detail-container .footer {
                    background-color: #008AD3 !important;
                    color: black !important;
                    padding: 3rem 1.5rem !important;
                    margin-top: 2rem !important;
                }
                #detail-container .footer a { color: black !important; text-decoration: underline; }
                #detail-container .footer h3 { color: black !important; font-family: 'Befalow', sans-serif; }

                #detail-container .pt-5 { padding-top: 1.5rem !important; }

                /* Navigation Arrows */
                #detail-container .swiper-button-prev, #detail-container .swiper-button-next {
                    color: white; background: rgba(0,0,0,0.3);
                    width: 30px; height: 30px; border-radius: 50%;
                    font-size: 15px; font-weight: bold;
                }
                #detail-container .swiper-button-prev:after, #detail-container .swiper-button-next:after {
                    font-size: 15px;
                }
            `;
            tempDiv.prepend(containerStyle);

            const closeBtn = `<div class="detail-header" style="position: sticky; top: 0; background: #FDCC01; padding: 10px; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; z-index: 10001; box-shadow: 0 2px 5px rgba(0,0,0,0.1); cursor: grab;">
                <div style="width: 40px; height: 5px; background: #BBB; border-radius: 3px; margin-bottom: 8px;"></div>
                <div style="width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 0 5px;">
                    <button onclick="window.handleDetailBack()" style="background: none; border: none; font-size: 20px; cursor: pointer; padding: 5px; color: #333;"><i class="fas fa-arrow-left"></i></button>
                    <h3 style="margin: 0; font-family: 'Befalow'; color: #333; font-size: 1.2rem;">Camping Details</h3>
                    <div style="width: 30px;"></div>
                </div>
            </div>`;

            // Hide splash and then append content after a short delay for smooth transition
            if (splashScreen) {
                splashScreen.classList.add('hide'); // Start fade out
                setTimeout(() => {
                    // Remove splash from DOM after it fades out, then add content
                    // Keep the actual splash element in the DOM (but hidden) so it can be reused
                    // The direct children of detailSheet are now just the splash, which is hidden,
                    // and any previously loaded content (which we need to remove before appending new).
                    const elementsToClear = Array.from(detailSheet.children).filter(el => el.id !== 'detail-splash');
                    elementsToClear.forEach(el => el.remove());

                    $(detailSheet).append(closeBtn);
                    detailSheet.appendChild(tempDiv);

                    // Re-enable swipe
                    window.enableSwipeToClose(detailSheet, window.handleDetailBack, '.detail-header');

                    // Inject scripts
                    setTimeout(() => {
                        try {
                            logDebug("Initializing bulletproof Swiper...");

                            const mainImageContainer = detailSheet.querySelector('div.row.m-0.p-4.mt-0');

                            if (mainImageContainer && !mainImageContainer.dataset.swiperInitialized) {
                                let images = [];
                                const imageCards = mainImageContainer.querySelectorAll('div.card');

                                imageCards.forEach(card => {
                                    const img = card.querySelector('img');
                                    if (img && img.src) {
                                        images.push(img.src);
                                    }
                                });

                                logDebug(`Found ${images.length} images for carousel.`);

                                if (images.length > 0) {
                                    mainImageContainer.dataset.swiperInitialized = 'true';

                                    // Detect connection type for adaptive loading
                                    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
                                    const isSlowConnection = conn && (conn.saveData || ['slow-2g', '2g', '3g'].includes(conn.effectiveType));
                                    const isMobile = conn && conn.type === 'cellular';
                                    const useLazyLoading = isSlowConnection || isMobile;

                                    logDebug(`Carousel loading mode: ${useLazyLoading ? 'Lazy (Mobile/Slow)' : 'Eager (WiFi)'}`);

                                    const swiperContainer = document.createElement('div');
                                    swiperContainer.className = 'swiper svr-detail-swiper';
                                    swiperContainer.style.width = '100%';
                                    swiperContainer.style.height = '240px';
                                    swiperContainer.style.background = '#f8f8f8';
                                    swiperContainer.style.position = 'relative';
                                    swiperContainer.style.touchAction = 'pan-y';
                                    swiperContainer.style.overflow = 'hidden';
                                    swiperContainer.style.marginBottom = '20px';

                                    const swiperWrapper = document.createElement('div');
                                    swiperWrapper.className = 'swiper-wrapper';

                                    images.forEach((src, index) => {
                                        const swiperSlide = document.createElement('div');
                                        swiperSlide.className = 'swiper-slide';
                                        swiperSlide.style.display = 'flex';
                                        swiperSlide.style.alignItems = 'center';
                                        swiperSlide.style.justifyContent = 'center';
                                        swiperSlide.style.width = '100%';
                                        swiperSlide.style.height = '100%';

                                        const imgElement = document.createElement('img');
                                        
                                        // First image is ALWAYS eager. Others are lazy on mobile/slow.
                                        if (index === 0 || !useLazyLoading) {
                                            imgElement.src = src;
                                        } else {
                                            imgElement.dataset.src = src;
                                            imgElement.className = 'swiper-lazy';
                                            
                                            // Preloader for lazy images
                                            const preloader = document.createElement('div');
                                            preloader.className = 'swiper-lazy-preloader';
                                            swiperSlide.appendChild(preloader);
                                        }

                                        imgElement.style.maxWidth = '100%';
                                        imgElement.style.maxHeight = '100%';
                                        imgElement.style.objectFit = 'contain';

                                        swiperSlide.appendChild(imgElement);
                                        swiperWrapper.appendChild(swiperSlide);
                                    });

                                    swiperContainer.appendChild(swiperWrapper);

                                    const pagination = document.createElement('div');
                                    pagination.className = 'swiper-pagination';
                                    swiperContainer.appendChild(pagination);

                                    const prevBtn = document.createElement('div');
                                    prevBtn.className = 'swiper-button-prev';
                                    swiperContainer.appendChild(prevBtn);

                                    const nextBtn = document.createElement('div');
                                    nextBtn.className = 'swiper-button-next';
                                    swiperContainer.appendChild(nextBtn);

                                    mainImageContainer.parentNode.replaceChild(swiperContainer, mainImageContainer);

                                    if (typeof Swiper !== 'undefined') {
                                        new Swiper(swiperContainer, {
                                            direction: 'horizontal',
                                            loop: images.length > 1,
                                            speed: 400,
                                            roundLengths: true,
                                            observer: true,
                                            observeParents: true,
                                            // Adaptive Lazy Loading Settings
                                            lazy: useLazyLoading ? {
                                                loadPrevNext: true,
                                                loadPrevNextAmount: 2,
                                                loadOnTransitionStart: true
                                            } : false,
                                            preloadImages: !useLazyLoading,
                                            pagination: {
                                                el: '.swiper-pagination',
                                                clickable: true,
                                            },
                                            navigation: {
                                                nextEl: '.swiper-button-next',
                                                prevEl: '.swiper-button-prev',
                                            },
                                            threshold: 10,
                                            followFinger: true,
                                            touchStartPreventDefault: false,
                                            on: {
                                                init: function () {
                                                    const self = this;
                                                    setTimeout(() => self.update(), 500);
                                                    setTimeout(() => self.update(), 1500);
                                                },
                                            },
                                        });
                                        logDebug("Adaptive Swiper initialized successfully.");
                                    }
                                }
                            } else {
                                const carousel = detailSheet.querySelector('.carousel');
                                if (carousel) {
                                    logDebug("Fallback: Converting Bootstrap Carousel to Swiper...");
                                    carousel.classList.remove('carousel', 'slide', 'pointer-event');
                                    carousel.classList.add('swiper');

                                    const inner = carousel.querySelector('.carousel-inner');
                                    if (inner) {
                                        inner.classList.remove('carousel-inner');
                                        inner.classList.add('swiper-wrapper');

                                        inner.querySelectorAll('.carousel-item').forEach((item, idx) => {
                                            item.classList.remove('carousel-item', 'active');
                                            item.classList.add('swiper-slide');
                                            item.style.display = 'block';
                                            item.style.float = 'none';
                                            item.style.marginRight = '0';
                                            item.style.height = 'auto';
                                        });
                                    }

                                    carousel.querySelectorAll('.carousel-control-prev, .carousel-control-next').forEach(el => el.remove());

                                    if (!carousel.querySelector('.swiper-pagination')) {
                                        const pagination = document.createElement('div');
                                        pagination.className = 'swiper-pagination';
                                        carousel.appendChild(pagination);
                                    }

                                    if (typeof Swiper !== 'undefined') {
                                        new Swiper(carousel, {
                                            loop: true,
                                            autoHeight: true,
                                            pagination: {
                                                el: '.swiper-pagination',
                                                clickable: true,
                                            },
                                        });
                                    }
                                }
                            }

                            detailSheet.querySelectorAll('.befalow').forEach(el => el.style.setProperty('font-family', "'Befalow', sans-serif", 'important'));
                        } catch(err) { console.error("Error during post-injection script execution:", err); }
                    }, 600);
                }, 500); // Wait for splash fade out transition
            }
        } else { throw new Error("Geen detailinhoud gevonden."); }
    } catch (e) {
        logDebug("Detail Fout: " + e.message);
        // Ensure splash is hidden if an error occurs
        if (splashScreen) splashScreen.classList.add('hide');
        const elementsToClear = Array.from(detailSheet.children).filter(el => el.id !== 'detail-splash');
        elementsToClear.forEach(el => el.remove());
        const detailErrorMsg = !navigator.onLine
            ? 'Detailpagina\'s zijn alleen beschikbaar met een internetverbinding.'
            : e.message;
        $(detailSheet).append(`<div style="padding:40px;text-align:center;"><h3>${!navigator.onLine ? 'Geen internetverbinding' : 'Fout'}</h3><p>${detailErrorMsg}</p><button onclick="window.handleDetailBack()">Terug</button></div>`);
    }
}

// Bouwt één camping-marker met dezelfde popup-opmaak als de zoekresultaten
// (Android-app style). Herbruikt door renderResults en door de fallback in
// focusOnMarker, die markers toevoegt wanneer een camping (nog) niet op de
// kaart staat.
function buildCampingMarker(obj) {
    const g = obj.geometry; if (!g) return null;
    const lat = g.coordinates[1], lng = g.coordinates[0];
    const p = obj.properties;
    const safeName = btoa(unescape(encodeURIComponent(p.name)));
    const marker = L.marker([lat, lng]);
    marker.objId = obj.id; // Store ID for reliable lookup

    const address = p.address ? `${p.address}, ${p.city}` : p.city;
    // Bereken afstand: bij normale zoekopdracht vanaf het zoekcentrum, in favorieten-context
    // (suppressDistance) vanaf de GPS-positie van de gebruiker.
    const distDisplay = window.suppressDistance && currentUserLatLng
        ? (calculateDistance(currentUserLatLng.lat, currentUserLatLng.lng, lat, lng) / 1000).toFixed(1)
        : (obj.distM / 1000).toFixed(1);
    const distLine = window.suppressDistance && !currentUserLatLng
        ? ''
        : `<div style="font-size: 13px; color: #333; margin-top: 2px;"><i class="fa-solid fa-map-pin" style="color: #c0392b;"></i> Afstand: ${distDisplay} km</div>`;

    const popup = `<div style="min-width: 220px;">
        <div style="word-wrap: break-word; margin-top: -5px;">
            <h5 onclick="window.showSVRDetailPage('${obj.id}', 'map')" style="margin: 0; padding: 0; font-family: 'Befalow', sans-serif; font-size: 25px; font-weight: normal; color: #008AD3; cursor: pointer;">${p.name}</h5>
            <div style="font-size: 13px; color: #666; margin-top: 0px;">${address}</div>
            ${distLine}
            <div class="camping-actions" style="display: flex; margin: 8px -15px -15px -15px; border-top: 1px solid #eee;">
                <a href="#" class="action-btn btn-route" style="flex: 1; text-align: center; padding: 6px 0; color: #c0392b; text-decoration: none; font-weight: bold; font-size: 14px; border-right: 1px solid #eee;" onclick="window.openNavHelper(${lat}, ${lng}, '${safeName}'); return false;"><i class="fa-solid fa-route"></i> ROUTE</a>
                <a href="#" class="action-btn btn-info" style="flex: 1; text-align: center; padding: 6px 0; color: #008AD3; text-decoration: none; font-weight: bold; font-size: 14px;" onclick="window.showSVRDetailPage('${obj.id}', 'map'); return false;"><i class="fa-solid fa-circle-info"></i> INFO</a>
            </div>
        </div>
    </div>`;

    marker.bindPopup(popup);
    return marker;
}

window.focusOnMarker = function(lat, lng, objectId, targetZoom = 16) {
    const isDesktop = isDesktopView();
    if (!isDesktop) {
        applyState({ view: 'map' });
    }
    // Op desktop: kaart is altijd zichtbaar, geen state-switch nodig
    const targetLatLng = L.latLng(lat, lng);
    window.skipFitBounds = true;

    // Find the marker by ID - check both layers
    let foundMarker = null;
    let markerLayer = null; // Track which layer the marker belongs to

    markerCluster.eachLayer(m => {
        if (m.objId === objectId) {
            foundMarker = m;
            markerLayer = 'cluster';
        }
    });
    if (!foundMarker) {
        top10Layer.eachLayer(m => {
            if (m.objId === objectId) {
                foundMarker = m;
                markerLayer = 'top10';
            }
        });
    }

    const openPopupAfterAnimation = () => {
        // Wait for map animation to complete before opening popup
        setTimeout(() => {
            if (foundMarker) {
                foundMarker.openPopup();
            }
        }, 300);
    };

    if (foundMarker) {
        if (markerLayer === 'cluster') {
            // Marker is in cluster - zoomToShowLayer handles everything
            // It will zoom/pan to show the marker and expand clusters if needed
            markerCluster.zoomToShowLayer(foundMarker, () => {
                // Callback after cluster animation completes - just open popup
                openPopupAfterAnimation();
            });
        } else {
            // Marker is in top10Layer (already visible, not clustered)
            // Pan to location with specified zoom, then open popup
            map.setView(targetLatLng, targetZoom, { animate: true });
            openPopupAfterAnimation();
        }
    } else {
        // Marker niet op de kaart: de camping + dichtstbijzijnde buren als markers
        // toevoegen (zonder de resultatenlijst te vervangen) zodat de marker-met-popup
        // tóch getoond kan worden. Dit treedt o.a. op wanneer een gekozen favoriet
        // buiten het huidige zoekvenster ligt — na een campingnaam-zoekopdracht staan
        // er maar een handjevol markers op de kaart, na een plaatsnaam-zoekopdracht
        // alle campings. Via Kaart/Info in de favorietenlijst wordt de popup nu ook
        // in het eerste geval geopend.
        const camping = (window.staticCampsites || []).find(c => c.id === objectId);
        if (camping) {
            const neighbors = nearestCampingsAround(camping.lat, camping.lng, 10);
            const added = [];
            window.suppressDistance = true;
            window.suppressSearchMarker = true;
            neighbors.forEach(c => {
                const m = buildCampingMarker({
                    id: c.id,
                    geometry: { coordinates: [c.lng, c.lat] },
                    properties: { name: c.naam, city: c.stad, type_camping: c.type }
                });
                if (!m) return;
                if (c.id === objectId) {
                    foundMarker = m;
                    markerLayer = 'top10';
                    top10Layer.addLayer(m);
                } else {
                    added.push(m);
                }
            });
            window.suppressDistance = false;
            window.suppressSearchMarker = false;
            if (added.length) markerCluster.addLayers(added);
        }
        if (foundMarker && markerLayer === 'top10') {
            map.setView(targetLatLng, targetZoom, { animate: true });
            openPopupAfterAnimation();
        } else {
            // Marker not found - just pan to coordinates
            map.setView(targetLatLng, targetZoom);
        }
    }

    // Lock fitBounds for a bit longer to ensure stability
    setTimeout(() => { window.skipFitBounds = false; }, 4000);
};

function renderResults(objects, cLat, cLng) {
    markerCluster.clearLayers(); top10Layer.clearLayers();
    const resultsListEl = document.getElementById('resultsList');
    // Vervang altijd de vorige lijst (v0.2.59-latere invoering van insertAdjacentHTML
    // had de oude $('#resultsList').empty() laten vallen -> stale resultaten bleven staan)
    resultsListEl.innerHTML = '';
    if (objects.length === 0) { resultsListEl.innerHTML = '<div style="padding:20px;text-align:center;">Geen campings gevonden.</div>'; return; }
    const bounds = L.latLngBounds([cLat, cLng]);
    const clusterMarkers = []; // batch: verzamelt markers voor markerCluster.addLayers()
    const cardsHtml = []; // batch: bouwt alle kaarten op, één keer invoegen na de loop
    objects.forEach((obj, index) => {
        const p = obj.properties, g = obj.geometry; if (!g) return;

        // Check the type_camping field - we should only include campsites where
        // type_camping is 0, 1, or 2
        // type_camping = 3 indicates the campsite does not apply to the current filters
        const typeCamping = p.type_camping !== undefined ? p.type_camping : -1; // Default to -1 if not found

        if (typeCamping === 3) {
            // Skip this campsite as it doesn't match the current filters
            return;
        }

        const lat = g.coordinates[1], lng = g.coordinates[0];
        const safeName = btoa(unescape(encodeURIComponent(p.name)));
        const marker = buildCampingMarker(obj);
        // Afstand voor de kaart-tegel (de marker-popup berekent zijn eigen afstand
        // in buildCampingMarker, net als voorheen dezelfde logica).
        const distDisplay = window.suppressDistance && currentUserLatLng
            ? (calculateDistance(currentUserLatLng.lat, currentUserLatLng.lng, lat, lng) / 1000).toFixed(1)
            : (obj.distM / 1000).toFixed(1);
        if (index < 10) { top10Layer.addLayer(marker); bounds.extend([lat, lng]); } else clusterMarkers.push(marker);

        const card = `<div class="camping-card">
            <div class="card-body">
                <h3 class="camping-name-link" onclick="window.showSVRDetailPage('${obj.id}', 'list'); return false;">${p.name}</h3>
                <div class="card-location"><i class="fa-solid fa-map-pin"></i> ${p.city}</div>
                ${window.suppressDistance && !currentUserLatLng ? '' : `<div class="card-distance"><i class="fa-solid fa-map-pin"></i> Afstand: ${distDisplay} km</div>`}
            </div>
            <div class="camping-actions">
                <a href="#" class="action-btn btn-kaart" onclick="window.focusOnMarker(${lat},${lng}, '${obj.id}', map.getZoom()); return false;"><i class="fa-solid fa-map"></i> KAART</a>
                <a href="#" class="action-btn btn-route" onclick="window.openNavHelper(${lat}, ${lng}, '${safeName}'); return false;"><i class="fa-solid fa-route"></i> ROUTE</a>
                <a href="#" class="action-btn btn-info" onclick="window.showSVRDetailPage('${obj.id}', 'list'); return false;"><i class="fa-solid fa-circle-info"></i> INFO</a>
            </div>
        </div>`;
        cardsHtml.push(card);
    });
    markerCluster.addLayers(clusterMarkers); // batch toevoegen i.p.v. addLayer() per marker -> voorkomt main-thread blocking
    resultsListEl.insertAdjacentHTML('beforeend', cardsHtml.join(''));
    
    // Store bounds for later use
    window.lastMapBounds = bounds;
    
    // Only fit bounds if map is currently visible and we're not focusing on a marker
    if (!isListView && !window.skipFitBounds) {
        map.fitBounds(bounds, { padding: [50, 50] });
    }
}

// === MAP MENU (svr.nl link + Uitloggen) ===
window.toggleMapMenu = function() {
    const existingMenu = document.getElementById('map-actions-menu');
    if (existingMenu) {
        existingMenu.remove();
        if (window._closeMapMenuOnOutsideClick) {
            document.removeEventListener('click', window._closeMapMenuOnOutsideClick);
        }
        return;
    }

    const btn = document.getElementById('menuBtn');
    const rect = btn.getBoundingClientRect();

    // Position: fixed t.o.v. de viewport en direct aan <body> gehangen (niet
    // aan #menu-btn-wrapper) zodat dit menu altijd bovenop alles verschijnt,
    // ongeacht eventuele position/overflow/stacking-context verschillen tussen
    // de mobiele en desktop CSS-layout van .map-actions-stack. Dit is hetzelfde
    // betrouwbare patroon (position: fixed, hoge z-index) als het login-overlay,
    // dat al bewezen op beide platformen goed werkt.
    const menu = document.createElement('div');
    menu.id = 'map-actions-menu';
    menu.style.cssText = `
        position: fixed;
        top: ${rect.top}px;
        left: ${Math.max(8, rect.left - 198)}px;
        background: white; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.2);
        min-width: 190px; z-index: 10000; overflow: hidden;
    `;
    menu.innerHTML = `
        <button id="menu-open-svr" style="
            display: block; width: 100%; padding: 12px 16px; border: none; background: none;
            text-align: left; font-size: 15px; color: #333; cursor: pointer; border-bottom: 1px solid #eee;
        "><i class="fas fa-globe" style="width: 20px; margin-right: 8px;"></i>www.svr.nl</button>
        <button id="menu-favorites" style="
            display: block; width: 100%; padding: 12px 16px; border: none; background: none;
            text-align: left; font-size: 15px; color: #333; cursor: pointer; border-bottom: 1px solid #eee;
        "><i class="fa-solid fa-heart" style="width: 20px; margin-right: 8px; color: #d11a2a;"></i>Toon favorieten</button>
        <button id="menu-logout" style="
            display: block; width: 100%; padding: 12px 16px; border: none; background: none;
            text-align: left; font-size: 15px; color: #d9534f; cursor: pointer;
        "><i class="fas fa-sign-out-alt" style="width: 20px; margin-right: 8px;"></i>Uitloggen</button>
    `;
    document.body.appendChild(menu);

    document.getElementById('menu-open-svr').addEventListener('click', () => {
        window.open('https://www.svr.nl', '_blank');
        window.toggleMapMenu();
    });

    document.getElementById('menu-favorites').addEventListener('click', () => {
        window.toggleMapMenu();
        window.showFavorites();
    });

    document.getElementById('menu-logout').addEventListener('click', () => {
        window.toggleMapMenu();
        window.logoutSVR();
    });

    // Sluit het menu bij een tap buiten het menu/de knop, maar pas vanaf de
    // volgende event-cyclus zodat de klik die het menu opende het niet meteen
    // weer sluit.
    setTimeout(() => {
        window._closeMapMenuOnOutsideClick = function(e) {
            const m = document.getElementById('map-actions-menu');
            if (m && !m.contains(e.target) && !btn.contains(e.target)) {
                window.toggleMapMenu();
            }
        };
        document.addEventListener('click', window._closeMapMenuOnOutsideClick);
    }, 0);
};

// Ruimt de lokale sessie op en toont het inlogscherm. Wordt gebruikt door de
// "Uitloggen"-knop, en is tevens de eenvoudigste manier om de sessie-verlopen
// flow (401 -> inlogscherm) handmatig te testen op elk toestel.
window.logoutSVR = function() {
    localStorage.removeItem('svr_session_id');
    localStorage.removeItem('svr_phpsessid');
    if (window.showLoginScreen) window.showLoginScreen('Uitgelogd');
};

window.showHelp = function() {
    const dynamicText = document.getElementById('dynamic-help-text');
    if (isListView) { dynamicText.innerText = 'Terug naar boven scrollen'; }
    else { dynamicText.innerText = 'Toon jouw huidige locatie'; }
    document.getElementById('help-overlay').style.display = 'block';

    // Trigger install prompt if PWA is not installed
    if (!window.isAppInstalled() && window.showInstallPromotion) {
        window.showInstallPromotion();
    }
};

// === LOGIN FUNCTIONALITEIT VOOR SVR PWA ===
async function checkSession() {
  try {
    const sessionId = localStorage.getItem('svr_session_id');
    const options = { headers: {} };

    if (!sessionId) {
      console.log('❌ No session ID found in localStorage.');
      return false;
    }

    // OFFLINE SUPPORT: Als we offline zijn, vertrouwen we op de aanwezigheid van de sessionId
    if (!navigator.onLine) {
      console.log('📡 Offline mode: Trusting existing session ID from cache.');
      return true;
    }

    options.headers['X-SVR-Session'] = sessionId;
    console.log('✅ Found session ID, validating online...', sessionId.substring(0, 20) + '...');
    
    const response = await fetch('https://svr-proxy-worker.e60-manuels.workers.dev/api/objects?page=0&lat=52.1326&lng=5.2913&distance=1&limit=1', options);
    
    if (response.ok) {
      console.log('✅ Bestaande sessie is nog geldig');
      return true;
    } else if (response.status === 401) {
      console.log('❌ Sessie verlopen (401), opnieuw inloggen vereist');
      localStorage.removeItem('svr_session_id'); // Clear invalid session
      return false;
    }
    console.log(`❌ Ongeldige sessie: Status ${response.status}`);
    return false;
  } catch (error) {
    console.error('Session check failed:', error);
    // Bij netwerkfout (niet 401) maar wel offline, laten we de sessie staan
    if (!navigator.onLine) return true;
    return false;
  }
}

async function loginToSVR(email, password) {
  try {
    if (!navigator.onLine) {
      alert('Inloggen vereist een internetverbinding.');
      return false;
    }
    const response = await fetch('https://svr-proxy-worker.e60-manuels.workers.dev/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
      // credentials: 'include' // Removed, as we manually manage session via localStorage and custom header
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.session_id) {
        localStorage.setItem('svr_session_id', data.session_id);
        if (data.phpsessid) localStorage.setItem('svr_phpsessid', data.phpsessid);
        console.log('✅ Session ID stored in localStorage.');
      } else {
        console.warn('Login successful but no session_id received in response.');
      }
      console.log('✅ Login succesvol:', data.message || 'Geen bericht');
      return true;
    } else {
      let errorData;
      try {
        errorData = await response.json(); // Probeer als JSON te parsen
      } catch (jsonError) {
        // Als JSON parsen faalt, haal dan de ruwe tekst op
        errorData = { message: `Worker error (non-JSON response): ${await response.text()}`, details: jsonError.message };
      }
      console.error('❌ Login mislukt:', errorData.message || errorData.details || 'Onbekende fout');
      alert('Login mislukt: ' + (errorData.message || errorData.details || 'Onbekende fout'));
      return false;
    }
  } catch (error) {
    console.error('Login error:', error);
    alert('Login fout: ' + error.message);
    return false;
  }
}

// Centrale logout-helper: ruimt lokale sessiegegevens op en toont het inlogscherm.
// Wordt gebruikt door: de 401-afhandeling in fetchWithRetry, de fallback-detectie
// in renderDetail, en de "Uitloggen"-optie in het actiemenu.
window.logoutSVR = function(reason = "Uitgelogd") {
    localStorage.removeItem('svr_session_id');
    localStorage.removeItem('svr_phpsessid');
    if (window.showLoginScreen) window.showLoginScreen(reason);
};

window.showLoginScreen = function(reason = "") {
  if (document.getElementById('login-overlay')) return;

  const loginHtml = `
    <div id="login-overlay" style="
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.8); display: flex; justify-content: center; align-items: flex-start; padding-top: 10vh; z-index: 10000;
    ">
      <div style="
        background: white; padding: 30px; border-radius: 10px;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 400px; width: 90%;
      ">
        <h2 style="margin-top: 0; color: #333;">SVR Login</h2>
        <p style="color: #666; margin-bottom: 5px;">Log in om de app te gebruiken</p>
        <div style="margin-bottom: 20px;"></div>
        
        <input type="email" id="svr-email" placeholder="Email" style="width: 100%; padding: 12px; margin-bottom: 15px; border: 1px solid #ddd; border-radius: 5px; box-sizing: border-box; font-size: 16px;">
        <div style="position: relative; margin-bottom: 20px;">
          <input type="password" id="svr-password" placeholder="Wachtwoord" style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 5px; box-sizing: border-box; font-size: 16px;">
          <i class="fas fa-eye" id="togglePassword" style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); cursor: pointer; color: #666;"></i>
        </div>

        <button id="svr-login-btn" style="width: 100%; padding: 12px; background: #007bff; color: white; border: none; border-radius: 5px; font-size: 16px; cursor: pointer; font-weight: bold;">Inloggen</button>
        <div id="login-error" style="color: red; margin-top: 15px; display: none;"></div>
        </div>
        </div>
        `;

        document.body.insertAdjacentHTML('beforeend', loginHtml);

        // Add toggle functionality
        const togglePassword = document.getElementById('togglePassword');
        const password = document.getElementById('svr-password');

        if (togglePassword && password) {
            togglePassword.addEventListener('click', function (e) {
                // toggle the type attribute
                const type = password.getAttribute('type') === 'password' ? 'text' : 'password';
                password.setAttribute('type', type);
                // toggle the eye slash icon
                this.classList.toggle('fa-eye-slash');
            });
        }
  document.getElementById('svr-login-btn').addEventListener('click', async () => {
    const email = document.getElementById('svr-email').value;
    const password = document.getElementById('svr-password').value;
    
    if (!email || !password) {
      const err = document.getElementById('login-error');
      err.textContent = 'Vul email en wachtwoord in';
      err.style.display = 'block';
      return;
    }
    
    const btn = document.getElementById('svr-login-btn');
    btn.textContent = 'Bezig met inloggen...';
    btn.disabled = true;
    
    const success = await loginToSVR(email, password);
    
    if (success) {
      document.getElementById('login-overlay').remove();
      window.initializeApp();
    } else {
      btn.textContent = 'Inloggen';
      btn.disabled = false;
      const err = document.getElementById('login-error');
      err.textContent = 'Login mislukt, probeer opnieuw';
      err.style.display = 'block';
    }
  });
  
  document.getElementById('svr-password').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('svr-login-btn').click();
  });
}

// Versiepobe: vergelijkt de lokaal draaiende versie met de serverversie
// (version.json). Zo komt een nieuwe release ook door op installaties waarvan
// de Service Worker niet (tijdig) wordt bijgewerkt - de SW-update hangt af van
// CDN-cache en browser-update-throttling en kan daardoor lang achterblijven.
let __versionCheckDone = false;
window.checkForAppVersionUpdate = function() {
  if (__versionCheckDone) return;
  __versionCheckDone = true;
  if (!navigator.onLine) return;

  // Unieke querystring forceert een CDN-miss; no-store ontwijkt de browser-cache.
  fetch('./version.json?t=' + Date.now(), { cache: 'no-store' })
    .then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then((data) => {
      if (!data || typeof data.version !== 'string') return;
      if (data.version === window.SVR_PWA_VERSION) return;

      // Eénmalige automatische reload per sessie (geen reload-loop).
      if (sessionStorage.getItem('svr-update-reloaded') === '1') return;
      sessionStorage.setItem('svr-update-reloaded', '1');

      const toast = document.createElement('div');
      toast.className = 'app-update-toast';
      toast.textContent = 'Nieuwe versie ' + data.version + ' beschikbaar - opnieuw laden...';
      document.body.appendChild(toast);

      setTimeout(() => window.location.reload(), 1200);
    })
    .catch(() => { /* Stil negeren: offline of CDN-storing. */ });
};

async function initApp() {
  console.log('🚀 SVR PWA Start - Checking session...');

  window.checkForAppVersionUpdate();
  
  const hasSessionInStorage = !!localStorage.getItem('svr_session_id');

  // Als we offline zijn, proberen we direct te starten
  if (!navigator.onLine) {
    if (hasSessionInStorage) {
      console.log('📡 Offline mode & Session found. Starting app shell.');
      window.initializeApp();
      return;
    } else {
      console.log('📡 Offline mode but NO session found.');
      window.showLoginScreen("Offline (Geen sessie in geheugen)");
      return;
    }
  }

  const hasValidSession = await checkSession();
  
  if (hasValidSession) {
    console.log('✅ Sessie geldig, app starten...');
    window.initializeApp();
  } else {
    console.log('❌ Geen geldige sessie, login scherm tonen...');
    window.showLoginScreen(hasSessionInStorage ? "Sessie verlopen" : "Niet ingelogd");
  }
}

window.initializeApp = function() {
    // Basis-history-entry die de oorsprong van de app vastlegt én fungeert als
    // herkenbaar 'laatste punt' voor de Android-back-bevestiging.
    history.replaceState({ view: 'map', __svrBase: true }, "");

    // Niet-geïnstalleerde app: houd een guard-entry boven de basis-entry. Zo
    // wordt een 'laatste' Android-back-press door popstate onderschept (toast +
    // opnieuw pushen) i.p.v. de app direct te laten verlaten. Bij een
    // geïnstalleerde PWA is dat niet nodig (back sluit naar de app-lijst).
    if (typeof window.isAppInstalled === 'function' && !window.isAppInstalled()) {
        history.pushState({ view: 'map' }, "", window.location.pathname);
    }

    // Reset filters on startup
    window.currentFilters = [];
    // Clear filters cookie to ensure proxy/server starts fresh
    document.cookie = "filters=[]; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=svr.nl";
    // Clear cache to ensure we load the full dataset (unfiltered) on fresh start
    localStorage.removeItem('svr_cache_campsites');

    // Set version display
    const verDisplay = document.getElementById('pwa-version-display');
    if (verDisplay) verDisplay.textContent = `v${window.SVR_PWA_VERSION}`;

    // Load static data from data/campings.json (Single Source of Truth)
    // This renders the initial map view with all 1300+ campings
    window.loadStaticCampsites();
    
    // Start background fetch of filter checkboxes (vinkjes) with a small delay
    // This ensures the initial local render gets full CPU priority first.
    setTimeout(() => {
        if (window.fetchFilterData) {
            logDebug("Starting delayed background filter fetch...");
            window.fetchFilterData();
        }
    }, 1500);

    if (!localStorage.getItem('svr_help_shown')) {
        // Only set the flag if the help screen is shown as part of the initial flow
        window.shouldShowPWAAfterHelp = true; 
        setTimeout(() => { window.showHelp(); localStorage.setItem('svr_help_shown', 'true'); }, 2500);
    } else {
        // If help screen is not shown, or already shown, trigger PWA prompt check directly
        // after a slight delay to avoid interfering with initial load.
        setTimeout(() => { 
            // Only show prompt if it hasn't been handled via initial help screen.
            // In this 'else' block, it means help was NOT shown, so the prompt should show.
            window.shouldShowPWAAfterHelp = true; // Set flag to true for direct call
            window.closeHelpOverlayAndShowPWA(); 
        }, 3000); 
    }
};

// Function to close the help overlay and potentially show PWA install prompt
window.closeHelpOverlayAndShowPWA = function() {
    const helpOverlay = document.getElementById('help-overlay');
    if (helpOverlay) {
        helpOverlay.style.display = 'none';
        logDebug("Help overlay gesloten.");
    }
    
    // Only show the PWA prompt if the flag is set (meaning it's part of the initial flow)
    if (window.shouldShowPWAAfterHelp && window.isAppInstalled && !window.isAppInstalled()) {
        if (window.isIOS && window.isIOS()) {
            logDebug("Platform is iOS. Toon iOS instructies na sluiten help-overlay.");
            window.showIOSInstructions();
        } else if (window.showInstallPromotion) { // For Android/Desktop
            logDebug("Attempting to show PWA install promotion after help overlay close.");
            window.showInstallPromotion();
        }
    }
    window.shouldShowPWAAfterHelp = false; // Reset the flag after checking/showing
};

$(document).ready(() => {
    initApp();
});
